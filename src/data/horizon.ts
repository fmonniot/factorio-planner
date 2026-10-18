import type { GameData, Machine } from './types'

export function hasTechnologies(gameData: GameData): boolean {
  return Object.keys(gameData.technologies).length > 0
}

/** The targets plus all their transitive prerequisites. Unknown ids are ignored. */
export function technologyClosure(gameData: GameData, targetIds: readonly string[]): Set<string> {
  const visited = new Set<string>()
  const stack = [...targetIds]
  while (stack.length > 0) {
    const id = stack.pop()!
    const tech = gameData.technologies[id]
    if (!tech || visited.has(id)) continue
    visited.add(id)
    stack.push(...tech.prerequisites)
  }
  return visited
}

/**
 * Recipes offered under a research horizon: those available at game start plus
 * those unlocked by a targeted technology or one of its prerequisites, plus
 * extraction recipes, which need no research (their machines are gated like any
 * other). Returns null (= no limit) when the data set has no technology data or
 * no target is a known technology.
 */
export function availableRecipeIds(gameData: GameData, targetIds: readonly string[]): Set<string> | null {
  if (!hasTechnologies(gameData)) return null
  const closure = technologyClosure(gameData, targetIds)
  if (closure.size === 0) return null
  const available = new Set(gameData.startingRecipes)
  for (const id of closure) {
    for (const recipeId of gameData.technologies[id].unlockedRecipes) available.add(recipeId)
  }
  for (const r of Object.values(gameData.recipes)) if (r.extraction) available.add(r.id)
  return available
}

/**
 * Items a research horizon leaves offered as goals: items no recipe produces
 * and those with at least one non-hidden producing recipe inside the horizon. Hidden recipes are ignored
 * entirely: an item only hidden recipes produce counts as having no producer
 * (always offered), and a hidden recipe never rescues an item whose non-hidden
 * producers are all outside the horizon. Returns null (= no limit) when
 * `recipeIds` is null.
 */
export function availableItemIds(gameData: GameData, recipeIds: ReadonlySet<string> | null): Set<string> | null {
  if (!recipeIds) return null
  const produced = new Set<string>()
  const reachable = new Set<string>()
  for (const r of Object.values(gameData.recipes)) {
    if (r.hidden) continue
    const inside = recipeIds.has(r.id)
    for (const p of r.products) {
      produced.add(p.itemId)
      if (inside) reachable.add(p.itemId)
    }
  }
  return new Set(Object.keys(gameData.items).filter(id => !produced.has(id) || reachable.has(id)))
}

/** True when there is no limit, no id to check, or the id is inside the set. */
export function withinHorizon(ids: ReadonlySet<string> | null, id: string | undefined): boolean {
  return ids === null || id === undefined || ids.has(id)
}

/**
 * Entity id -> ids of the items that place it. Uses `Item.placeResult`; when no
 * item in the bundle has it (older bundles), falls back to the item with the
 * same id as the entity.
 */
export function placingItemIds(gameData: GameData): Map<string, string[]> {
  const placers = new Map<string, string[]>()
  const items = Object.values(gameData.items)
  if (items.some(i => i.placeResult !== undefined)) {
    for (const item of items) {
      if (item.placeResult === undefined) continue
      const list = placers.get(item.placeResult)
      if (list) list.push(item.id)
      else placers.set(item.placeResult, [item.id])
    }
    return placers
  }
  for (const id of [...Object.keys(gameData.machines), ...Object.keys(gameData.beacons)]) {
    if (id in gameData.items) placers.set(id, [id])
  }
  return placers
}

/**
 * Items an entity may be built or inserted from under a horizon: the offered items
 * (`itemIds`), minus hidden items that no non-hidden recipe makes. A hidden item
 * nothing craftable produces is never obtainable, however `availableItemIds` treats it.
 */
function obtainableItemIds(gameData: GameData, itemIds: ReadonlySet<string>): Set<string> {
  const craftable = new Set<string>()
  for (const r of Object.values(gameData.recipes)) {
    if (r.hidden) continue
    for (const p of r.products) craftable.add(p.itemId)
  }
  const result = new Set<string>()
  for (const id of itemIds) {
    const item = gameData.items[id]
    if (item?.hidden && !craftable.has(id)) continue
    result.add(id)
  }
  return result
}

/**
 * An entity with no known placing item is never gated; otherwise one of its placing
 * items must be obtainable (see `obtainableItemIds`).
 */
function entityAvailable(
  placers: ReadonlyMap<string, string[]>,
  entityId: string,
  obtainable: ReadonlySet<string>,
): boolean {
  const items = placers.get(entityId)
  return !items || items.some(id => obtainable.has(id))
}

/**
 * Machines (hidden ones included) whose placing item is obtainable; null = no limit.
 * `placers` lets a caller that already built `placingItemIds` reuse it.
 */
export function availableMachineIds(
  gameData: GameData,
  itemIds: ReadonlySet<string> | null,
  placers: ReadonlyMap<string, string[]> = placingItemIds(gameData),
): Set<string> | null {
  if (!itemIds) return null
  const obtainable = obtainableItemIds(gameData, itemIds)
  return new Set(Object.keys(gameData.machines).filter(id => entityAvailable(placers, id, obtainable)))
}

/** Beacons whose placing item is obtainable; null = no limit. */
export function availableBeaconIds(
  gameData: GameData,
  itemIds: ReadonlySet<string> | null,
  placers: ReadonlyMap<string, string[]> = placingItemIds(gameData),
): Set<string> | null {
  if (!itemIds) return null
  const obtainable = obtainableItemIds(gameData, itemIds)
  return new Set(Object.keys(gameData.beacons).filter(id => entityAvailable(placers, id, obtainable)))
}

/** Modules that are obtainable (a module id that is not an item is never gated); null = no limit. */
export function availableModuleIds(gameData: GameData, itemIds: ReadonlySet<string> | null): Set<string> | null {
  if (!itemIds) return null
  const obtainable = obtainableItemIds(gameData, itemIds)
  return new Set(
    Object.keys(gameData.modules).filter(id => !(id in gameData.items) || obtainable.has(id)),
  )
}

/**
 * Default machine per category under a horizon: the static default when it is
 * available and not hidden, else the fastest available non-hidden machine of the category, else
 * no key (every reader treats a missing default as "no machine"). Returns
 * `gameData.defaultMachines` itself when there is no limit.
 */
export function horizonDefaultMachines(
  gameData: GameData,
  machineIds: ReadonlySet<string> | null,
): Record<string, string> {
  if (!machineIds) return gameData.defaultMachines
  const result: Record<string, string> = {}
  for (const [category, staticId] of Object.entries(gameData.defaultMachines)) {
    if (machineIds.has(staticId) && !gameData.machines[staticId]?.hidden) {
      result[category] = staticId
      continue
    }
    let best: Machine | undefined
    for (const m of Object.values(gameData.machines)) {
      if (m.hidden || !machineIds.has(m.id) || !m.craftingCategories.includes(category)) continue
      if (!best || m.craftingSpeed > best.craftingSpeed) best = m
    }
    if (best) result[category] = best.id
  }
  return result
}

export interface Horizon {
  recipeIds: Set<string> | null
  itemIds: Set<string> | null
  machineIds: Set<string> | null
  beaconIds: Set<string> | null
  moduleIds: Set<string> | null
  /** category -> machine id. === gameData.defaultMachines when there is no limit; otherwise a
   *  category whose machines are all outside the horizon has no key. */
  defaultMachines: Record<string, string>
}

export function computeHorizon(gameData: GameData, targetIds: readonly string[]): Horizon {
  const recipeIds = availableRecipeIds(gameData, targetIds)
  const itemIds = availableItemIds(gameData, recipeIds)
  const placers = placingItemIds(gameData)
  const machineIds = availableMachineIds(gameData, itemIds, placers)
  return {
    recipeIds,
    itemIds,
    machineIds,
    beaconIds: availableBeaconIds(gameData, itemIds, placers),
    moduleIds: availableModuleIds(gameData, itemIds),
    defaultMachines: horizonDefaultMachines(gameData, machineIds),
  }
}

export interface RowMachine {
  machineId: string | undefined
  machine: Machine | undefined
  /** The resolved machine (explicit or default) exists and is outside the horizon. */
  beyondHorizon: boolean
  /** No explicit machine, the data has a default for the category, and the horizon removed it. */
  noMachineInHorizon: boolean
}

/** The machine a row uses (explicit ?? horizon default), with its horizon flags. */
export function resolveRowMachine(
  gameData: GameData,
  horizon: Horizon,
  category: string,
  machineId: string | undefined,
): RowMachine {
  const id = machineId ?? horizon.defaultMachines[category]
  const machine = id ? gameData.machines[id] : undefined
  return {
    machineId: id,
    machine,
    beyondHorizon: machine !== undefined && !withinHorizon(horizon.machineIds, id),
    noMachineInHorizon:
      machineId === undefined &&
      horizon.machineIds !== null &&
      category in gameData.defaultMachines &&
      !(category in horizon.defaultMachines),
  }
}
