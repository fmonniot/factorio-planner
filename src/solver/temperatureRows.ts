import type { GameData, Ingredient, Recipe } from '../data/types'
import { acceptsTemperature, effectiveTemperature, hasTemperatureBound } from '../data/temperature'
import { rowProductAmount } from './build'
import type { NodeEffects } from './effects'

// ---------------------------------------------------------------------------
// Fluid temperatures in the LP
//
// A fluid made at several temperatures is one item in the LP (one balance row), but a consumer that
// bounds the temperature it takes can only use some of what is made. `FluidTemperatures` records, for
// each such fluid, who makes it at which temperature and who bounds what; `temperatureRows` turns that
// into extra LP rows (Hall's condition for a supply that can go to any acceptable consumer), so the
// balance cannot be met with the wrong temperature. See spec/solver.md, "Fluid temperatures".
// ---------------------------------------------------------------------------

export interface FluidTemperatures {
  /** What the columns make of the fluid per execution, with the temperature (undefined = unknown, fits any bound). */
  producers: { colId: string; temperature: number | undefined; amount: number }[]
  /** The ingredients that bound the fluid's temperature, per execution. */
  consumers: { colId: string; amount: number; ingredient: Pick<Ingredient, 'minimumTemperature' | 'maximumTemperature'> }[]
}

/** A row of the LP: `Σ coeff_j · x_j + imports ≥ 0` over the columns. */
export type TemperatureRow = Map<string, number>

export interface TemperatureColumn {
  id: string
  recipe: Recipe | undefined
  effects: Pick<NodeEffects, 'productivityBonus' | 'heatBonus'>
}

/**
 * The fluids some column bounds the temperature of and some column makes. Fluids with no
 * bounded consumer, or no producer in the columns (imported, at an unknown temperature), are left out.
 */
export function collectFluidTemperatures(
  gameData: GameData,
  columns: TemperatureColumn[],
): Map<string, FluidTemperatures> | undefined {
  const out = new Map<string, FluidTemperatures>()
  const get = (itemId: string): FluidTemperatures => {
    let f = out.get(itemId)
    if (!f) out.set(itemId, (f = { producers: [], consumers: [] }))
    return f
  }
  for (const col of columns) {
    const recipe = col.recipe
    if (!recipe) continue
    for (const ing of recipe.ingredients) { // a fuel never bounds a temperature
      if (ing.amount > 0 && hasTemperatureBound(ing)) get(ing.itemId).consumers.push({ colId: col.id, amount: ing.amount, ingredient: ing })
    }
  }
  if (out.size === 0) return undefined
  for (const col of columns) {
    const recipe = col.recipe
    if (!recipe) continue
    for (const prod of recipe.products) {
      const f = out.get(prod.itemId)
      if (!f) continue
      const amount = rowProductAmount(prod, col.effects.productivityBonus, col.effects.heatBonus)
      if (amount > 0) f.producers.push({ colId: col.id, temperature: effectiveTemperature(prod, gameData.items[prod.itemId]), amount })
    }
  }
  for (const [itemId, f] of out) if (f.producers.length === 0) out.delete(itemId)
  return out.size > 0 ? out : undefined
}

/** Most distinct consumer classes of one fluid that get every subset checked; beyond it only singletons and the whole. */
const MAX_CLASSES = 8

/**
 * Hall's condition rows of one fluid. Consumers that accept the same set of the temperatures made
 * form a class. For every set C of classes, what is made at a temperature some class of C accepts
 * (plus imports and supply, which fit any bound) must cover what C consumes; a set whose acceptable
 * temperatures include every temperature made is already implied by the item's balance row.
 */
export function temperatureRows(f: FluidTemperatures): TemperatureRow[] {
  const temps = [...new Set(f.producers.map(p => p.temperature).filter((t): t is number => t !== undefined))]
  const classes = new Map<string, { accepted: Set<number>; cons: Map<string, number> }>()
  for (const c of f.consumers) {
    const accepted = temps.filter(t => acceptsTemperature(c.ingredient, t))
    const key = accepted.join(',')
    let cls = classes.get(key)
    if (!cls) classes.set(key, (cls = { accepted: new Set(accepted), cons: new Map() }))
    cls.cons.set(c.colId, (cls.cons.get(c.colId) ?? 0) + c.amount)
  }
  const list = [...classes.values()]
  const subsets: number[][] = []
  if (list.length <= MAX_CLASSES) {
    for (let mask = 1; mask < 1 << list.length; mask++) subsets.push(list.map((_, i) => i).filter(i => mask & (1 << i)))
  } else {
    list.forEach((_, i) => subsets.push([i]))
    subsets.push(list.map((_, i) => i))
  }
  const rows: TemperatureRow[] = []
  for (const subset of subsets) {
    const neighbourhood = new Set<number>()
    for (const i of subset) for (const t of list[i].accepted) neighbourhood.add(t)
    if (neighbourhood.size >= temps.length) continue // implied by the balance row
    const row: TemperatureRow = new Map()
    for (const p of f.producers) {
      if (p.temperature === undefined || neighbourhood.has(p.temperature)) row.set(p.colId, (row.get(p.colId) ?? 0) + p.amount)
    }
    for (const i of subset) for (const [colId, amount] of list[i].cons) row.set(colId, (row.get(colId) ?? 0) - amount)
    rows.push(row)
  }
  return rows
}
