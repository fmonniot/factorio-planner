import { useUiStore } from '../../store/uiStore'
import { useSolverStore } from '../../store/solverStore'
import { useBlockStore } from '../../store/blockStore'
import { fmtFluidTag } from '../../data/flowKey'
import { FLOW_TOLERANCE } from '../../solver/index'
import { servedListOf } from '../../data/servedEntries'
import { fmtItemRateText, inputRateUnit } from './ItemTile'
import { cappedTitle, cappingLimit, REQUEST_IGNORED_TITLE } from './summarySegments'
import { fmtPartTemp } from './temperature'
import { areaExistsIn, lineName, servedLines, splitServed } from './servedOrder'
import type { Block, ConnectionFlow, ConnectionPart, GameData, Item } from '../../data/types'

// What the block graph knows about one connection: shared by the chip lists and the detail strip.

export type EdgeStatus = 'limited' | 'ok' | 'unused' | 'pending'

/** Status of one connection; `missing-source` and `self` never reach the graph (no edge is drawn). */
export function connectionStatus(flow: ConnectionFlow | undefined): EdgeStatus {
  if (!flow) return 'pending'
  return flow.status === 'missing-source' || flow.status === 'self' ? 'pending' : flow.status
}

export const CHIP_TONE: Record<EdgeStatus, string> = {
  ok: 'bg-green-950 text-green-300', // border set inline, in the source block's colour
  limited: 'bg-green-950 text-green-300 border-amber-500',
  unused: 'bg-green-950/40 text-green-300/50 border-green-900',
  pending: 'bg-gray-800 text-gray-400 border-gray-700',
}

/** Precedence for the single colour of an edge that carries several connections. */
export function pairStatus(statuses: EdgeStatus[]): EdgeStatus {
  for (const s of ['limited', 'ok', 'unused'] as const) {
    if (statuses.includes(s)) return s
  }
  return 'pending'
}

export function ordinal(n: number): string {
  const rest = n % 100
  const suffix = rest >= 11 && rest <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'
  return `${n}${suffix}`
}

interface ConnectionDetailArgs {
  connectionId: string
  /** The (source, consumer) pair of the connection; only its block ids are read, for the names of unknown blocks. */
  edge: { from: string; to: string }
  source: Block | undefined
  target: Block | undefined
  flow: ConnectionFlow | undefined
  items: GameData['items']
}

export interface ConnectionDetail {
  connection: Block['inputConnections'][number]
  item: Item | undefined
  itemName: string
  status: EdgeStatus
  /** The rank of the consumer in the source's served list for the item, when the list names it. */
  rank: number | undefined
  /** The full sentence: what the connection is, its limit or shortfall, request, temperatures and served place. */
  title: string
  fmt: (perMin: number) => string
  unitOf: ReturnType<typeof inputRateUnit>
  sourceName: string
  targetName: string
}

/** The facts and the tooltip sentence of one connection; null when the consumer no longer has it. */
export function useConnectionDetail({ connectionId: id, edge, source, target, flow, items }: ConnectionDetailArgs): ConnectionDetail | null {
  const rateUnit = useUiStore(s => s.rateUnit)
  const connection = target?.inputConnections.find(c => c.id === id)
  // Only the (source, item) list of this connection, so a solve that changes another list does not re-render it.
  const servedList = useSolverStore(s => (source && connection ? s.served[source.id]?.[connection.itemId] : undefined))
  const blocks = useBlockStore(s => s.blocks)
  const sourceName = source?.name ?? edge.from
  const targetName = target?.name ?? edge.to
  if (!connection) return null
  const unitOf = inputRateUnit(connection.itemId, rateUnit)
  const fmt = (perMin: number) => fmtItemRateText(connection.itemId, perMin / 60, rateUnit)
  const status = connectionStatus(flow)
  const item: Item | undefined = items[connection.itemId]
  const itemName = item?.name ?? connection.itemId

  // The rank this connection's block has in the source's served list for the item; none while the source has no stored list
  // for it, or while the list does not name the block (the chip then says nothing, as the list's divider does).
  const stored = source ? servedListOf(source, connection.itemId) : undefined
  const ranked = stored && servedList ? splitServed(servedLines(servedList, connection.itemId, rateUnit), stored, areaExistsIn(blocks)).ranked : []
  const mine = ranked.filter(l => l.blockId === target?.id) // ranked order: ranks never decrease, so the first is the best
  const line = mine[0]
  const rank = line?.rank

  let title = `${itemName}: ${sourceName} → ${targetName}`
  const cap = cappingLimit(status === 'limited', flow?.capped, connection.maxRate)
  if (cap !== undefined) {
    title = cappedTitle(fmt(cap))
  } else if (status === 'limited') title = `Limited: ${sourceName} only offers ${fmt(flow?.available ?? 0)}`
  else if (status === 'unused') title = `Not used: ${targetName} makes or needs none from outside`
  if (flow?.loop) title += ' — part of a loop'
  if (flow?.kind === 'request') {
    title += ` — requested: ${sourceName} makes ${fmt(flow.requested ?? 0)} for ${targetName}`
  } else if (flow?.requestIgnored) {
    title += ` — taken as existing: ${REQUEST_IGNORED_TITLE[flow.requestIgnored]}`
  }
  const parts = flow?.parts
  if (parts && (parts.length >= 2 || (parts.length === 1 && fmtFluidTag(parts[0].temp) !== ''))) {
    const part = (p: ConnectionPart) =>
      `${fmt(p.rate)} at ${fmtPartTemp(p.temp)}${p.available > p.rate + FLOW_TOLERANCE ? ` (of ${fmt(p.available)} offered)` : ''}`
    title += ` — carries ${parts.map(part).join(', ')}`
  }
  if (line) {
    const places = mine.some(l => l.areaId !== undefined)
      ? mine.map(l => `${ordinal(l.rank)}${l.group ? ' shared' : ''} (${lineName(l, target)})`).join(', ')
      : `${ordinal(line.rank)}${line.group ? ' (shared)' : ''}`
    title += ` — served ${places} in ${sourceName}'s list`
  }
  return { connection, item, itemName, status, rank, title, fmt, unitOf, sourceName, targetName }
}

/** Identity of a (source, consumer) edge. */
export const edgeKey = (e: { from: string; to: string }) => `${e.from}>${e.to}`

/** Tooltip of a summary chip or a matrix cell: the count, then what is notable among its connections. */
export function edgeSummaryTitle(
  n: number, sourceName: string, targetName: string, statuses: EdgeStatus[], loop: boolean, withRule = 0,
): string {
  let title = `${n} ${n === 1 ? 'item' : 'items'} from ${sourceName} to ${targetName}`
  const limited = statuses.filter(s => s === 'limited').length
  const unused = statuses.filter(s => s === 'unused').length
  if (limited > 0) title += `; ${limited} limited`
  if (unused > 0) title += `; ${unused} not used`
  if (loop) title += '; part of a loop'
  if (withRule > 0) title += `; ${withRule} with a source rule in ${targetName}`
  return title
}
