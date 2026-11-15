import { solveAll } from './index'
import { makeHereOf } from '../data/sourceRules'
import { areaName } from '../data/subPlanTree'
import { rankedPairs, type RankedEntry } from './servedRank'
import type {
  AppState,
  AreaRoute,
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
// block (rows, item balance, imports, warnings, connection flows), optionally after a what-if edit.
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
  /** Only for a member of a group of two or more. `percent` is its weight in the group (equal when none is stored); a group that holds a take has `listOrder` instead and no percent, because it is served in list order. */
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
  warnings: SolverWarning[]
  /** Connections into and out of the block. */
  flows: ConnectionFlow[]
  areaRoutes: AreaRoute[]
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

/** A copy of `appState` with the what-if edits applied to `blockId`; the input is not modified. */
export function applyWhatIf(appState: AppState, blockId: string, whatIf: WhatIf): AppState {
  const drop = new Set(whatIf.drop ?? [])
  const pins = whatIf.pins ?? {}
  const edit = (plan: SubPlan): SubPlan => {
    const next: SubPlan = {
      ...plan,
      nodes: plan.nodes
        .filter(n => n.kind !== 'game-recipe' || !drop.has(n.recipeId))
        .map(n => (n.kind === 'game-recipe' && n.recipeId in pins ? { ...n, pinnedRate: pins[n.recipeId] } : n)),
    }
    if (whatIf.noArea) delete next.area
    return next
  }
  return {
    ...appState,
    blocks: appState.blocks.map(b =>
      b.id !== blockId
        ? b
        : {
            ...b,
            sourceRules: whatIfRules(b.sourceRules, whatIf),
            rootPlan: mapPlan(b.rootPlan, edit),
          },
    ),
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
    const takes = new Set(list.consumers.filter(c => c.kind !== 'request').map(c => c.blockId))
    const groupOf = new Map<string, { g: number; group: NonNullable<ServedLineReport['group']> }>()
    if (pair) {
      // One pass: the entries of a group are the head and the `tied` entries after it.
      const groups: RankedEntry[][] = []
      pair.listed.forEach((e, i) => {
        if (i === 0 || !e.tied) groups.push([e])
        else groups[groups.length - 1].push(e)
      })
      groups.forEach((members, g) => {
        // A group that holds a take is served in list order (see grantByRank), so no percent applies to it.
        const inListOrder = members.some(e => e.kind === 'block' && takes.has(e.blockId))
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
  const solved = solveAll(state.blocks, gameData)
  const empty: InspectReport = {
    block: { id: block.id, name: block.name },
    rows: [],
    items: [],
    unsatisfied: [],
    warnings: [],
    flows: [],
    areaRoutes: [],
    served: [],
    totals: { executions: 0, machineCountExact: 0, machineCountCeil: 0, powerKw: 0 },
  }
  const error = solved.errors[block.id]
  const result = solved.results[block.id]
  if (error || !result) return { ...empty, error: error ?? 'no result' }

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

  return {
    ...empty,
    rows,
    items,
    unsatisfied: result.unsatisfied,
    warnings: result.warnings,
    flows: solved.flows.filter(f => f.fromBlockId === block.id || f.toBlockId === block.id),
    areaRoutes: result.areaRoutes ?? [],
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
  for (const u of report.unsatisfied) out.push(`  ${u.itemId}  ${num(u.rate)}`)
  if (report.unsatisfied.length === 0) out.push('  none')

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
    for (const r of report.areaRoutes) out.push(`  ${r.itemId}  ${r.from ?? 'outside'} → ${r.to ?? 'outside'}  ${num(r.rate)}`)
  }
  return out.join('\n')
}
