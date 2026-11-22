import type { FluidTag, GameData, Ingredient, Item, RecipeProduct } from './types'
import { HEAT_ITEM_ID } from './electricity'
import { effectiveTemperature, fmtTemperatureRange, hasTemperatureBound, isBound } from './temperature'

// ---------------------------------------------------------------------------
// Flow keys: a fluid some recipe bounds the temperature of is split in the solver into one key per
// temperature it is made at (`steam@165`, `steam@?` when unknown) and one per range a row accepts
// (`steam[465,]`, `steam[,]` for any). A plain item's key is its id. No game item id contains
// '@', '[' or ']' (GameDataSchema rejects one), so a key parses back unambiguously.
// ---------------------------------------------------------------------------

/** Slack when comparing a temperature to a bound (the same as `acceptsTemperature`). */
const FIT_EPSILON = 1e-9

/** The key of `itemId` carrying `tag`: the id itself with no tag. */
export function flowKey(itemId: string, tag?: FluidTag): string {
  if (tag === undefined) return itemId
  if ('at' in tag) return `${itemId}@${tag.at === null ? '?' : String(tag.at)}`
  return `${itemId}[${tag.min ?? ''},${tag.max ?? ''}]`
}

/** Inverse of `flowKey`: the base item id and, for a flow key, its tag (absent sides of a range stay absent). */
export function parseFlowKey(key: string): { itemId: string; tag?: FluidTag } {
  if (key.endsWith(']')) {
    const open = key.indexOf('[')
    if (open >= 0) {
      const [lo, hi] = key.slice(open + 1, -1).split(',')
      const tag: { min?: number; max?: number } = {}
      if (lo !== undefined && lo !== '') tag.min = Number(lo)
      if (hi !== undefined && hi !== '') tag.max = Number(hi)
      return { itemId: key.slice(0, open), tag }
    }
  }
  const at = key.lastIndexOf('@')
  if (at >= 0) {
    const t = key.slice(at + 1)
    return { itemId: key.slice(0, at), tag: { at: t === '?' ? null : Number(t) } }
  }
  return { itemId: key }
}

/** A made temperature (`{ at }`, null when unknown) as opposed to a range. */
export function isTemperatureTag(tag: FluidTag): tag is { at: number | null } {
  return 'at' in tag
}

/** The range an ingredient accepts: the sides with a real bound. */
export function rangeOf(ing: Pick<Ingredient, 'minimumTemperature' | 'maximumTemperature'>): { min?: number; max?: number } {
  const range: { min?: number; max?: number } = {}
  if (isBound(ing.minimumTemperature)) range.min = ing.minimumTemperature
  if (isBound(ing.maximumTemperature)) range.max = ing.maximumTemperature
  return range
}

/** The temperature a product is made at: its own, else the fluid's default, else unknown; heat is always unknown. */
export function productTag(
  prod: Pick<RecipeProduct, 'itemId' | 'temperature'>,
  item: Pick<Item, 'defaultTemperature'> | undefined,
): { at: number | null } {
  if (prod.itemId === HEAT_ITEM_ID) return { at: null }
  return { at: effectiveTemperature(prod, item) ?? null }
}

/**
 * Does a flow carrying `tag` fit a row that accepts `range`? Unknown fits every range. A temperature fits when it lies
 * inside (1e-9 slack). A range fits when it lies inside `range`: a delivery requested for one range can feed a wider one.
 */
export function fitsRange(tag: FluidTag, range: { min?: number; max?: number }): boolean {
  if (isTemperatureTag(tag)) {
    if (tag.at === null) return true
    if (range.min !== undefined && tag.at < range.min - FIT_EPSILON) return false
    if (range.max !== undefined && tag.at > range.max + FIT_EPSILON) return false
    return true
  }
  const lowerOk = range.min === undefined || (tag.min !== undefined && tag.min >= range.min - FIT_EPSILON)
  const upperOk = range.max === undefined || (tag.max !== undefined && tag.max <= range.max + FIT_EPSILON)
  return lowerOk && upperOk
}

/** "500°C", "≥465°C", "≤50°C", "125–165°C"; '' for no tag, an unknown temperature or any (`{}`). */
export function fmtFluidTag(tag: FluidTag | undefined): string {
  if (tag === undefined) return ''
  if (isTemperatureTag(tag)) return tag.at === null ? '' : fmtTemperatureRange(tag.at, tag.at) ?? ''
  return fmtTemperatureRange(tag.min, tag.max) ?? ''
}

const splitCache = new WeakMap<GameData, ReadonlySet<string>>()

/** The fluids some recipe bounds an ingredient temperature of: the ones the solver splits into flow keys (once per data set). */
export function splitFluids(gameData: GameData): ReadonlySet<string> {
  let set = splitCache.get(gameData)
  if (!set) {
    const s = new Set<string>()
    for (const r of Object.values(gameData.recipes)) {
      for (const ing of r.ingredients) if (hasTemperatureBound(ing)) s.add(ing.itemId)
    }
    set = s
    splitCache.set(gameData, set)
  }
  return set
}

/** Σ over the keys of each base item (signed): an item's net or gross over all its temperatures and ranges. */
export function sumByItem(map: ReadonlyMap<string, number>): Map<string, number> {
  const out = new Map<string, number>()
  for (const [key, v] of map) {
    const id = parseFlowKey(key).itemId
    out.set(id, (out.get(id) ?? 0) + v)
  }
  return out
}

/** What a block offers per base item: a plain key as it is, a flow key's positive part summed into its item. */
export function offerByItem(map: ReadonlyMap<string, number>): Map<string, number> {
  const out = new Map<string, number>()
  for (const [key, v] of map) {
    const { itemId, tag } = parseFlowKey(key)
    if (tag === undefined) out.set(itemId, (out.get(itemId) ?? 0) + v)
    else out.set(itemId, (out.get(itemId) ?? 0) + Math.max(0, v))
  }
  return out
}

export type FluidRange = { min?: number; max?: number }

/**
 * The order a split fluid's parts are listed in: made temperatures ascending (unknown last), then ranges by minimum (open first),
 * then by maximum (open last).
 */
export function compareTags(a: FluidTag, b: FluidTag): number {
  const ta = isTemperatureTag(a)
  const tb = isTemperatureTag(b)
  if (ta !== tb) return ta ? -1 : 1
  if (isTemperatureTag(a) && isTemperatureTag(b)) {
    if (a.at === b.at) return 0
    if (a.at === null) return 1
    if (b.at === null) return -1
    return a.at - b.at
  }
  const ra = a as FluidRange
  const rb = b as FluidRange
  const minA = ra.min ?? -Infinity
  const minB = rb.min ?? -Infinity
  if (minA !== minB) return minA < minB ? -1 : 1
  const maxA = ra.max ?? Infinity
  const maxB = rb.max ?? Infinity
  return maxA === maxB ? 0 : maxA < maxB ? -1 : 1
}

/** How many of the plan's `ranges` of a fluid `tag` fits: the larger, the more rows could take it. */
export function versatility(tag: FluidTag, ranges: readonly FluidRange[]): number {
  let n = 0
  for (const r of ranges) if (fitsRange(tag, r)) n++
  return n
}

/** How many of the plan's `ranges` contain `range` (itself included): a narrower range is deeper. */
export function rangeDepth(range: FluidRange, ranges: readonly FluidRange[]): number {
  return versatility(range, ranges)
}

/** The keys of `map` that belong to `itemId`: a plain item is its own key. */
export function keysOfItem(map: ReadonlyMap<string, unknown>, itemId: string): string[] {
  const out: string[] = []
  for (const key of map.keys()) if (key === itemId || parseFlowKey(key).itemId === itemId) out.push(key)
  return out
}

/** Σ of `map` over the keys of `itemId`. */
export function sumOfItem(map: ReadonlyMap<string, number> | undefined, itemId: string): number {
  let total = 0
  for (const [key, v] of map ?? []) if (key === itemId || parseFlowKey(key).itemId === itemId) total += v
  return total
}
