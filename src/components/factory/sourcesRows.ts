import type { Block, BlockConnection, ConnectionFlow } from '../../data/types'
import { hasProduct } from '../../solver/blockGraph'
import { productChangeEffects, requestBlockerTitle } from '../../store/connections'
import { cappedTitle, cappingLimit, REQUEST_IGNORED_TITLE } from './summarySegments'

// ---------------------------------------------------------------------------
// The block lines of the Sources list: one row per connection of the item, with the source, the flow and what the line says
// about it. Pure functions of the plan and the solve.
// ---------------------------------------------------------------------------

/** The tag of a block line: what the connection is to its source. */
export type Tag = 'requested' | 'existing'

/** One block line's model: its connection, source, flow, tag and what it reads. */
export interface BlockRow {
  connection: BlockConnection
  source: Block | undefined
  flow: ConnectionFlow | undefined
  /** Deleted source or self-connection: listed greyed, with Remove only. */
  greyed: boolean
  tag?: Tag
  /** The tag's tooltip. */
  tagTitle?: string
  /** The action *Make it a product* is offered. */
  canMakeProduct: boolean
  /** Why it cannot be used: the source receives the item itself, so the request would be ignored. */
  productBlocked?: string
  status: string
}

/** The block lines of `itemId`, in connection order. `rate` formats items/min for the status sentences. */
export function buildBlockRows(input: {
  block: Block
  blocks: Block[]
  flows: ConnectionFlow[]
  itemId: string
  itemName: string
  rate: (perMin: number) => string
}): BlockRow[] {
  const { block, blocks, flows, itemId, itemName, rate } = input
  const blockById = new Map(blocks.map(b => [b.id, b]))
  const flowById = new Map(flows.map(f => [f.connectionId, f]))
  return block.inputConnections.filter(c => c.itemId === itemId).map(connection => {
    const source = blockById.get(connection.fromBlockId)
    const flow = flowById.get(connection.id)
    const greyed = source === undefined || connection.fromBlockId === block.id
    if (greyed) {
      return { connection, source, flow, greyed, canMakeProduct: false, status: source === undefined ? 'the source block was deleted' : 'ignored: a block cannot supply itself' }
    }
    const sourceName = source.name
    // Before the first solve the tag follows the source's products; after it, the solver's reading (a request it ignores is a take).
    const requested = flow ? flow.kind === 'request' : hasProduct(source, itemId)
    const tag: Tag = requested ? 'requested' : 'existing'
    const tagTitle = requested
      ? `${sourceName} makes what this block needs of it.`
      : flow?.requestIgnored
        ? `Taken as existing: ${REQUEST_IGNORED_TITLE[flow.requestIgnored]}`
        : `${sourceName} only gives what it has left over.`
    let status = ''
    if (flow?.status === 'unused') status = 'not used: this block makes or needs none from outside'
    else if (flow?.status === 'limited') {
      const cap = cappingLimit(true, flow.capped, connection.maxRate)
      status = cap !== undefined ? cappedTitle(rate(cap)) : `Limited: ${sourceName} only offers ${rate(flow.available)}`
    }
    const canMakeProduct = tag === 'existing' && !hasProduct(source, itemId)
    // As in the connection menu: a source that receives the item itself would ignore the request, so the action is disabled.
    const blocker = canMakeProduct ? productChangeEffects(blocks, source.id, itemId, 'add', flows).find(e => e.blocker)?.blocker : undefined
    return { connection, source, flow, greyed, tag, tagTitle, canMakeProduct, ...(blocker ? { productBlocked: requestBlockerTitle(blocker, sourceName, itemName) } : {}), status }
  })
}
