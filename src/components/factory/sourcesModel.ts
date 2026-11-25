import { MISSING_BLOCK_COLOR } from '../../data/blockColors'
import type { Block, SolverResult, SourceRule } from '../../data/types'
import { blockAreas } from '../../solver/areas'
import type { AreaSupply, SupplierLine } from './areaSources'
import { SOURCES_LINES } from './itemSourcing'
import type { LineKey, Side } from './itemSourcing'
import type { BlockRow } from './sourcesRows'
import type { ItemMaker } from './sourcesMakers'

// ---------------------------------------------------------------------------
// The model of the Sources list: what each line reads (its consumed share of the item's need), its status and look, the parts
// of the bar and the totals of the foot. A pure function of the solve, the rule and the lines' order.
// ---------------------------------------------------------------------------

const EPS = 1e-6

/** How a line is drawn: a block line in its source's colour, the rows of this block (teal), Import, or what is missing. */
export type LineLook =
  | { kind: 'block'; color: string; limited: boolean }
  | { kind: 'made' }
  | { kind: 'import' }
  | { kind: 'missing' }

/** The mark after a line's name: amber ! (limited), amber ▼ (missing), dashed circle (idle). */
export type LineMark = 'limited' | 'missing' | 'idle' | undefined

/** A row that makes some of a line's share: the recipe and its machines (the row's own count), and the part of the line's rate it covers. */
export interface LineMaker {
  recipeName: string
  machineName: string
  machineCount: number
  /** items/min of the line's rate this row covers. */
  rate: number
}

export interface SourceLine {
  /** 'made-here' | 'make-here' | 'other-areas' | `area:${id}` | `block:${connectionId}` | 'import' */
  key: string
  kind: 'made-here' | 'make-here' | 'other-areas' | 'other-area' | 'block' | 'import'
  label: string
  connectionId?: string
  areaId?: string
  /** Consumed items/min; undefined renders "—". */
  rate: number | undefined
  /** rate > EPS: filled marker, bar segment. */
  supplies: boolean
  /** The line has no effect now (`data-off`). */
  off: boolean
  /** Drawn faded: off, unless it is what is missing. */
  dim: boolean
  mark: LineMark
  look: LineLook
  /** The rows that make the line, on a supplying Already made here or Make more here line only. */
  makers?: LineMaker[]
}

export interface SourcesModel {
  /** Display order, one block line per connection. */
  lines: SourceLine[]
  /**
   * items/min of the item that reach the block or area: what its rows consume, or more when the item passes through (a product of
   * the block, whose connections and imports bring more than the rows use). Undefined before the first solve.
   */
  need: number | undefined
  /** items/min missing (Import off and nothing else supplies it). */
  missing: number
  /** What actually reaches the rows: the sum of the lines' rates, less the missing part. */
  total: number
  /** The supplying lines, in list order. */
  bar: { key: string; label: string; rate: number; look: LineLook }[]
}

export interface SourcesModelInput {
  block: Block
  result: SolverResult | undefined
  itemId: string
  /** The area the list is for; undefined is the whole block. */
  area: string | undefined
  rule: SourceRule | undefined
  makers: ItemMaker[]
  suppliers: SupplierLine[]
  /** The area's own figures (area scope only). */
  supply: AreaSupply | undefined
  /** The block's own unsatisfied rate of the item. */
  unsatisfied: number
  /**
   * At block scope, the part of `unsatisfied` that is missing when areas with a rule of their own decide it (`areaMissingPerMin`);
   * undefined when none has one, so the block's rule alone decides.
   */
  areaMissing?: number
  rows: BlockRow[]
  /** The lines top to bottom (`sourcesLineOrder`). */
  order: LineKey[]
}

/** items/min of `itemId` the solved rows consume: those of `nodeIds` when given, else all of them. Undefined before a solve. */
export function consumedOf(result: SolverResult | undefined, itemId: string, nodeIds?: ReadonlySet<string>): number | undefined {
  if (!result) return undefined
  let sum = 0
  for (const n of result.nodes) {
    if (nodeIds && !nodeIds.has(n.recipeNodeId)) continue
    sum += n.inputRates[itemId] ?? 0
  }
  return sum
}

const MADE: LineLook = { kind: 'made' }

/** The rows of a group that make a line of `total` items/min, each with its part of it: split by what each makes, equally if none makes any. Omitted when the line supplies nothing. */
function lineMakers(group: ItemMaker[], total: number | undefined): { makers: LineMaker[] } | undefined {
  if (total === undefined || !(total > EPS) || group.length === 0) return undefined
  const gross = group.reduce((t, m) => t + m.rate, 0)
  // When none makes any yet, the line is split among the rows that run machines: one that runs none gets no share.
  const running = group.filter(m => m.machineCount > 0).length
  // A row that makes none of the item at the moment (idle) covers no part of the line and has no line of its own.
  const makers = group
    .map(m => ({
      recipeName: m.recipeName, machineName: m.machineName, machineCount: m.machineCount,
      rate: gross > EPS ? (total * m.rate) / gross : m.machineCount > 0 ? total / running : 0,
    }))
    .filter(m => m.rate > EPS)
  return makers.length > 0 ? { makers } : undefined
}

export function buildSourcesModel(input: SourcesModelInput): SourcesModel {
  const { block, result, itemId, area, rule, makers, suppliers, supply, unsatisfied, areaMissing, rows, order } = input
  const solved = result !== undefined
  const areaNodes = area !== undefined ? new Set(blockAreas(block.rootPlan)?.find(a => a.id === area)?.nodeIds) : undefined
  const consumed = consumedOf(result, itemId, areaNodes)
  const makeOff = rule?.makeHere === 'off'
  const importOn = !rule?.importOff

  // Area scope: the area's own figures. Block scope: the part areas with Import off leave missing, else the block's rule decides.
  const missing = supply ? supply.missing : Math.min(unsatisfied, areaMissing ?? (importOn ? 0 : unsatisfied))
  const imported = supply ? supply.imported : unsatisfied - missing

  // Block lines: the flow's rate at block scope, the share of what reaches the area at area scope.
  const live = rows.filter(r => !r.greyed)
  const flowSum = live.reduce((t, r) => t + (r.flow?.rate ?? 0), 0)
  const blockRate = (r: BlockRow): number | undefined => {
    if (r.greyed) return undefined
    // The connection's flow is the block solve's own (it has no need of this block's result).
    if (area === undefined) return r.flow?.rate
    if (!solved || !r.flow) return undefined
    return flowSum > 0 ? ((r.flow?.rate ?? 0) * (supply?.reaches ?? 0)) / flowSum : 0
  }

  const areaRate = (l: SupplierLine): number | undefined => (!solved || l.off ? undefined : l.routed)

  // What the rows of the block or area use that no line above accounts for: made here.
  const sum = (xs: (number | undefined)[]) => xs.reduce<number>((t, x) => t + (x ?? 0), 0)
  // What reaches the block from outside; when the item passes through (a product), it is more than the rows consume.
  const outside = sum(rows.map(blockRate)) + imported + missing + sum(suppliers.map(areaRate))
  const need = consumed === undefined ? undefined : Math.max(consumed, outside)
  const inside = Math.max(0, (need ?? 0) - outside)
  const byproductRate = makers.filter(m => m.byproduct).reduce((t, m) => t + m.rate, 0)
  const madeHereShare = makeOff ? inside : Math.min(inside, byproductRate)
  const makeHereShare = makeOff ? 0 : inside - madeHereShare

  const madeGroup = makeOff ? makers : makers.filter(m => m.byproduct)
  const makeGroup = makeOff ? [] : makers.filter(m => !m.byproduct)
  const hasMadeMaker = madeGroup.length > 0
  const hasDedicated = makers.some(m => !m.byproduct)

  const lines: SourceLine[] = []
  const line = (l: Omit<SourceLine, 'supplies' | 'dim'> & { rate: number | undefined }): SourceLine => ({
    ...l,
    supplies: l.rate !== undefined && l.rate > EPS,
    dim: l.off && l.mark !== 'missing',
  })

  for (const key of order) {
    if (key === 'made-here') {
      const rate = solved ? madeHereShare : undefined
      lines.push(line({
        key, kind: 'made-here', label: SOURCES_LINES['made-here'].label, rate, off: false,
        mark: !hasMadeMaker && !(rate !== undefined && rate > EPS) ? 'idle' : undefined, look: MADE, ...lineMakers(madeGroup, rate),
      }))
    } else if (key === 'make-here') {
      lines.push(line({
        key, kind: 'make-here', label: SOURCES_LINES['make-here'].label, rate: solved && !makeOff ? makeHereShare : undefined, off: makeOff,
        mark: !makeOff && !hasDedicated ? 'idle' : undefined, look: MADE, ...lineMakers(makeGroup, solved && !makeOff ? makeHereShare : undefined),
      }))
    } else if (key === 'other-areas') {
      lines.push(line({ key, kind: 'other-areas', label: SOURCES_LINES['other-areas'].label, rate: undefined, off: false, mark: undefined, look: MADE }))
    } else if (key === 'import') {
      const mark: LineMark = missing > EPS ? 'missing' : undefined
      lines.push(line({
        key, kind: 'import', label: SOURCES_LINES.import.label, rate: solved ? imported + missing : undefined, off: !importOn && imported <= EPS,
        mark, look: missing > EPS && imported <= EPS ? { kind: 'missing' } : { kind: 'import' },
      }))
    } else if (key === 'block') {
      for (const r of rows) {
        const limited = r.flow?.status === 'limited'
        lines.push(line({
          key: `block:${r.connection.id}`, kind: 'block', label: r.source?.name ?? '(deleted block)', connectionId: r.connection.id,
          rate: blockRate(r), off: r.greyed, mark: limited ? 'limited' : undefined,
          look: { kind: 'block', color: r.source?.color ?? MISSING_BLOCK_COLOR, limited },
        }))
      }
    } else {
      const areaId = key.slice('area:'.length)
      const s = suppliers.find(l => l.areaId === areaId)
      if (!s) continue
      const rate = areaRate(s)
      lines.push(line({
        key, kind: 'other-area', label: s.name, areaId, rate, off: s.off,
        mark: !s.off && solved && s.routed <= EPS ? 'idle' : undefined, look: MADE,
      }))
    }
  }

  const bar: SourcesModel['bar'] = []
  for (const l of lines) {
    if (!l.supplies) continue
    if (l.kind === 'import') {
      // Both parts can show at once (areas with their own rules): what is imported, then what is missing.
      if (imported > EPS) bar.push({ key: l.key, label: l.label, rate: imported, look: { kind: 'import' } })
      if (missing > EPS) bar.push({ key: imported > EPS ? 'missing' : l.key, label: 'Missing', rate: missing, look: { kind: 'missing' } })
    } else bar.push({ key: l.key, label: l.label, rate: l.rate!, look: l.look })
  }

  return { lines, need, missing, total: sum(lines.map(l => l.rate)) - missing, bar }
}

/**
 * One short line per supplying source with its rate, for tooltips and assistive technology (never shown on the page).
 * `fmt` formats items/min. Read from the bar, so a greyed or off line, which has no rate, is not in it.
 */
export function sourcesReading(model: SourcesModel, fmt: (perMin: number) => string): string {
  if (model.need === undefined) return 'Not solved yet.'
  if (model.bar.length === 0) return 'Nothing supplies it.'
  return model.bar
    .map(p => {
      const rate = fmt(p.rate)
      // A bar entry that is only Missing reuses the key 'import': the look tells them apart, so it is read first.
      if (p.look.kind === 'missing') return `Missing: ${rate}`
      if (p.look.kind === 'import') return `Imported: ${rate}`
      if (p.look.kind === 'block') return `From ${p.label}: ${rate}${p.look.limited ? ' (limited)' : ''}`
      if (p.key === 'made-here') return `Already made here: ${rate}`
      if (p.key === 'make-here') return `Made by more rows here: ${rate}`
      return `From ${p.label}: ${rate}`
    })
    .join('\n')
}

/**
 * Where Alt+ArrowUp (-1) or Alt+ArrowDown (+1) on a line moves it: a block line by one place among the connections, *Make more
 * here* to the other side of the block lines. Null when there is nowhere to go, and for every other line.
 */
export function altMoveTarget(
  key: string,
  dir: -1 | 1,
  ctx: { connectionIds: readonly string[]; makeHere: 'after-blocks' | 'off' | undefined; /** Connections drawn greyed (their source is gone or is the block): they do not move. */ greyed?: ReadonlySet<string> },
): { type: 'connection'; connectionId: string; delta: -1 | 1 } | { type: 'make-more'; side: Side } | null {
  if (key.startsWith('block:')) {
    const connectionId = key.slice('block:'.length)
    if (ctx.greyed?.has(connectionId)) return null
    const from = ctx.connectionIds.indexOf(connectionId)
    const to = from + dir
    return from >= 0 && to >= 0 && to < ctx.connectionIds.length ? { type: 'connection', connectionId, delta: dir } : null
  }
  if (key === 'make-here') {
    if (ctx.makeHere === 'off') return null
    const side: Side = dir < 0 ? 'above' : 'below'
    const drawn: Side = ctx.makeHere === 'after-blocks' ? 'below' : 'above'
    return side === drawn ? null : { type: 'make-more', side }
  }
  return null
}
