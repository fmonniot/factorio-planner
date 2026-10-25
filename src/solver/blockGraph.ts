import type { Block } from '../data/types'

// ---------------------------------------------------------------------------
// Block dependency graph
//
// An edge runs source → consumer: a connection stored on block B with
// fromBlockId A is the edge A → B. Connections whose source does not exist are
// not edges. Blocks that supply each other, directly or through other blocks,
// form a strongly connected component; with two or more blocks it is a loop.
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
 * Would adding the edge fromBlockId → toBlockId close a loop? True when `from`
 * is already downstream of `to`. A self-connection is not a loop (it is
 * rejected outright). Used for hints only; loops are allowed.
 */
export function closesLoop(blocks: Block[], fromBlockId: string, toBlockId: string): boolean {
  return fromBlockId !== toBlockId && reaches(consumersOf(blocks), toBlockId, fromBlockId)
}

/**
 * Would a pull connection fromBlockId → toBlockId (`to` pulls from `from`)
 * close a cycle of pull connections? True when `from` is already a consumer of
 * `to`, directly or through other blocks, along pull connections. Push
 * connections do not count, and neither do pull connections whose source is
 * missing or the block itself. Unlike push loops, pull cycles are not solved.
 */
export function closesPullLoop(blocks: Block[], fromBlockId: string, toBlockId: string): boolean {
  const ids = new Set(blocks.map(b => b.id))
  const consumers = new Map<string, string[]>()
  for (const b of blocks) {
    for (const c of b.inputConnections) {
      if (!c.pull || !ids.has(c.fromBlockId) || c.fromBlockId === b.id) continue
      const list = consumers.get(c.fromBlockId)
      if (list) list.push(b.id)
      else consumers.set(c.fromBlockId, [b.id])
    }
  }
  return fromBlockId !== toBlockId && reaches(consumers, toBlockId, fromBlockId)
}

export interface LoopShape {
  /** Member order: the entry block first, then topologically along in-loop connections. */
  blockIds: string[]
  /** In-loop, non-self connections: members in order, each in `inputConnections` order. */
  connectionIds: string[]
  /** Connections whose source comes later in `blockIds` than its consumer. */
  backConnectionIds: string[]
}

export interface BlockComponent {
  /** Members in solve order. */
  blocks: Block[]
  /** Present iff the component has two or more blocks. */
  loop?: LoopShape
}

/**
 * Group blocks into strongly connected components and order them so every
 * source is solved before its consumers (Kahn's algorithm over components,
 * ties broken by the component's lowest block index). A component of one block
 * is an ordinary block; a larger one is a loop whose members are ordered
 * entry-first (see `memberOrder`). A connection from a block to itself is
 * never an edge; it can only come from hand-edited or imported JSON and is
 * reported in `selfConnectionIds`. Every block appears once in `order`.
 */
export function orderBlocks(blocks: Block[]): {
  order: Block[]
  components: BlockComponent[]
  selfConnectionIds: Set<string>
} {
  const ids = new Set(blocks.map(b => b.id))
  const consumers = consumersOf(blocks)

  const selfConnectionIds = new Set<string>()
  for (const b of blocks) {
    for (const c of b.inputConnections) if (c.fromBlockId === b.id) selfConnectionIds.add(c.id)
  }

  // Component number = index of its lowest-index member.
  const componentOf = new Map<string, number>()
  blocks.forEach((b, i) => {
    if (componentOf.has(b.id)) return
    componentOf.set(b.id, i)
    for (let j = i + 1; j < blocks.length; j++) {
      const x = blocks[j]
      if (!componentOf.has(x.id) && reaches(consumers, b.id, x.id) && reaches(consumers, x.id, b.id)) {
        componentOf.set(x.id, i)
      }
    }
  })

  const membersOf = new Map<number, Block[]>()
  for (const b of blocks) {
    const n = componentOf.get(b.id)!
    const list = membersOf.get(n)
    if (list) list.push(b)
    else membersOf.set(n, [b])
  }

  // In-degree over connections that cross components.
  const pending = new Map<number, number>()
  const downstream = new Map<number, number[]>()
  for (const n of membersOf.keys()) pending.set(n, 0)
  for (const b of blocks) {
    const to = componentOf.get(b.id)!
    for (const c of b.inputConnections) {
      if (!ids.has(c.fromBlockId) || c.fromBlockId === b.id) continue
      const from = componentOf.get(c.fromBlockId)!
      if (from === to) continue
      pending.set(to, pending.get(to)! + 1)
      const list = downstream.get(from)
      if (list) list.push(to)
      else downstream.set(from, [to])
    }
  }

  const numbers = [...membersOf.keys()].sort((a, b) => a - b)
  const components: BlockComponent[] = []
  const done = new Set<number>()
  while (components.length < numbers.length) {
    const next = numbers.find(n => !done.has(n) && pending.get(n) === 0)
    // Unreachable: components form a DAG.
    if (next === undefined) break
    done.add(next)
    const members = membersOf.get(next)!
    components.push(members.length > 1 ? loopComponent(members, ids) : { blocks: members })
    for (const n of downstream.get(next) ?? []) pending.set(n, pending.get(n)! - 1)
  }

  return { order: components.flatMap(c => c.blocks), components, selfConnectionIds }
}

/**
 * Order a loop's members and list its connections. The entry is the first
 * member (in `blocks` order) receiving from a block outside the loop, else the
 * first member; the rest follow in a topological order of the in-loop connections
 * (reverse depth-first postorder from the entry), so only the connections that
 * close a cycle run backwards.
 */
function loopComponent(members: Block[], allIds: Set<string>): BlockComponent {
  const memberIds = new Set(members.map(b => b.id))
  const entry =
    members.find(b => b.inputConnections.some(c => allIds.has(c.fromBlockId) && !memberIds.has(c.fromBlockId))) ??
    members[0]

  // Reverse DFS postorder from the entry is a topological order of the loop's
  // connections once the DFS back edges are removed, so only those run backwards.
  // Consumers are visited in reverse `blocks` order so that, among blocks the
  // connections leave unordered, the earlier one in `blocks` comes first.
  const consumersInLoop = (id: string) =>
    members.filter(b => b.inputConnections.some(c => c.fromBlockId === id))
  const visited = new Set([entry.id])
  const post: Block[] = []
  const visit = (b: Block): void => {
    for (const next of consumersInLoop(b.id).reverse()) {
      if (visited.has(next.id)) continue
      visited.add(next.id)
      visit(next)
    }
    post.push(b)
  }
  visit(entry)
  const ordered = post.reverse()

  const position = new Map(ordered.map((b, i) => [b.id, i]))
  const connectionIds: string[] = []
  const backConnectionIds: string[] = []
  for (const b of ordered) {
    for (const c of b.inputConnections) {
      if (c.fromBlockId === b.id || !memberIds.has(c.fromBlockId)) continue
      connectionIds.push(c.id)
      if (position.get(c.fromBlockId)! > position.get(b.id)!) backConnectionIds.push(c.id)
    }
  }

  return {
    blocks: ordered,
    loop: { blockIds: ordered.map(b => b.id), connectionIds, backConnectionIds },
  }
}
