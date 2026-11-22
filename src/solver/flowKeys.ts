import type { FluidConversion, FluidTag, SolverGoal, SolverWarning } from '../data/types'
import { flowKey, isTemperatureTag } from '../data/flowKey'
import type { ClassifiedSystem } from './build'

// ---------------------------------------------------------------------------
// Helpers over the flow keys of a classified system (`ClassifiedSystem.flow`, see build.ts). Every function is the
// identity on a system without split fluids, so a plain item's key is its id everywhere.
// ---------------------------------------------------------------------------

/** Same as `FLOW_TOLERANCE` of blockResult.ts, which imports this module. */
const CONVERSION_TOLERANCE = 1e-6

/** The base item of a key (a key area-qualified in an area system included). */
export function baseOf(system: Pick<ClassifiedSystem, 'flow'>, key: string): string {
  return system.flow?.info.get(key)?.itemId ?? key
}

/** The tag of a flow key (without its area), undefined for a plain item. */
export function tagOf(system: Pick<ClassifiedSystem, 'flow'>, key: string): FluidTag | undefined {
  return system.flow?.info.get(key)?.tag
}

/** A made temperature (`item@T`), as opposed to a range key or a plain item. */
export function isTemperatureKey(system: Pick<ClassifiedSystem, 'flow'>, key: string): boolean {
  const tag = system.flow?.info.get(key)?.tag
  return tag !== undefined && isTemperatureTag(tag)
}

/** The keys of an item: its flow keys, or itself. */
export function itemKeys(system: Pick<ClassifiedSystem, 'flow'>, itemId: string): string[] {
  return system.flow?.keysOf.get(itemId) ?? [itemId]
}

/** The key a goal on `itemId` is on: `item[,]` for a fluid with flow keys. */
export function goalKey(system: Pick<ClassifiedSystem, 'flow'>, itemId: string): string {
  return system.flow?.keysOf.has(itemId) ? flowKey(itemId, {}) : itemId
}

/** The goals with their item ids replaced by their goal keys. */
export function keyGoals(system: Pick<ClassifiedSystem, 'flow'>, goals: SolverGoal[]): SolverGoal[] {
  if (!system.flow) return goals
  return goals.map(g => ({ ...g, itemId: goalKey(system, g.itemId) }))
}

/** A split base id becomes all its keys except those with an own entry in `own`; any other id stays as it is. */
export function expandToKeys(system: Pick<ClassifiedSystem, 'flow'>, ids: Iterable<string>, own?: Record<string, unknown>): Set<string> {
  const out = new Set<string>()
  for (const id of ids) {
    const keys = system.flow?.keysOf.get(id)
    if (!keys) {
      out.add(id)
      continue
    }
    for (const k of keys) if (!(own && Object.hasOwn(own, k))) out.add(k)
  }
  return out
}

/** The offers per key: a split fluid's offer is the cap of each of its range keys (the group row bounds their sum); a plain item's stays. */
export function keyCaps(system: Pick<ClassifiedSystem, 'flow' | 'classification'>, caps: Map<string, number>): Map<string, number> {
  const out = new Map<string, number>()
  for (const [id, cap] of caps) {
    const keys = system.flow?.keysOf.get(id)
    if (!keys) {
      out.set(id, cap)
      continue
    }
    for (const k of keys) {
      const tag = system.flow!.info.get(k)!.tag
      if (!isTemperatureTag(tag) && !system.classification.goals.has(k)) out.set(k, cap)
    }
  }
  return out
}

/** What leaves the solver for a key: the base item and, for a flow key, its tag. */
export function resultItem(system: Pick<ClassifiedSystem, 'flow'>, key: string): { itemId: string; temp?: FluidTag } {
  const k = system.flow?.info.get(key)
  return k ? { itemId: k.itemId, temp: k.tag } : { itemId: key }
}

/** What was supplied of the fluid of `key`, over all its keys (a plain item: its own). */
export function fluidSupply(system: Pick<ClassifiedSystem, 'flow'>, supply: Map<string, number>, key: string): number {
  let total = 0
  for (const k of itemKeys(system, baseOf(system, key))) total += supply.get(k) ?? 0
  return total
}

/** The conversion columns that ran, as results: above the tolerance, undefined when none. */
export function conversionsOf(
  system: Pick<ClassifiedSystem, 'flow'>,
  throughput: Map<string, number>,
  areaIdOf?: (area: number) => string,
): FluidConversion[] | undefined {
  const out: FluidConversion[] = []
  for (const [col, c] of system.flow?.conversions ?? []) {
    const rate = throughput.get(col) ?? 0
    if (rate <= CONVERSION_TOLERANCE) continue
    out.push({
      itemId: c.itemId,
      from: system.flow!.info.get(c.from)!.tag,
      to: system.flow!.info.get(c.to)!.tag,
      rate,
      ...(c.area !== undefined && areaIdOf ? { areaId: areaIdOf(c.area) } : {}),
    })
  }
  return out.length > 0 ? out : undefined
}

/**
 * `no-fitting-temperature`: a range a row takes that nothing in the block can make a fitting temperature of, that no
 * connection could supply and the block cannot import (it is in `locked`: the keys locked by an Import-off rule, not those
 * locked only because a byproduct consumer takes them, whose row just runs at 0). Merged by (item, range); `recipeIds` are the
 * rows that take it, in column order.
 */
export function noFittingTemperature(
  system: Pick<ClassifiedSystem, 'flow' | 'classification' | 'S' | 'recipes'>,
  locked: Set<string>,
  recipeOf: (columnId: string) => string,
): SolverWarning[] {
  const flow = system.flow
  if (!flow) return []
  const fed = new Set<string>()
  for (const c of flow.conversions.values()) {
    if ([...(system.S.get(c.from) ?? [])].some(([, coeff]) => coeff > 0)) fed.add(c.to)
  }
  const merged = new Map<string, Extract<SolverWarning, { type: 'no-fitting-temperature' }>>()
  for (const key of system.classification.intermediates) {
    const k = flow.info.get(key)
    if (!k || isTemperatureTag(k.tag) || !locked.has(key) || flow.offers.has(k.itemId) || fed.has(key)) continue
    const takers: string[] = []
    for (const col of system.recipes) {
      if (flow.conversions.has(col)) continue
      if ((system.S.get(key)?.get(col) ?? 0) < 0) takers.push(recipeOf(col))
    }
    if (takers.length === 0) continue
    const tag = k.tag as { min?: number; max?: number }
    const id = flowKey(k.itemId, tag)
    const w = merged.get(id) ?? {
      type: 'no-fitting-temperature' as const, itemId: k.itemId,
      ...(tag.min !== undefined ? { min: tag.min } : {}), ...(tag.max !== undefined ? { max: tag.max } : {}), recipeIds: [],
    }
    for (const r of takers) if (!w.recipeIds.includes(r)) w.recipeIds.push(r)
    merged.set(id, w)
  }
  return [...merged.values()]
}
