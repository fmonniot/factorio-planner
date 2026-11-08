import type { Ingredient, Item, RecipeProduct } from '../data/types'
import { HEAT_ITEM_ID } from '../data/electricity'
import { acceptsTemperature, effectiveTemperature, hasTemperatureBound } from '../data/temperature'

// ---------------------------------------------------------------------------
// Fluid temperatures in the LP
//
// A fluid made at several temperatures is one item in the LP (one balance row), but a consumer that
// bounds the temperature it takes can only use some of what is made. `FluidTemperatureCollector`
// records, while the stoichiometry is built, who makes each such fluid at which temperature and who
// bounds what; `temperatureRows` turns that into extra LP rows (Hall's condition for a supply that can
// go to any acceptable consumer), so the balance cannot be met with the wrong temperature. See
// spec/solver.md, "Fluid temperatures".
// ---------------------------------------------------------------------------

export interface FluidTemperatures {
  /** What the columns make of the fluid per execution, with the temperature (undefined = unknown, fits any bound). */
  producers: { colId: string; temperature: number | undefined; amount: number }[]
  /** The ingredients that bound the fluid's temperature, per execution. */
  consumers: { colId: string; amount: number; ingredient: Pick<Ingredient, 'minimumTemperature' | 'maximumTemperature'> }[]
}

/** A row of the LP: `Σ coeff_j · x_j + imports ≥ 0` over the columns. */
export type TemperatureRow = Map<string, number>

/**
 * Collects the producers and bounded consumers of fluids from the same calls that fill the
 * stoichiometry (`addProduct` / `addIngredient` with the amounts that go into it).
 */
export class FluidTemperatureCollector {
  private readonly producers: { itemId: string; colId: string; temperature: number | undefined; amount: number }[] = []
  private readonly consumers = new Map<string, FluidTemperatures['consumers']>()

  addProduct(colId: string, prod: RecipeProduct, amount: number, item: Pick<Item, 'defaultTemperature'> | undefined): void {
    if (amount <= 0) return
    // A reactor's heat carries its buffer's maximum, which is not the temperature it settles at: unknown.
    const temperature = prod.itemId === HEAT_ITEM_ID ? undefined : effectiveTemperature(prod, item)
    this.producers.push({ itemId: prod.itemId, colId, temperature, amount })
  }

  addIngredient(colId: string, ing: Ingredient): void {
    if (ing.amount <= 0 || !hasTemperatureBound(ing)) return
    const list = this.consumers.get(ing.itemId) ?? []
    list.push({ colId, amount: ing.amount, ingredient: ing })
    this.consumers.set(ing.itemId, list)
  }

  /** The fluids some column bounds the temperature of and some column makes; undefined when there are none. */
  finish(): Map<string, FluidTemperatures> | undefined {
    const out = new Map<string, FluidTemperatures>()
    for (const [itemId, consumers] of this.consumers) {
      const producers = this.producers.filter(p => p.itemId === itemId).map(({ colId, temperature, amount }) => ({ colId, temperature, amount }))
      if (producers.length > 0) out.set(itemId, { producers, consumers })
    }
    return out.size > 0 ? out : undefined
  }
}

/** Safety net on the number of rows of one fluid; beyond it only single classes are checked (a weaker test). */
const MAX_ROWS = 4096

/**
 * Hall's condition rows of one fluid. Consumers that accept the same set of the temperatures made form
 * a class. For every set of classes that has the same accepted temperatures N (the union of its members'
 * sets, taking every class that fits inside N), what is made at a temperature in N, or at an unknown one,
 * must cover what those classes consume (imports and supply are added by the LP). A N that holds every
 * temperature made is skipped: the item's balance row implies it.
 */
export function temperatureRows(f: FluidTemperatures): TemperatureRow[] {
  const temps = [...new Set(f.producers.map(p => p.temperature).filter((t): t is number => t !== undefined))].sort((a, b) => a - b)
  const classes = new Map<string, { accepted: Set<number>; cons: Map<string, number> }>()
  for (const c of f.consumers) {
    const accepted = temps.filter(t => acceptsTemperature(c.ingredient, t))
    const key = accepted.join(',')
    let cls = classes.get(key)
    if (!cls) classes.set(key, (cls = { accepted: new Set(accepted), cons: new Map() }))
    cls.cons.set(c.colId, (cls.cons.get(c.colId) ?? 0) + c.amount)
  }
  const list = [...classes.values()]

  // Every distinct union of accepted sets, closed under adding one class at a time.
  const unions = new Map<string, Set<number>>()
  const keyOf = (s: Set<number>) => [...s].sort((a, b) => a - b).join(',')
  let complete = true
  outer: for (const cls of list) {
    for (const u of [...unions.values()]) {
      const merged = new Set([...u, ...cls.accepted])
      unions.set(keyOf(merged), merged)
      if (unions.size > MAX_ROWS) { complete = false; break outer }
    }
    unions.set(keyOf(cls.accepted), cls.accepted)
  }
  if (!complete) {
    unions.clear()
    for (const cls of list) unions.set(keyOf(cls.accepted), cls.accepted)
  }

  const rows: TemperatureRow[] = []
  for (const n of unions.values()) {
    if (n.size >= temps.length) continue // implied by the balance row
    const row: TemperatureRow = new Map()
    for (const p of f.producers) {
      if (p.temperature === undefined || n.has(p.temperature)) row.set(p.colId, (row.get(p.colId) ?? 0) + p.amount)
    }
    for (const cls of list) {
      if (![...cls.accepted].every(t => n.has(t))) continue
      for (const [colId, amount] of cls.cons) row.set(colId, (row.get(colId) ?? 0) - amount)
    }
    rows.push(row)
  }
  return rows
}
