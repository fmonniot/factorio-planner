import { solveAll } from './index'
import type {
  AppState,
  AreaRoute,
  Block,
  ConnectionFlow,
  GameData,
  ItemSourcingMode,
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
  /** itemId -> sourcing mode, set on the block. */
  sourcing?: Record<string, ItemSourcingMode>
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

export interface InspectReport {
  block: { id: string; name: string }
  rows: RowReport[]
  items: ItemReport[]
  unsatisfied: UnsatisfiedItem[]
  warnings: SolverWarning[]
  /** Connections into and out of the block. */
  flows: ConnectionFlow[]
  areaRoutes: AreaRoute[]
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
            itemSourcing: { ...b.itemSourcing, ...(whatIf.sourcing ?? {}) },
            rootPlan: mapPlan(b.rootPlan, edit),
          },
    ),
  }
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

  if (report.areaRoutes.length > 0) {
    out.push('', 'Area routes (item, from → to, items/min):')
    for (const r of report.areaRoutes) out.push(`  ${r.itemId}  ${r.from ?? 'outside'} → ${r.to ?? 'outside'}  ${num(r.rate)}`)
  }
  return out.join('\n')
}
