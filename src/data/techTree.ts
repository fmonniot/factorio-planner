import type { GameData, Technology } from './types'
import { technologyClosure } from './horizon'

export const CARD_W = 184
export const CARD_H = 76
export const COL_GAP = 64
export const ROW_GAP = 16

export type TechState = 'researched' | 'available' | 'locked'

type Techs = GameData['technologies']

/** Prerequisite depth: the length of the longest chain of known prerequisites. */
export function techDepths(techs: Techs): Map<string, number> {
  const depths = new Map<string, number>()
  const visiting = new Set<string>()
  function depth(id: string): number {
    const known = depths.get(id)
    if (known !== undefined) return known
    visiting.add(id)
    let d = 0
    for (const p of techs[id].prerequisites) {
      if (!techs[p] || visiting.has(p)) continue // unknown, or a cycle
      d = Math.max(d, depth(p) + 1)
    }
    visiting.delete(id)
    depths.set(id, d)
    return d
  }
  for (const id of Object.keys(techs).sort()) depth(id)
  return depths
}

export interface TechNodeLayout { id: string; column: number; row: number; x: number; y: number }
export interface TechEdgeLayout { from: string; to: string; x1: number; y1: number; x2: number; y2: number }
export interface TechTreeLayout {
  nodes: Record<string, TechNodeLayout>
  edges: TechEdgeLayout[]
  width: number
  height: number
}

/** Columns by prerequisite depth, rows ordered by a barycenter heuristic to limit edge crossings. */
export function layoutTechTree(techs: Techs): TechTreeLayout {
  const ids = Object.keys(techs).sort()
  if (ids.length === 0) return { nodes: {}, edges: [], width: 0, height: 0 }

  const depths = techDepths(techs)
  const maxCol = Math.max(...depths.values())
  const columns: string[][] = Array.from({ length: maxCol + 1 }, () => [])
  for (const id of ids) columns[depths.get(id)!].push(id)
  const byName = (a: string, b: string) => techs[a].name.localeCompare(techs[b].name) || (a < b ? -1 : a > b ? 1 : 0)
  for (const col of columns) col.sort(byName)

  // Dependents per technology, only across columns (cycle back-edges are dropped).
  const dependents = new Map<string, string[]>(ids.map(id => [id, []]))
  const prereqs = new Map<string, string[]>()
  for (const id of ids) {
    const ps = techs[id].prerequisites.filter(p => techs[p] && depths.get(p)! < depths.get(id)!)
    prereqs.set(id, ps)
    for (const p of ps) dependents.get(p)!.push(id)
  }

  const rowOf = new Map<string, number>()
  const reindex = (col: string[]) => col.forEach((id, i) => rowOf.set(id, i))
  columns.forEach(reindex)

  function sweep(c: number, neighbours: Map<string, string[]>) {
    const col = columns[c]
    const key = new Map<string, number>()
    for (const id of col) {
      const ns = neighbours.get(id)!
      key.set(id, ns.length === 0 ? rowOf.get(id)! : ns.reduce((s, n) => s + rowOf.get(n)!, 0) / ns.length)
    }
    col.sort((a, b) => key.get(a)! - key.get(b)! || rowOf.get(a)! - rowOf.get(b)! || (a < b ? -1 : a > b ? 1 : 0))
    reindex(col)
  }
  for (let iter = 0; iter < 4; iter++) {
    for (let c = 1; c <= maxCol; c++) sweep(c, prereqs)
    for (let c = maxCol - 1; c >= 0; c--) sweep(c, dependents)
  }

  const nodes: Record<string, TechNodeLayout> = {}
  let maxRows = 0
  columns.forEach((col, c) => {
    maxRows = Math.max(maxRows, col.length)
    col.forEach((id, r) => {
      nodes[id] = { id, column: c, row: r, x: c * (CARD_W + COL_GAP), y: r * (CARD_H + ROW_GAP) }
    })
  })

  const edges: TechEdgeLayout[] = []
  for (const id of ids) {
    for (const p of prereqs.get(id)!) {
      const a = nodes[p]
      const b = nodes[id]
      edges.push({ from: p, to: id, x1: a.x + CARD_W, y1: a.y + CARD_H / 2, x2: b.x, y2: b.y + CARD_H / 2 })
    }
  }

  return {
    nodes,
    edges,
    width: (maxCol + 1) * (CARD_W + COL_GAP) - COL_GAP,
    height: maxRows * (CARD_H + ROW_GAP) - ROW_GAP,
  }
}

/**
 * State of every technology under a horizon: researched (in the targets' closure),
 * available (all known prerequisites researched) or locked. With no valid target
 * nothing is researched and the roots are available.
 */
export function techStates(gameData: GameData, targetIds: readonly string[]): Record<string, TechState> {
  const closure = technologyClosure(gameData, targetIds)
  const states: Record<string, TechState> = {}
  for (const [id, tech] of Object.entries(gameData.technologies)) {
    if (closure.has(id)) states[id] = 'researched'
    else if (tech.prerequisites.every(p => !gameData.technologies[p] || closure.has(p))) states[id] = 'available'
    else states[id] = 'locked'
  }
  return states
}

/**
 * Technologies whose name contains the query (case-insensitive, trimmed). A leveled
 * name such as "Toolbelt 5" is matched whole. Names starting with the query come
 * first; each group is sorted by name, numbers compared numerically. A blank query
 * matches nothing.
 */
export function searchTechnologies(technologies: Techs, query: string): Technology[] {
  const q = query.trim().toLowerCase()
  if (q === '') return []
  const byName = (a: Technology, b: Technology) => a.name.localeCompare(b.name, undefined, { numeric: true })
  const prefix: Technology[] = []
  const infix: Technology[] = []
  for (const t of Object.values(technologies)) {
    const name = t.name.toLowerCase()
    if (name.startsWith(q)) prefix.push(t)
    else if (name.includes(q)) infix.push(t)
  }
  return [...prefix.sort(byName), ...infix.sort(byName)]
}
