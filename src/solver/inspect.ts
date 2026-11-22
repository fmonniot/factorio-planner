import { solveAll, flattenBlock, surplusTolerance } from './index'
import { createSolveCache } from './solveCache'
import { areaLPItems, areaRuleOf, blockAreas } from './areas'
import { outsideLegParts } from './areaRoutes'
import { fmtFluidTag } from '../data/flowKey'
import { makeHereOf } from '../data/sourceRules'
import { servedGroups } from '../data/servedEntries'
import { areaName } from '../data/subPlanTree'
import { rankedPairs } from './servedRank'
import type {
  AppState,
  AreaRoute,
  AreaSourceRule,
  Block,
  ConnectionFlow,
  GameData,
  MultiBlockSolve,
  SourceRule,
  SolverWarning,
  SubPlan,
  UnsatisfiedItem,
} from '../data/types'

// Developer tooling, not used by the app: solve an exported plan and describe the result of one
// block (rows, item balance, imports, the imports its connections replaced, warnings, connection flows), optionally after a what-if edit.
// `scripts/inspect-plan.mjs` is the command line around it (see CLAUDE.md, Commands).

export interface WhatIf {
  /** recipeId -> pinned executions/min, set on every row of that recipe in the block. */
  pins?: Record<string, number>
  /** Recipe ids whose rows are removed from the block. */
  drop?: string[]
  /** itemId -> sourcing preset, set on the block as the rule's `makeHere`. */
  sourcing?: Record<string, 'byproducts-first' | 'connections-first'>
  /** Items whose Import is turned off on the block. */
  importOff?: string[]
  /** Clear the `area` flag of every sub-factory of the block. */
  noArea?: boolean
  /** An area's own rule for an item (`SubPlan.sourceRules`), edited from the block's rule: Receive it first, Don't make more here, or Make it here. */
  areaSourcing?: (AreaItemWhatIf & { mode: AreaSourcingMode })[]
  /** Items whose Import is turned off in an area's own rule. */
  areaImportOff?: AreaItemWhatIf[]
  /** An area stops taking an item from another area (`areasOff` of its own rule). */
  areaOff?: AreaOffWhatIf[]
}

/** `first`: Receive it first; `off`: Don't make more here; `here`: Make it here. */
export type AreaSourcingMode = 'first' | 'off' | 'here'

/** An area (a sub-factory id or name, "Top level" for the root) and an item id. */
export interface AreaItemWhatIf {
  area: string
  itemId: string
}

/** An area, an item, and the other area (same forms as `area`) the first no longer takes the item from. */
export interface AreaOffWhatIf extends AreaItemWhatIf {
  other: string
}

const AREA_MODES: readonly string[] = ['first', 'off', 'here']

/** Parses `--area-sourcing <area>:<item>=<first|off|here>` entries: split on the last `=`, then on the first `:`. */
export function parseAreaSourcing(entries: readonly string[]): (AreaItemWhatIf & { mode: AreaSourcingMode })[] {
  return entries.map(entry => {
    const at = entry.lastIndexOf('=')
    const left = at > 0 ? entry.slice(0, at) : ''
    const mode = entry.slice(at + 1)
    const colon = left.indexOf(':')
    const area = colon > 0 ? left.slice(0, colon) : ''
    const itemId = colon > 0 ? left.slice(colon + 1) : ''
    if (at <= 0 || area === '' || itemId === '') throw new Error(`--area-sourcing expects <area>:<item>=<first|off|here>, got "${entry}"`)
    if (!AREA_MODES.includes(mode)) throw new Error(`--area-sourcing ${area}:${itemId}=${mode}: expected first, off or here`)
    return { area, itemId, mode: mode as AreaSourcingMode }
  })
}

/** Parses `--area-import-off <area>:<item>` entries. */
export function parseAreaImportOff(entries: readonly string[]): AreaItemWhatIf[] {
  return entries.map(entry => {
    const colon = entry.indexOf(':')
    const area = colon > 0 ? entry.slice(0, colon) : ''
    const itemId = colon > 0 ? entry.slice(colon + 1) : ''
    if (area === '' || itemId === '') throw new Error(`--area-import-off expects <area>:<item>, got "${entry}"`)
    return { area, itemId }
  })
}

/** Parses `--area-off <area>:<item>=<other area>` entries: split on the last `=`, then the left side on the first `:`. */
export function parseAreaOff(entries: readonly string[]): AreaOffWhatIf[] {
  return entries.map(entry => {
    const at = entry.lastIndexOf('=')
    const left = at > 0 ? entry.slice(0, at) : ''
    const other = entry.slice(at + 1)
    const colon = left.indexOf(':')
    const area = colon > 0 ? left.slice(0, colon) : ''
    const itemId = colon > 0 ? left.slice(colon + 1) : ''
    if (at <= 0 || area === '' || itemId === '' || other === '') throw new Error(`--area-off expects <area>:<item>=<other area>, got "${entry}"`)
    return { area, itemId, other }
  })
}

/** The id of the area of `block` called `nameOrId`: an id, else a name as `areaName` gives it ("Top level" for the root), else that name ignoring case. */
export function findArea(block: Block, nameOrId: string): string {
  const areas = blockAreas(block.rootPlan)
  if (!areas) throw new Error(`Block "${block.name}" has no areas`)
  const named = areas.map(a => ({ id: a.id, name: areaName(block.rootPlan, a.id) }))
  if (named.some(a => a.id === nameOrId)) return nameOrId
  for (const matches of [named.filter(a => a.name === nameOrId), named.filter(a => a.name.toLowerCase() === nameOrId.toLowerCase())]) {
    if (matches.length === 1) return matches[0].id
    if (matches.length > 1) {
      throw new Error(`Area name "${nameOrId}" is ambiguous in block "${block.name}": use an id (${matches.map(a => a.id).join(', ')})`)
    }
  }
  throw new Error(`No area "${nameOrId}" in block "${block.name}". Areas: ${named.map(a => a.name).join(', ')}`)
}

export interface RowReport {
  recipeId: string
  throughput: number
  machineCountExact: number
  machineCountCeil: number
  powerKw: number
}

export interface ItemReport {
  itemId: string
  produced: number
  consumed: number
  /** produced − consumed: above 0 is output that nothing in the block uses (a goal or a surplus), below 0 is what the block imports or receives. */
  net: number
  /** The item is one of the block's products. */
  isProduct: boolean
}

/** One line of a served list: a consumer block, or the source's own extra output. */
export interface ServedLineReport {
  /** 1-based; the members of a group share one; lines the list does not name get a rank of their own after it. */
  rank: number
  /** The consumer block's name, or 'extra output'. */
  name: string
  /** Absent for the extra. */
  blockId?: string
  /** The area of the consumer this line is, when the block shows as areas (see `ServedConsumer.areaId`). */
  areaId?: string
  kind: 'request' | 'take' | 'extra'
  /** Only for a member of a group of two or more. `percent` is its weight in the group (equal when none is stored); a group served in list order (`ServedConsumer.groupInListOrder`) has `listOrder` instead and no percent. */
  group?: { size: number; percent?: number; listOrder?: true }
  /** The list names this line; always false when the item is not ranked. */
  listed: boolean
  /** items/min asked (request), credited (take), or the extra's asked. */
  share: number
  got: number
  notCredited?: true
}

export interface ServedItemReport {
  itemId: string
  /** The solver served the item by the source's list (else in solve order). */
  ranked: boolean
  lines: ServedLineReport[]
}

export interface InspectReport {
  block: { id: string; name: string }
  rows: RowReport[]
  items: ItemReport[]
  unsatisfied: UnsatisfiedItem[]
  /**
   * Imports the block's input connections replaced: it imports `without` items/min with its input connections removed, `now` with them.
   * Approximate for a block in a loop: removing its input connections also changes what its consumers request of it, so the
   * `without` solve runs at different goals and its import may be smaller than the block's own production would need.
   */
  replacedImports: { itemId: string; without: number; now: number }[]
  warnings: SolverWarning[]
  /** Connections into and out of the block. */
  flows: ConnectionFlow[]
  areaRoutes: AreaRoute[]
  /** The block's areas in table order, with their own rules (`SubPlan.sourceRules`); empty for a block without areas. */
  areas: { id: string; name: string; rules: Record<string, AreaSourceRule> }[]
  /** For each intermediate two areas or more touch that has an outside leg into an area: what each such area receives, imports and misses, in route order. */
  areaItems: { itemId: string; areas: { areaId: string; name: string; received: number; imported: number; missing: number }[] }[]
  /** The inspected block's items other blocks take from it: the order they were served in and what each got. */
  served: ServedItemReport[]
  totals: { executions: number; machineCountExact: number; machineCountCeil: number; powerKw: number }
  /** The solver failed on the block (the other fields are then empty). */
  error?: string
}

/** The block called `nameOrId` (an id, else a name, else a name ignoring case); throws listing the names otherwise. */
export function findBlock(appState: AppState, nameOrId: string): Block {
  const wanted = nameOrId.toLowerCase()
  const block =
    appState.blocks.find(b => b.id === nameOrId) ??
    appState.blocks.find(b => b.name === nameOrId) ??
    appState.blocks.find(b => b.name.toLowerCase() === wanted)
  if (!block) throw new Error(`No block "${nameOrId}". Blocks: ${appState.blocks.map(b => b.name).join(', ')}`)
  return block
}

function mapPlan(plan: SubPlan, fn: (plan: SubPlan) => SubPlan): SubPlan {
  return fn({ ...plan, subPlans: plan.subPlans.map(p => mapPlan(p, fn)) })
}

function whatIfRules(rules: Record<string, SourceRule>, whatIf: WhatIf): Record<string, SourceRule> {
  const out: Record<string, SourceRule> = { ...rules }
  for (const [id, mode] of Object.entries(whatIf.sourcing ?? {})) {
    if (mode !== 'connections-first' && mode !== 'byproducts-first') {
      throw new Error(`--sourcing ${id}=${String(mode)}: expected byproducts-first or connections-first`)
    }
    out[id] = { ...out[id], makeHere: makeHereOf(mode) }
  }
  for (const id of whatIf.importOff ?? []) out[id] = { ...out[id], importOff: true }
  return out
}

/** The areas' own rules after the what-if: area id → item id → rule. Each starts from the area's stored rule, else the block's (new) rule cut to its two keys, else `{}`. */
function whatIfAreaRules(block: Block, blockRules: Record<string, SourceRule>, whatIf: WhatIf): Map<string, Record<string, AreaSourceRule>> {
  const sourcing = whatIf.areaSourcing ?? []
  const importOff = whatIf.areaImportOff ?? []
  const areaOff = whatIf.areaOff ?? []
  const out = new Map<string, Record<string, AreaSourceRule>>()
  if (sourcing.length === 0 && importOff.length === 0 && areaOff.length === 0) return out
  if (whatIf.noArea) throw new Error('--no-area cannot be combined with --area-sourcing, --area-import-off or --area-off')
  for (const e of sourcing) {
    if (!AREA_MODES.includes(e.mode)) throw new Error(`--area-sourcing ${e.area}:${e.itemId}=${String(e.mode)}: expected first, off or here`)
  }
  // The areas are resolved on the original tree.
  const stored = new Map<string, Record<string, AreaSourceRule>>()
  const collect = (p: SubPlan): void => {
    if (p.sourceRules) stored.set(p.id, p.sourceRules)
    p.subPlans.forEach(collect)
  }
  collect(block.rootPlan)
  const ruleOf = (areaId: string, itemId: string): AreaSourceRule => {
    const map = out.get(areaId) ?? {}
    out.set(areaId, map)
    if (Object.hasOwn(map, itemId)) return map[itemId]
    // The solver's own resolution (`areaRuleOf`), copied so the edit below leaves the stored rule alone.
    const rule: AreaSourceRule = { ...areaRuleOf({ id: areaId, nodeIds: [], rules: stored.get(areaId) }, blockRules, itemId) }
    map[itemId] = rule
    return rule
  }
  for (const e of sourcing) {
    const rule = ruleOf(findArea(block, e.area), e.itemId)
    if (e.mode === 'here') delete rule.makeHere
    else rule.makeHere = e.mode === 'first' ? 'after-blocks' : 'off'
  }
  for (const e of importOff) ruleOf(findArea(block, e.area), e.itemId).importOff = true
  for (const e of areaOff) {
    const areaId = findArea(block, e.area)
    const rule = ruleOf(areaId, e.itemId)
    const other = findArea(block, e.other)
    if (other === areaId) throw new Error(`--area-off ${e.area}:${e.itemId}=${e.other}: an area cannot switch itself off`)
    rule.areasOff = [...new Set([...(rule.areasOff ?? []), other])]
  }
  return out
}

/** A copy of `appState` with the what-if edits applied to `blockId`; the input is not modified. */
export function applyWhatIf(appState: AppState, blockId: string, whatIf: WhatIf): AppState {
  const drop = new Set(whatIf.drop ?? [])
  const pins = whatIf.pins ?? {}
  return {
    ...appState,
    blocks: appState.blocks.map(b => {
      if (b.id !== blockId) return b
      const sourceRules = whatIfRules(b.sourceRules, whatIf)
      const areaRules = whatIfAreaRules(b, sourceRules, whatIf)
      const edit = (plan: SubPlan): SubPlan => {
        const next: SubPlan = {
          ...plan,
          nodes: plan.nodes
            .filter(n => n.kind !== 'game-recipe' || !drop.has(n.recipeId))
            .map(n => (n.kind === 'game-recipe' && n.recipeId in pins ? { ...n, pinnedRate: pins[n.recipeId] } : n)),
        }
        if (whatIf.noArea) delete next.area
        const edited = areaRules.get(plan.id)
        if (edited) next.sourceRules = { ...plan.sourceRules, ...edited }
        return next
      }
      return { ...b, sourceRules, rootPlan: mapPlan(b.rootPlan, edit) }
    }),
  }
}

/** The served lists of `sourceId` as the solver read them: ranks, groups and what each line got. */
export function servedReportOf(blocks: readonly Block[], sourceId: string, served: MultiBlockSolve['served']): ServedItemReport[] {
  const pairs = rankedPairs(blocks).get(sourceId)
  const names = new Map(blocks.map(b => [b.id, b.name]))
  const nameOf = (id: string) => names.get(id) ?? id
  const byId = new Map(blocks.map(b => [b.id, b]))
  const areaLabel = (blockId: string, areaId: string): string => {
    const root = byId.get(blockId)?.rootPlan
    return root ? areaName(root, areaId) : areaId
  }
  // A group is keyed by its entry: an area entry by block and area, a block entry by block.
  const entryKey = (blockId: string, areaId?: string): string => (areaId === undefined ? blockId : `${blockId}\0${areaId}`)
  return Object.entries(served[sourceId] ?? {}).map(([itemId, list]) => {
    const pair = pairs?.get(itemId)
    const ranked = pair !== undefined
    const flagged = new Set(list.consumers.filter(c => c.groupInListOrder).map(c => c.blockId))
    const groupOf = new Map<string, { g: number; group: NonNullable<ServedLineReport['group']> }>()
    if (pair) {
      const groups = servedGroups(pair.listed)
      groups.forEach((members, g) => {
        // A group of takes the solver could not share by need is served in list order (see `ServedConsumer.groupInListOrder`), so no percent applies to it.
        const inListOrder = members.some(e => e.kind === 'block' && flagged.has(e.blockId))
        for (const e of members) {
          const group = inListOrder ? { size: members.length, listOrder: true as const } : { size: members.length, percent: e.weight ?? 100 / members.length }
          groupOf.set(e.kind === 'extra' ? 'extra' : entryKey(e.blockId, e.areaId), { g, group })
        }
      })
    }
    type Line = Omit<ServedLineReport, 'rank'>
    const infoOf = (blockId: string, areaId?: string) => (areaId !== undefined && groupOf.get(entryKey(blockId, areaId))) || groupOf.get(blockId)
    const lines: Line[] = list.consumers.map(c => {
      const info = infoOf(c.blockId, c.areaId)
      return {
        name: c.areaId !== undefined ? `${nameOf(c.blockId)} / ${areaLabel(c.blockId, c.areaId)}` : nameOf(c.blockId),
        blockId: c.blockId,
        ...(c.areaId !== undefined ? { areaId: c.areaId } : {}),
        kind: c.kind === 'request' ? 'request' : 'take',
        ...(info && info.group.size >= 2 ? { group: info.group } : {}),
        listed: info !== undefined,
        share: c.share,
        got: c.got,
        ...(c.notCredited ? { notCredited: true as const } : {}),
      }
    })
    if (list.extra) {
      const info = groupOf.get('extra')
      lines.splice(list.extra.place, 0, {
        name: 'extra output',
        kind: 'extra',
        ...(info && info.group.size >= 2 ? { group: info.group } : {}),
        listed: info !== undefined,
        share: list.extra.asked,
        got: list.extra.got,
      })
    }
    let rank = 0
    const rankOfGroup = new Map<number, number>()
    const out = lines.map((l): ServedLineReport => {
      const info = l.kind === 'extra' ? groupOf.get('extra') : infoOf(l.blockId ?? '', l.areaId)
      if (info) {
        let r = rankOfGroup.get(info.g)
        if (r === undefined) rankOfGroup.set(info.g, (r = ++rank))
        return { rank: r, ...l }
      }
      return { rank: ++rank, ...l }
    })
    return { itemId, ranked, lines: out }
  })
}

/** recipeNodeId -> recipeId for every game-recipe row of the plan tree. */
function recipeIds(plan: SubPlan, into = new Map<string, string>()): Map<string, string> {
  for (const n of plan.nodes) if (n.kind === 'game-recipe') into.set(n.id, n.recipeId)
  for (const p of plan.subPlans) recipeIds(p, into)
  return into
}

/** Solve the whole plan (all blocks, connections included) and describe `blockName`'s result. */
export function inspectPlan(appState: AppState, gameData: GameData, blockName: string, whatIf: WhatIf = {}): InspectReport {
  const found = findBlock(appState, blockName)
  const state = applyWhatIf(appState, found.id, whatIf)
  const block = findBlock(state, found.id)
  // One cache for both solves: the blocks the removed connections do not reach are solved once.
  const cache = createSolveCache()
  const solved = solveAll(state.blocks, gameData, cache)
  const empty: InspectReport = {
    block: { id: block.id, name: block.name },
    rows: [],
    items: [],
    unsatisfied: [],
    replacedImports: [],
    warnings: [],
    flows: [],
    areaRoutes: [],
    areas: [],
    areaItems: [],
    served: [],
    totals: { executions: 0, machineCountExact: 0, machineCountCeil: 0, powerKw: 0 },
  }
  const error = solved.errors[block.id]
  const result = solved.results[block.id]
  if (error || !result) return { ...empty, error: error ?? 'no result' }

  // The whole plan is solved again with the block's input connections removed (its goals include its consumers' requests, so a bare
  // block solve would not do); what it imported then and no longer imports is what its connections replaced.
  let replacedImports: InspectReport['replacedImports'] = []
  if (block.inputConnections.length > 0) {
    const alone = solveAll(state.blocks.map(b => (b.id === block.id ? { ...b, inputConnections: [] } : b)), gameData, cache)
    const now = new Map(result.unsatisfied.map(u => [u.itemId, u.rate]))
    replacedImports = (alone.results[block.id]?.unsatisfied ?? [])
      .map(u => ({ itemId: u.itemId, without: u.rate, now: now.get(u.itemId) ?? 0 }))
      .filter(r => r.without - r.now > surplusTolerance(r.without))
  }

  const byNode = recipeIds(block.rootPlan)
  const rows: RowReport[] = []
  const balance = new Map<string, { produced: number; consumed: number }>()
  const totals = { executions: 0, machineCountExact: 0, machineCountCeil: 0, powerKw: 0 }
  const add = (itemId: string, key: 'produced' | 'consumed', rate: number) => {
    const entry = balance.get(itemId) ?? { produced: 0, consumed: 0 }
    entry[key] += rate
    balance.set(itemId, entry)
  }
  for (const n of result.nodes) {
    rows.push({
      recipeId: byNode.get(n.recipeNodeId) ?? n.recipeNodeId,
      throughput: n.throughput,
      machineCountExact: n.machineCountExact,
      machineCountCeil: n.machineCountCeil,
      powerKw: n.powerKw,
    })
    totals.executions += n.throughput
    totals.machineCountExact += n.machineCountExact
    totals.machineCountCeil += n.machineCountCeil
    totals.powerKw += n.powerKw
    for (const [id, rate] of Object.entries(n.outputRates)) add(id, 'produced', rate)
    for (const [id, rate] of Object.entries(n.inputRates)) add(id, 'consumed', rate)
  }
  const products = new Set(block.products.map(p => p.itemId))
  const items = [...balance.entries()].map(([itemId, { produced, consumed }]) => ({
    itemId,
    produced,
    consumed,
    net: produced - consumed,
    isProduct: products.has(itemId),
  }))

  const flat = flattenBlock(block)
  const areas = (flat.areas ?? []).map(a => ({ id: a.id, name: areaName(block.rootPlan, a.id), rules: a.rules ?? {} }))
  const areaLP = areaLPItems(flat, gameData)
  const areaItems: InspectReport['areaItems'] = []
  for (const route of result.areaRoutes ?? []) {
    if (!areaLP.has(route.itemId) || route.from !== undefined || route.to === undefined) continue
    const a = (flat.areas ?? []).find(x => x.id === route.to)
    if (!a) continue
    const parts = outsideLegParts(route, areaRuleOf(a, block.sourceRules, route.itemId))
    let entry = areaItems.find(x => x.itemId === route.itemId)
    if (!entry) areaItems.push((entry = { itemId: route.itemId, areas: [] }))
    entry.areas.push({ areaId: a.id, name: areaName(block.rootPlan, a.id), received: parts.received, imported: parts.imported, missing: parts.missing })
  }

  return {
    ...empty,
    rows,
    items,
    unsatisfied: result.unsatisfied,
    replacedImports,
    warnings: result.warnings,
    flows: solved.flows.filter(f => f.fromBlockId === block.id || f.toBlockId === block.id),
    areaRoutes: result.areaRoutes ?? [],
    areas,
    areaItems,
    served: servedReportOf(state.blocks, block.id, solved.served),
    totals,
  }
}

function num(v: number): string {
  if (v === 0) return '0'
  const a = Math.abs(v)
  if (a >= 1000) return v.toFixed(0)
  if (a >= 10) return v.toFixed(2)
  if (a >= 0.01) return v.toFixed(4)
  return v.toExponential(2)
}

/** Net flow below this (items/min) is solver noise. */
const NET_NOISE = 1e-6

export interface FormatOptions {
  /** Also list rows that solved to zero. */
  allRows?: boolean
  /** Also list items that balance (net ≈ 0). */
  allItems?: boolean
}

/** A plain-text rendering of a report, meant to be read by a person or an agent. */
export function formatReport(report: InspectReport, options: FormatOptions = {}): string {
  const out: string[] = [`Block "${report.block.name}"`]
  if (report.error) return [...out, `SOLVER ERROR: ${report.error}`].join('\n')
  const t = report.totals
  out.push(
    `Totals: ${num(t.executions)} executions/min, ${num(t.machineCountExact)} machines (${t.machineCountCeil} rounded up per row), ${num(t.powerKw)} kW`,
  )

  out.push('', 'Rows (recipe, executions/min, machines, kW):')
  const rows = report.rows.filter(r => options.allRows || r.throughput > NET_NOISE)
  for (const r of rows) out.push(`  ${r.recipeId}  ${num(r.throughput)}  ${num(r.machineCountExact)}  ${num(r.powerKw)}`)
  if (rows.length < report.rows.length) out.push(`  (${report.rows.length - rows.length} rows at zero hidden)`)

  const net = (i: ItemReport) => Math.abs(i.net) > NET_NOISE
  const left = report.items.filter(i => i.net > NET_NOISE).sort((a, b) => b.net - a.net)
  out.push('', 'Left over (produced − consumed > 0; goals are tagged, the rest is surplus):')
  for (const i of left) out.push(`  ${i.itemId}${i.isProduct ? ' [product]' : ''}  ${num(i.net)}  (made ${num(i.produced)}, used ${num(i.consumed)})`)
  if (left.length === 0) out.push('  none')
  if (options.allItems) {
    out.push('', 'Balanced or short items:')
    for (const i of report.items.filter(i => !left.includes(i)).sort((a, b) => a.itemId.localeCompare(b.itemId)))
      out.push(`  ${i.itemId}  net ${num(i.net)}  (made ${num(i.produced)}, used ${num(i.consumed)})${net(i) ? '' : ' balanced'}`)
  }

  out.push('', 'Imports (items/min that must come from outside the block):')
  for (const u of report.unsatisfied) out.push(`  ${u.itemId}${fmtFluidTag(u.temp) ? ` (${fmtFluidTag(u.temp)})` : ''}  ${num(u.rate)}`)
  if (report.unsatisfied.length === 0) out.push('  none')

  if (report.replacedImports.length > 0) {
    out.push('', 'Imports the connections replaced (item, imported with no connection, imported now; approximate in a loop, where removing them also changes the goals):')
    for (const r of report.replacedImports) out.push(`  ${r.itemId}  ${num(r.without)}  ${num(r.now)}`)
  }

  out.push('', 'Warnings:')
  for (const w of report.warnings) out.push(`  ${JSON.stringify(w)}`)
  if (report.warnings.length === 0) out.push('  none')

  const flows = report.flows.filter(f => options.allItems || f.rate > NET_NOISE || f.available > NET_NOISE)
  out.push('', 'Connections (from → to, item, delivered, available, status):')
  for (const f of flows) out.push(`  ${f.fromBlockId.slice(0, 8)} → ${f.toBlockId.slice(0, 8)}  ${f.itemId}  ${num(f.rate)}  ${num(f.available)}  ${f.status}`)
  if (flows.length === 0) out.push('  none')

  if (report.served.length > 0) {
    out.push('', 'Served lists (items other blocks take from this block; rank, line, kind, share, got):')
    for (const item of report.served) {
      out.push(`  ${item.itemId}  ${item.ranked ? '(list)' : '(no list: solve order)'}`)
      for (const l of item.lines) {
        const group = l.group ? ` [group of ${l.group.size}, ${l.group.percent !== undefined ? `${num(l.group.percent)}%` : 'in list order'}]` : ''
        out.push(
          `    ${l.rank}  ${l.name}${group}  ${l.kind}  share ${num(l.share)}  got ${num(l.got)}${item.ranked && !l.listed ? '  (not in the list)' : ''}${l.notCredited ? '  (not credited)' : ''}`,
        )
      }
    }
  }

  if (report.areaRoutes.length > 0) {
    out.push('', 'Area routes (item, from → to, items/min):')
    for (const r of report.areaRoutes) {
      out.push(`  ${r.itemId}  ${r.from ?? 'outside'} → ${r.to ?? 'outside'}  ${num(r.rate)}${r.supplied !== undefined ? `  (supplied ${num(r.supplied)})` : ''}`)
    }
  }

  if (report.areas.length > 0) {
    const nameOf = (id: string) => report.areas.find(a => a.id === id)?.name ?? id
    out.push('', 'Area rules (area, item, rule):')
    for (const a of report.areas) {
      const entries = Object.entries(a.rules)
      if (entries.length === 0) out.push(`  ${a.name}  follows the block`)
      for (const [itemId, rule] of entries) {
        const make = rule.makeHere === 'after-blocks' ? 'first' : rule.makeHere === 'off' ? 'off' : 'here'
        out.push(`  ${a.name}  ${itemId}  ${make}  Import ${rule.importOff === true ? 'off' : 'on'}`)
        if (rule.areasOff && rule.areasOff.length > 0) out.push(`  takes nothing from ${rule.areasOff.map(nameOf).join(', ')}`)
      }
    }
  }

  if (report.areaItems.length > 0) {
    out.push('', 'Area items from outside (item, area, received, imported, missing):')
    for (const item of report.areaItems) {
      for (const a of item.areas) out.push(`  ${item.itemId}  ${a.name}  ${num(a.received)}  ${num(a.imported)}  ${num(a.missing)}`)
    }
  }
  return out.join('\n')
}
