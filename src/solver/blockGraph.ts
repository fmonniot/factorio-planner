import type { Block } from '../data/types'

// ---------------------------------------------------------------------------
// Block dependency graph
//
// An edge runs source → consumer: a connection stored on block B with
// fromBlockId A is the edge A → B. Connections whose source does not exist are
// not edges.
// ---------------------------------------------------------------------------

/** blockId → ids of the blocks that receive something from it. */
function consumersOf(blocks: Block[]): Map<string, string[]> {
  const ids = new Set(blocks.map(b => b.id))
  const map = new Map<string, string[]>()
  for (const b of blocks) {
    for (const c of b.inputConnections) {
      if (!ids.has(c.fromBlockId)) continue
      const list = map.get(c.fromBlockId)
      if (list) list.push(b.id)
      else map.set(c.fromBlockId, [b.id])
    }
  }
  return map
}

/** True when `target` can be reached from `start` along source → consumer edges. */
function reaches(consumers: Map<string, string[]>, start: string, target: string): boolean {
  const seen = new Set<string>()
  const stack = [start]
  while (stack.length > 0) {
    const id = stack.pop()!
    if (id === target) return true
    if (seen.has(id)) continue
    seen.add(id)
    for (const next of consumers.get(id) ?? []) stack.push(next)
  }
  return false
}

/**
 * Would adding the edge fromBlockId → toBlockId close a cycle? True for a
 * self-connection, or when `from` is already downstream of `to`.
 */
export function wouldCreateCycle(blocks: Block[], fromBlockId: string, toBlockId: string): boolean {
  if (fromBlockId === toBlockId) return true
  return reaches(consumersOf(blocks), toBlockId, fromBlockId)
}

/**
 * Order blocks so every source is solved before its consumers (Kahn's
 * algorithm, ties broken by array index). Connections that lie on a cycle can
 * only come from hand-edited or imported JSON; they are reported in
 * `cyclicConnectionIds`, dropped from the ordering, and every block still
 * appears in `order`.
 */
export function orderBlocks(blocks: Block[]): { order: Block[]; cyclicConnectionIds: Set<string> } {
  const ids = new Set(blocks.map(b => b.id))
  const consumers = consumersOf(blocks)

  // A connection is on a cycle when its source is reachable from its consumer.
  const cyclicConnectionIds = new Set<string>()
  for (const b of blocks) {
    for (const c of b.inputConnections) {
      if (!ids.has(c.fromBlockId)) continue
      if (c.fromBlockId === b.id || reaches(consumers, b.id, c.fromBlockId)) {
        cyclicConnectionIds.add(c.id)
      }
    }
  }

  // In-degree over the remaining (acyclic) edges.
  const pending = new Map<string, number>()
  const downstream = new Map<string, string[]>()
  for (const b of blocks) {
    let count = 0
    for (const c of b.inputConnections) {
      if (!ids.has(c.fromBlockId) || cyclicConnectionIds.has(c.id)) continue
      count++
      const list = downstream.get(c.fromBlockId)
      if (list) list.push(b.id)
      else downstream.set(c.fromBlockId, [b.id])
    }
    pending.set(b.id, count)
  }

  const order: Block[] = []
  const done = new Set<string>()
  while (order.length < blocks.length) {
    const next = blocks.find(b => !done.has(b.id) && pending.get(b.id) === 0)
    // Unreachable: removing every cyclic edge leaves a DAG.
    if (!next) break
    done.add(next.id)
    order.push(next)
    for (const id of downstream.get(next.id) ?? []) pending.set(id, pending.get(id)! - 1)
  }

  return { order, cyclicConnectionIds }
}
