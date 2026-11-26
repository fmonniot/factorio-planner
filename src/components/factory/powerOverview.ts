import { ELECTRICITY_ITEM_ID } from '../../data/electricity'
import { dedicatedProduct } from '../../solver/areas'
import type { Block, GameData, SolvedNode, SolverResult, SubPlan } from '../../data/types'

// ---------------------------------------------------------------------------
// Power overview — the model behind the third view of the Block graph modal: what every block draws,
// split by group and recipe, against what the power plant makes. Pure; the component only draws it.
// ---------------------------------------------------------------------------

/** The gauge's scale is the larger column plus this much, so the taller column does not touch the top. */
export const GAUGE_HEADROOM = 1.06
/** Demand and generation closer than this (kW, 50 W) read as balanced. */
export const BALANCE_TOLERANCE_KW = 0.05
/** A bar of a row that draws any power is at least this wide (percent), so it stays visible. */
export const MIN_BAR_PERCENT = 1.5

export interface PowerRecipe {
  kind: 'recipe'
  key: string
  name: string
  iconPath?: string
  machines: number
  powerKw: number
}

export interface PowerGroup {
  kind: 'group'
  key: string
  name: string
  machines: number
  powerKw: number
  children: PowerEntry[]
}

export type PowerEntry = PowerGroup | PowerRecipe

export interface PowerBlock {
  kind: 'block'
  key: string
  id: string
  name: string
  color: string
  iconPath?: string
  machines: number
  powerKw: number
  generationKw: number
  /** The block's solve is arbitrary (conflicting pins, unbounded rewards or an arbitrary supplier): its figures may be off. */
  unreliable: boolean
  children: PowerEntry[]
}

/** One recipe row that draws power, for the By recipe list. */
export interface PowerLine {
  key: string
  name: string
  iconPath?: string
  blockId: string
  blockName: string
  blockColor: string
  /** The block's solve is arbitrary, as `PowerBlock.unreliable`. */
  unreliable: boolean
  machines: number
  powerKw: number
}

export interface PowerSkipped {
  id: string
  name: string
  reason: 'error' | 'none'
}

export type PowerStatus = 'short' | 'spare' | 'balanced'

export interface PowerOverview {
  blocks: PowerBlock[]
  lines: PowerLine[]
  skipped: PowerSkipped[]
  demandKw: number
  generationKw: number
  balanceKw: number
  status: PowerStatus
}

/** One electricity unit is 1 MJ, so units/min x 1000 / 60 is kW. */
const KW_PER_UNIT_PER_MIN = 1000 / 60

interface Ranked { name: string; powerKw: number; index: number }

/** Biggest power first, then name, then the order the plan has them in. */
function byPower(a: Ranked, b: Ranked): number {
  return b.powerKw - a.powerKw || a.name.localeCompare(b.name) || a.index - b.index
}

function sortEntries(entries: { entry: PowerEntry; index: number }[]): PowerEntry[] {
  const rank = (x: { entry: PowerEntry; index: number }): Ranked => ({ name: x.entry.name, powerKw: x.entry.powerKw, index: x.index })
  const groups = entries.filter(x => x.entry.kind === 'group').sort((a, b) => byPower(rank(a), rank(b)))
  const recipes = entries.filter(x => x.entry.kind === 'recipe').sort((a, b) => byPower(rank(a), rank(b)))
  return [...groups, ...recipes].map(x => x.entry)
}

function walk(
  plan: SubPlan,
  blockId: string,
  solved: ReadonlyMap<string, SolvedNode>,
  gameData: Pick<GameData, 'items' | 'recipes'>,
  visited: ReadonlySet<string>,
): PowerEntry[] {
  const seen = new Set(visited).add(plan.id)
  const entries: { entry: PowerEntry; index: number }[] = []
  plan.nodes.forEach((node, index) => {
    if (node.kind === 'game-recipe') {
      const recipe = gameData.recipes[node.recipeId]
      const product = recipe ? dedicatedProduct(node, recipe) : undefined
      const s = solved.get(node.id)
      entries.push({
        index,
        entry: {
          kind: 'recipe',
          key: `${blockId}/${node.id}`,
          name: recipe?.name ?? node.recipeId,
          iconPath: product ? gameData.items[product]?.iconPath : undefined,
          machines: s?.machineCountCeil ?? 0,
          powerKw: s?.powerKw ?? 0,
        },
      })
    } else if (node.kind === 'subplan') {
      const child = plan.subPlans.find(sp => sp.id === node.subPlanId)
      if (!child || seen.has(child.id)) return
      const children = walk(child, blockId, solved, gameData, seen)
      entries.push({
        index,
        entry: {
          kind: 'group',
          key: `${blockId}/${node.id}`,
          name: child.name.trim() || 'Sub-factory',
          machines: children.reduce((n, c) => n + c.machines, 0),
          powerKw: children.reduce((n, c) => n + c.powerKw, 0),
          children,
        },
      })
    }
  })
  return sortEntries(entries)
}

function leaves(entries: readonly PowerEntry[]): PowerRecipe[] {
  return entries.flatMap(e => (e.kind === 'recipe' ? [e] : leaves(e.children)))
}

function isUnreliable(result: SolverResult): boolean {
  return result.warnings.some(w =>
    (w.type === 'infeasible-pins' && w.conflict === true) || w.type === 'unbounded-absorber' || w.type === 'unbounded-source' ||
    // The solver puts this warning on the result of each block of the loop, so the block's own result carries it.
    w.type === 'loop-not-converged')
}

export function buildPowerOverview(
  blocks: readonly Block[],
  results: Readonly<Record<string, SolverResult>>,
  errors: Readonly<Record<string, string>>,
  gameData: Pick<GameData, 'items' | 'recipes'>,
): PowerOverview {
  const skipped: PowerSkipped[] = []
  const built: { block: PowerBlock; index: number }[] = []

  blocks.forEach((b, index) => {
    const result = results[b.id]
    if (errors[b.id] !== undefined) {
      skipped.push({ id: b.id, name: b.name, reason: 'error' })
      return
    }
    if (!result) {
      skipped.push({ id: b.id, name: b.name, reason: 'none' })
      return
    }
    const solved = new Map(result.nodes.map(n => [n.recipeNodeId, n]))
    built.push({
      index,
      block: {
        kind: 'block',
        key: b.id,
        id: b.id,
        name: b.name,
        color: b.color,
        iconPath: b.products[0] ? gameData.items[b.products[0].itemId]?.iconPath : undefined,
        machines: result.nodes.reduce((n, s) => n + s.machineCountCeil, 0),
        powerKw: result.nodes.reduce((n, s) => n + s.powerKw, 0),
        generationKw: result.nodes.reduce((n, s) => n + (s.outputRates[ELECTRICITY_ITEM_ID] ?? 0), 0) * KW_PER_UNIT_PER_MIN,
        unreliable: isUnreliable(result),
        children: walk(b.rootPlan, b.id, solved, gameData, new Set()),
      },
    })
  })

  built.sort((a, b) => b.block.powerKw - a.block.powerKw || a.index - b.index)
  const powerBlocks = built.map(x => x.block)
  const blockIndex = new Map(built.map(x => [x.block.id, x.index]))

  const lines: PowerLine[] = powerBlocks
    .flatMap(b => leaves(b.children)
      .filter(r => r.powerKw > 0)
      .map(r => ({
        key: r.key,
        name: r.name,
        iconPath: r.iconPath,
        blockId: b.id,
        blockName: b.name,
        blockColor: b.color,
        unreliable: b.unreliable,
        machines: r.machines,
        powerKw: r.powerKw,
      })))
    .sort((a, b) =>
      b.powerKw - a.powerKw || a.name.localeCompare(b.name) ||
      (blockIndex.get(a.blockId) ?? 0) - (blockIndex.get(b.blockId) ?? 0) || a.key.localeCompare(b.key))

  const demandKw = powerBlocks.reduce((n, b) => n + b.powerKw, 0)
  const generationKw = powerBlocks.reduce((n, b) => n + b.generationKw, 0)
  const balanceKw = generationKw - demandKw
  const status: PowerStatus = balanceKw < -BALANCE_TOLERANCE_KW ? 'short' : balanceKw > BALANCE_TOLERANCE_KW ? 'spare' : 'balanced'
  return { blocks: powerBlocks, lines, skipped, demandKw, generationKw, balanceKw, status }
}

// ---------------------------------------------------------------------------
// The By block list, flattened for drawing
// ---------------------------------------------------------------------------

export interface PowerListRow {
  entry: PowerBlock | PowerEntry
  depth: number
  blockId: string
  color: string
  expandable: boolean
  expanded: boolean
}

export function flattenPowerRows(blocks: readonly PowerBlock[], expanded: ReadonlySet<string>): PowerListRow[] {
  const rows: PowerListRow[] = []
  function push(entry: PowerBlock | PowerEntry, depth: number, blockId: string, color: string) {
    const children = entry.kind === 'recipe' ? [] : entry.children
    const open = children.length > 0 && expanded.has(entry.key)
    rows.push({ entry, depth, blockId, color, expandable: children.length > 0, expanded: open })
    if (open) for (const c of children) push(c, depth + 1, blockId, color)
  }
  for (const b of blocks) push(b, 0, b.id, b.color)
  return rows
}

/** Width of a weight bar, percent of the biggest row. */
export function barPercent(kw: number, maxKw: number): number {
  if (kw <= 0 || maxKw <= 0) return 0
  return Math.max(MIN_BAR_PERCENT, (kw / maxKw) * 100)
}

export function sharePercentText(kw: number, demandKw: number): string {
  if (demandKw <= 0 || kw <= 0) return '–'
  return `${((kw / demandKw) * 100).toFixed(1)}%`
}

// ---------------------------------------------------------------------------
// The gauge
// ---------------------------------------------------------------------------

export interface GaugeGeometry {
  scaleMax: number
  demand: number
  generation: number
  segments: { blockId: string; name: string; color: string; powerKw: number; height: number; unreliable: boolean }[]
  short?: { bottom: number; height: number }
  spare?: { bottom: number; height: number }
  generationLabelBottom: number
}

/** Every size is a fraction (0 to 1) of the plot's height. */
export function gaugeGeometry(model: PowerOverview): GaugeGeometry {
  const scaleMax = Math.max(model.demandKw, model.generationKw) * GAUGE_HEADROOM
  const frac = (kw: number) => (scaleMax > 0 ? kw / scaleMax : 0)
  const demand = frac(model.demandKw)
  const generation = frac(model.generationKw)
  return {
    scaleMax,
    demand,
    generation,
    segments: model.blocks
      .filter(b => b.powerKw > 0)
      .map(b => ({ blockId: b.id, name: b.name, color: b.color, powerKw: b.powerKw, height: frac(b.powerKw), unreliable: b.unreliable })),
    short: model.status === 'short' ? { bottom: generation, height: demand - generation } : undefined,
    spare: model.status === 'spare' ? { bottom: demand, height: generation - demand } : undefined,
    generationLabelBottom: Math.max(demand, generation),
  }
}
