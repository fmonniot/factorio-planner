import type { FluidTag, GameData, GameRecipeNode, Ingredient, Recipe, RecipeProduct } from '../data/types'
import type { NodeEffects } from './effects'
import { HEAT_ITEM_ID } from '../data/electricity'
import { fitsRange, flowKey, isTemperatureTag, parseFlowKey, productTag, rangeOf, splitFluids, type FluidRange } from '../data/flowKey'

// ---------------------------------------------------------------------------
// Item classification for the LP solver
//
// Categories:
//   goal        — item appears in the goals map
//   intermediate — produced AND consumed by at least one active recipe
//   raw         — no producer in the active recipe set (external source)
//   byproduct   — no consumer in the active recipe set (excluded from LP)
//
// Net stoichiometry S[i][j]: positive means produced, negative means consumed.
// ---------------------------------------------------------------------------

export interface ItemClassification {
  goals: Map<string, number>       // itemId → required rate
  intermediates: Set<string>       // must balance (≥ 0)
  raw: Set<string>                 // sourced externally
  byproducts: Set<string>          // no consumer — omitted from LP rows
}

/** What a flow key of a split fluid is: its base item, its tag, and (area-qualified range keys) the one area that takes it. */
export interface FlowKeyInfo {
  itemId: string
  tag: FluidTag
  area?: number
  /** A key a connection supplies (its tag is the offered key's; see `FluidKeySupply`): it has a hard row and never converts into a goal key. */
  supplied?: true
}

/**
 * What the connections offer of one split fluid to a block (built by `solveAll`): the ranges of the fluid across the plan (for
 * versatility and depth, see `SUPPLY_TIE_COST`) and each connection's offer per offered key.
 */
export interface FluidKeySupply {
  /** the distinct ranges the plan's rows take of the fluid, sorted by flow key */
  ranges: FluidRange[]
  /** per connection and offered key (a made temperature, or a range key for a request); `offer` is already capped by `maxRate`, above `FLOW_TOLERANCE` */
  offers: { connectionId: string; tag: FluidTag; offer: number }[]
  /** connection id → `maxRate`, for the connections that have one */
  maxRates: [string, number][]
}

/** split fluid → what its connections offer */
export type KeySupply = ReadonlyMap<string, FluidKeySupply>

/** A conversion column: takes 1 of the key `from` and gives 1 of the key `to` (a temperature that fits a range). */
export interface ConversionColumn { itemId: string; from: string; to: string; area?: number }

/** The flow keys of a system (see src/data/flowKey.ts); absent when the block has no split fluid. */
export interface FlowKeys {
  /** every flow key of the system (goal keys too) */
  info: Map<string, FlowKeyInfo>
  /** base item → its keys, first-seen order */
  keysOf: Map<string, string[]>
  /** column id → conversion; the columns are also in `ClassifiedSystem.recipes` and `S` */
  conversions: Map<string, ConversionColumn>
  /** supplied split fluid → its offer (the cap of the group row over its range keys' supplies); the item-level path of probes and direct callers */
  offers: Map<string, number>
  /** supplied key → the fluid and offered key it carries (and its area, in an area system); every supplied key has a hard row and conversions into the range keys it fits */
  supply: Map<string, { fluid: string; offeredKey: string; area?: number }>
  /** the fluids that got supplied keys */
  keySupply: KeySupply
}

export interface ClassifiedSystem {
  /** Net stoichiometry coefficient S[itemId][recipeId] */
  S: Map<string, Map<string, number>>
  /** Ordered recipe ids (conversion columns last) */
  recipes: string[]
  classification: ItemClassification
  /** The flow keys of the split fluids the columns make or take; absent when there are none. */
  flow?: FlowKeys
}

/** What one column makes and takes of split fluids (the amounts `S` would hold if they were plain items). */
export interface SplitUse {
  colId: string
  /** the area of the column (area systems) */
  area?: number
  made: { itemId: string; tag: { at: number | null }; amount: number }[]
  taken: { itemId: string; range: { min?: number; max?: number }; amount: number }[]
}

/**
 * Compute the effective product amount accounting for probability and
 * productivity (only the amount above ignoredByProductivity scales).
 */
export function effectiveProductAmount(
  amount: number,
  probability = 1,
  ignoredByProductivity = 0,
  productivityBonus = 0,
): number {
  const fixed = ignoredByProductivity
  const scalable = amount - ignoredByProductivity
  return (fixed + scalable * (1 + productivityBonus)) * probability
}

/**
 * Effective amount of one product per execution of a row: probability and
 * productivity, then the reactor neighbour bonus for the heat product.
 */
export function rowProductAmount(
  prod: RecipeProduct,
  productivityBonus = 0,
  heatBonus = 0,
): number {
  const amount = effectiveProductAmount(
    prod.amount ?? 0,
    prod.probability ?? 1,
    prod.ignoredByProductivity ?? 0,
    productivityBonus,
  )
  return prod.itemId === HEAT_ITEM_ID ? amount * (1 + heatBonus) : amount
}

/** A row's ingredients: the recipe's plus the fuel a burner row burns (per execution). */
export function rowIngredients(recipe: Recipe, effects: { fuel?: Ingredient } | undefined): Ingredient[] {
  return effects?.fuel ? [...recipe.ingredients, effects.fuel] : recipe.ingredients
}

/**
 * The ingredients a byproduct-consumer row locks against import: the recipe's, plus its fuel only when
 * the user picked that fuel (`fuelItemId`). The automatic default fuel stays importable.
 */
export function lockedIngredients(recipe: Recipe, effects: { fuel?: Ingredient } | undefined, node: GameRecipeNode): Ingredient[] {
  const fuel = effects?.fuel
  return fuel && node.fuelItemId === fuel.itemId ? [...recipe.ingredients, fuel] : recipe.ingredients
}

/** What `buildClassifiedSystem` reads of a recipe's row effects; `fuel` may list several (areas: one per column). */
export type RowEffects = Pick<NodeEffects, 'productivityBonus' | 'heatBonus'> & { fuel?: Ingredient | Ingredient[] }

/** Options of `buildClassifiedSystem` that few callers set. */
export interface ClassifiedOptions {
  /** Offers of connected items: a split fluid's offer becomes the cap of the group row over its range keys. */
  supplyCaps?: ReadonlyMap<string, number>
  /** What connections offer of a split fluid per key: each offered key becomes a supplied key (`FlowKeyInfo.supplied`). Wins over `supplyCaps` for the same fluid. */
  keySupply?: KeySupply
  /** false: leave the split fluids' flow keys to the caller (the area column system builds them per area). Default true. */
  splitKeys?: boolean
}

/** Offers below this are no offer (the same as `FLOW_TOLERANCE` of blockResult.ts, which imports this module). */
const OFFER_TOLERANCE = 1e-6

/**
 * Build the net stoichiometry map and classify items for the LP. A fluid some recipe bounds the
 * temperature of (`splitFluids`) is not an item here: its products and ingredients become flow keys,
 * one per temperature made and one per range taken, linked by conversion columns (`addFlowKeys`).
 */
export function buildClassifiedSystem(
  gameData: GameData,
  recipeIds: string[],
  goalsMap: Map<string, number>,
  /** Per recipe: its row's productivity, heat bonus and fuel (an ingredient that is not the recipe's own). */
  effectsMap: Map<string, RowEffects> = new Map(),
  options: ClassifiedOptions = {},
): ClassifiedSystem {
  const split = splitFluids(gameData)
  const keyed = options.splitKeys !== false
  const producers = new Map<string, Set<string>>() // itemId → recipeIds that produce it
  const consumers = new Map<string, Set<string>>() // itemId → recipeIds that consume it
  const uses: SplitUse[] = []

  // S[itemId][recipeId] = net items per recipe execution (net = produced - consumed)
  const S = new Map<string, Map<string, number>>()

  function addCoeff(itemId: string, recipeId: string, delta: number) {
    if (!S.has(itemId)) S.set(itemId, new Map())
    S.get(itemId)!.set(recipeId, (S.get(itemId)!.get(recipeId) ?? 0) + delta)
  }

  for (const recipeId of recipeIds) {
    const recipe = gameData.recipes[recipeId]
    if (!recipe) continue
    const rowEffects = effectsMap.get(recipeId)
    const prodBonus = rowEffects?.productivityBonus ?? 0
    const fuel = rowEffects?.fuel
    const use: SplitUse = { colId: recipeId, made: [], taken: [] }

    for (const prod of recipe.products) {
      const amount = rowProductAmount(prod, prodBonus, rowEffects?.heatBonus ?? 0)
      if (amount > 0) {
        if (split.has(prod.itemId)) {
          use.made.push({ itemId: prod.itemId, tag: productTag(prod, gameData.items[prod.itemId]), amount })
          continue
        }
        addCoeff(prod.itemId, recipeId, amount)
        if (!producers.has(prod.itemId)) producers.set(prod.itemId, new Set())
        producers.get(prod.itemId)!.add(recipeId)
      }
    }

    for (const ing of [...recipe.ingredients, ...(fuel === undefined ? [] : Array.isArray(fuel) ? fuel : [fuel])]) {
      if (ing.amount > 0) {
        if (split.has(ing.itemId)) {
          use.taken.push({ itemId: ing.itemId, range: rangeOf(ing), amount: ing.amount })
          continue
        }
        addCoeff(ing.itemId, recipeId, -ing.amount)
        if (!consumers.has(ing.itemId)) consumers.set(ing.itemId, new Set())
        consumers.get(ing.itemId)!.add(recipeId)
      }
    }
    if (use.made.length > 0 || use.taken.length > 0) uses.push(use)
  }

  // Collect all items mentioned
  const allItems = new Set<string>([...producers.keys(), ...consumers.keys()])

  // A goal on a split fluid is a goal on the key of its range (`item[,]` for any temperature). `goalsMap` is keyed by the item id,
  // or by the flow key of a ranged goal (see `goalMapKey` in flowKeys.ts).
  const goals = new Map<string, number>()
  const goalKeys: { itemId: string; key: string; range: FluidRange }[] = []
  for (const [id, rate] of goalsMap) {
    const { itemId, tag } = parseFlowKey(id)
    if (!split.has(itemId)) {
      goals.set(id, rate)
      continue
    }
    const key = tag === undefined ? flowKey(itemId, {}) : id
    goals.set(key, rate)
    goalKeys.push({ itemId, key, range: tag === undefined ? {} : (tag as FluidRange) })
  }
  const intermediates = new Set<string>()
  const raw = new Set<string>()
  const byproducts = new Set<string>()

  for (const itemId of allItems) {
    if (goals.has(itemId)) continue // goal takes priority
    const hasProducer = (producers.get(itemId)?.size ?? 0) > 0
    const hasConsumer = (consumers.get(itemId)?.size ?? 0) > 0

    if (!hasProducer) {
      raw.add(itemId)
    } else if (!hasConsumer) {
      byproducts.add(itemId)
    } else {
      intermediates.add(itemId)
    }
  }

  const system: ClassifiedSystem = {
    S, recipes: recipeIds, classification: { goals, intermediates, raw, byproducts },
  }
  if (keyed) {
    const offers = new Map<string, number>()
    const used = new Set(uses.flatMap(u => [...u.made, ...u.taken].map(x => x.itemId)))
    for (const [id, cap] of options.supplyCaps ?? []) {
      if (split.has(id) && cap > OFFER_TOLERANCE && used.has(id) && !options.keySupply?.has(id)) offers.set(id, cap)
    }
    const flow = addFlowKeys(system, uses, { goalKeys, areas: false, offers, keySupply: options.keySupply })
    if (flow) {
      system.flow = flow
      system.recipes = [...recipeIds, ...flow.conversions.keys()]
    }
  }
  return system
}

/**
 * Adds the flow keys of the split fluids to `system` (its `S` and `classification`, in place) and returns them, or
 * undefined when there is nothing to add. A made temperature is the key `item@T` (`@?` unknown), a taken range
 * `item[min,max]` (with `areas`, `#<area>` is appended: a range key belongs to the one area that takes it), a goal
 * `item[,]` (never qualified). A conversion column `conv:<from>→<to>` takes one of a temperature key and gives one of
 * a range key it fits; the goal key gets one from every temperature (in areas, one per area that makes the temperature,
 * converting there). The returned `conversions` columns are not added to `system.recipes`: the caller does that.
 */
export function addFlowKeys(
  system: Pick<ClassifiedSystem, 'S' | 'classification'>,
  uses: SplitUse[],
  options: { goalKeys: { itemId: string; key: string; range: FluidRange }[]; areas: boolean; offers: Map<string, number>; keySupply?: KeySupply },
): FlowKeys | undefined {
  const { S, classification } = system
  const { goalKeys, areas, offers } = options
  const keySupply = options.keySupply ?? new Map<string, FluidKeySupply>()
  if (uses.length === 0 && goalKeys.length === 0) return undefined
  const info = new Map<string, FlowKeyInfo>()
  const keysOf = new Map<string, string[]>()
  const register = (key: string, itemId: string, tag: FluidTag, area?: number): void => {
    if (info.has(key)) return
    info.set(key, { itemId, tag, ...(area !== undefined ? { area } : {}) })
    const list = keysOf.get(itemId)
    if (list) list.push(key)
    else keysOf.set(itemId, [key])
  }
  const addCoeff = (key: string, colId: string, delta: number) => {
    if (!S.has(key)) S.set(key, new Map())
    const row = S.get(key)!
    row.set(colId, (row.get(colId) ?? 0) + delta)
  }
  // Which areas make a temperature key, in use order.
  const madeIn = new Map<string, number[]>()
  for (const use of uses) {
    for (const m of use.made) {
      const key = flowKey(m.itemId, m.tag)
      register(key, m.itemId, m.tag)
      addCoeff(key, use.colId, m.amount)
      if (areas && use.area !== undefined) {
        const list = madeIn.get(key) ?? []
        if (!list.includes(use.area)) list.push(use.area)
        madeIn.set(key, list)
      }
    }
    for (const t of use.taken) {
      const key = flowKey(t.itemId, t.range) + (areas && use.area !== undefined ? `#${use.area}` : '')
      register(key, t.itemId, t.range, areas ? use.area : undefined)
      addCoeff(key, use.colId, -t.amount)
    }
  }
  const goalKeysOf = new Map<string, string[]>() // item → its goal keys
  for (const g of goalKeys) {
    register(g.key, g.itemId, g.range)
    goalKeysOf.set(g.itemId, [...(goalKeysOf.get(g.itemId) ?? []), g.key])
  }
  const goalKeySet = new Set(goalKeys.map(g => g.key))

  // Conversion columns, per fluid.
  const conversions = new Map<string, ConversionColumn>()
  const convert = (itemId: string, from: string, to: string, area: number | undefined, id = `conv:${from}→${to}`): void => {
    if (conversions.has(id)) return
    conversions.set(id, { itemId, from, to, ...(area !== undefined ? { area } : {}) })
    addCoeff(from, id, -1)
    addCoeff(to, id, 1)
  }
  for (const [itemId, keys] of keysOf) {
    const temps = keys.filter(k => isTemperatureTag(info.get(k)!.tag))
    for (const from of temps) {
      const tag = info.get(from)!.tag
      for (const to of keys) {
        const target = info.get(to)!
        if (isTemperatureTag(target.tag)) continue
        // Goal key in areas: converted in each area that makes the temperature (below).
        if (areas && goalKeySet.has(to)) continue
        if (fitsRange(tag, target.tag)) convert(itemId, from, to, target.area)
      }
      if (areas) {
        for (const goalKey of goalKeysOf.get(itemId) ?? []) {
          if (!fitsRange(tag, info.get(goalKey)!.tag as FluidRange)) continue
          for (const a of madeIn.get(from) ?? []) convert(itemId, from, goalKey, a, `conv:${from}→${goalKey}#${a}`)
        }
      }
    }
  }

  // Supplied keys: one per offered key of a connected fluid (and per area that takes a range it fits), converting into every non-goal
  // range key it fits, range to range included. A supplied key never feeds a goal key (a goal gets no supply).
  const supply = new Map<string, { fluid: string; offeredKey: string; area?: number }>()
  for (const [fluid, s] of keySupply) {
    const keys = keysOf.get(fluid)
    if (!keys) continue
    const targets = keys.filter(k => !isTemperatureTag(info.get(k)!.tag) && !goalKeySet.has(k) && !info.get(k)!.supplied)
    const offered = new Map<string, FluidTag>()
    for (const o of s.offers) if (!offered.has(flowKey(fluid, o.tag))) offered.set(flowKey(fluid, o.tag), o.tag)
    for (const [offeredKey, tag] of offered) {
      const fits = targets.filter(t => fitsRange(tag, info.get(t)!.tag as FluidRange))
      const areasOf = areas ? [...new Set(fits.map(t => info.get(t)!.area))] : [undefined]
      for (const a of areasOf) {
        const mine = fits.filter(t => info.get(t)!.area === a)
        if (mine.length === 0) continue
        const key = `${offeredKey}#in${a === undefined ? '' : `#${a}`}`
        register(key, fluid, tag, a)
        info.get(key)!.supplied = true
        supply.set(key, { fluid, offeredKey, ...(a !== undefined ? { area: a } : {}) })
        for (const t of mine) convert(fluid, key, t, a)
      }
    }
  }

  // Classification of the keys, in first-seen order: a goal key stays a goal; a temperature key something converts is an
  // intermediate, any other a byproduct; a range key is an intermediate when the block makes the fluid, else raw.
  const converted = new Set([...conversions.values()].map(c => c.from))
  for (const [key, k] of info) {
    if (classification.goals.has(key)) continue
    if (k.supplied) {
      classification.intermediates.add(key)
    } else if (isTemperatureTag(k.tag)) {
      if (converted.has(key)) classification.intermediates.add(key)
      else classification.byproducts.add(key)
    } else if ((keysOf.get(k.itemId) ?? []).some(x => isTemperatureTag(info.get(x)!.tag) || info.get(x)!.supplied)) {
      classification.intermediates.add(key)
    } else {
      classification.raw.add(key)
    }
  }
  return { info, keysOf, conversions, offers, supply, keySupply }
}

/**
 * Apply `byproductPolicy = 'discard'` of column `colId` to `itemId`: its positive net coefficient
 * becomes 0, so the column neither makes nor takes the item in the LP. A split fluid's discard
 * reaches every flow key of it.
 */
export function discardProduct(system: ClassifiedSystem, itemId: string, colId: string): void {
  for (const key of system.flow?.keysOf.get(itemId) ?? [itemId]) {
    const row = system.S.get(key)
    if (row && (row.get(colId) ?? 0) > 0) row.set(colId, 0)
  }
}
