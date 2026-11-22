import type { ConnectionFlow } from '../../data/types'
import { flowKey } from '../../data/flowKey'

/** One flow key's share of a connection: what it carried, what the source offered at that key and what was asked. */
export interface FlowShare {
  key: string
  rate: number
  available: number
  requested?: number
}

/** A connection's shares per flow key: a plain item is one share keyed by its id, a split fluid has one per part. */
export function flowShares(f: ConnectionFlow): FlowShare[] {
  if (!f.parts) return [{ key: f.itemId, rate: f.rate, available: f.available, ...(f.requested !== undefined ? { requested: f.requested } : {}) }]
  return f.parts.map(p => ({
    key: flowKey(f.itemId, p.temp),
    rate: p.rate,
    available: p.available,
    ...(p.requested !== undefined ? { requested: p.requested } : {}),
  }))
}

/**
 * The connection as seen from one flow key: the flow itself for a plain item, for a split fluid a copy whose `rate`, `available`
 * and `requested` are the part's. Undefined when the connection has no share at that key.
 */
export function flowAtKey(f: ConnectionFlow, key: string): ConnectionFlow | undefined {
  if (!f.parts) return key === f.itemId ? f : undefined
  const share = flowShares(f).find(s => s.key === key)
  if (!share) return undefined
  const copy: ConnectionFlow = { ...f, rate: share.rate, available: share.available }
  if (share.requested === undefined) delete copy.requested
  else copy.requested = share.requested
  return copy
}
