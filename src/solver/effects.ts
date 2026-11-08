import type { GameData, GameRecipeNode, Ingredient, Machine } from '../data/types'
import { resolveRowFuel } from '../data/fuel'

// ---------------------------------------------------------------------------
// Module and beacon effects
//
// Computes the effective bonuses (speed, productivity, consumption) for a
// recipe node from its configured machine modules and its beacon configurations.
//
// Machine modules: each module contributes its full effect.
// Beacon modules:  each beacon configuration contributes (the contributions are summed):
//   effect × distributionEfficiency × modulesPerBeacon × beaconCount
//
// All bonuses are additive (summed, then added to 1 for the multiplier).
// Example: 4 prod-3 modules with +10% productivity each = +40% total bonus.
//
// Productivity is dropped (treated as zero) for a recipe with
// `allowProductivity: false`, whatever modules or beacons are configured.
// Each effect is also dropped when the machine's `allowedEffects` (machine and
// beacon modules) or the beacon entity's `allowedEffects` (beacon modules) lacks
// it. An unknown machine or beacon entity filters nothing.
//
// Productivity adjusts the stoichiometry matrix before solving (handled by
// buildClassifiedSystem via productivityMap).
//
// Reactor rows also carry a heat bonus: Machine.neighbourBonus × the row's
// neighbourCount, applied to the heat product (see rowProductAmount in build.ts).
//
// A burner row also carries its fuel (`fuel`): items burnt per recipe execution, an extra ingredient of
// the row (see rowIngredients in build.ts).
//
// Speed and consumption are applied post-solve to compute machine counts
// and power draw.
// ---------------------------------------------------------------------------

export interface NodeEffects {
  productivityBonus: number  // e.g. 0.40 for +40%
  speedBonus: number         // e.g. 0.30 for +30%
  consumptionBonus: number   // e.g. -0.20 for −20%
  heatBonus: number          // reactor neighbours: heat product × (1 + heatBonus)
  /** Burner rows with fuel data: the fuel burnt per recipe execution (an ingredient of the row). */
  fuel?: Ingredient
}

/**
 * Whether an effect counts: every known list of allowed effects includes it. An unknown entity
 * (undefined list) filters nothing, as for legacy data; a known empty list allows nothing.
 * Shared by the solver and the module / beacon modals so they cannot drift.
 */
export function effectAllowed(effect: string, ...lists: (readonly string[] | undefined)[]): boolean {
  return lists.every(list => !list || list.includes(effect))
}

/** The machine a row runs on: its own choice, else the category default. */
export function rowMachine(node: GameRecipeNode, gameData: GameData): Machine | undefined {
  const recipe = gameData.recipes[node.recipeId]
  const id = node.machineId ?? (recipe && gameData.defaultMachines[recipe.category])
  return id ? gameData.machines[id] : undefined
}

/**
 * Heat bonus of a reactor row: the resolved machine's `neighbourBonus` times the
 * row's average neighbour count. Zero when the machine has no bonus, the row no
 * count, or anything is unknown.
 */
export function neighbourHeatBonus(node: GameRecipeNode, gameData: GameData): number {
  return (rowMachine(node, gameData)?.neighbourBonus ?? 0) * (node.neighbourCount ?? 0)
}

/**
 * Compute the combined module + beacon effects for a single recipe node.
 * Returns zero for all bonuses if the node has no modules or beacons. The
 * productivity bonus is zero when the recipe disallows productivity (or is
 * unknown). Each effect is also dropped when the machine's `allowedEffects` (or,
 * for beacon modules, the beacon entity's) does not include it; unknown entities
 * filter nothing.
 *
 * @param node     - the recipe node from the plan
 * @param gameData - used to look up module effect values
 */
export function computeNodeEffects(node: GameRecipeNode, gameData: GameData): NodeEffects {
  let productivityBonus = 0
  let speedBonus = 0
  let consumptionBonus = 0
  const allowProductivity = gameData.recipes[node.recipeId]?.allowProductivity ?? false
  const machineAllowed = rowMachine(node, gameData)?.allowedEffects

  const allowed = effectAllowed

  // Machine module contributions (full effect per module).
  for (const mc of node.modules) {
    const mod = gameData.modules[mc.moduleId]
    if (!mod) continue
    if (allowProductivity && allowed('productivity', machineAllowed)) {
      productivityBonus += (mod.effects.productivity ?? 0) * mc.count
    }
    if (allowed('speed', machineAllowed)) speedBonus += (mod.effects.speed ?? 0) * mc.count
    if (allowed('consumption', machineAllowed)) consumptionBonus += (mod.effects.consumption ?? 0) * mc.count
  }

  // Beacon contributions, summed over the configurations: capped by both the beacon entity's and the machine's allowed effects.
  for (const beacon of node.beaconConfigs ?? []) {
    if (!beacon.moduleId) continue
    const mod = gameData.modules[beacon.moduleId]
    if (!mod) continue
    const beaconAllowed = beacon.beaconId ? gameData.beacons[beacon.beaconId]?.allowedEffects : undefined
    const multiplier =
      beacon.distributionEfficiency * beacon.modulesPerBeacon * beacon.beaconCount
    if (allowProductivity && allowed('productivity', beaconAllowed, machineAllowed)) {
      productivityBonus += (mod.effects.productivity ?? 0) * multiplier
    }
    if (allowed('speed', beaconAllowed, machineAllowed)) speedBonus += (mod.effects.speed ?? 0) * multiplier
    if (allowed('consumption', beaconAllowed, machineAllowed)) {
      consumptionBonus += (mod.effects.consumption ?? 0) * multiplier
    }
  }

  const effects: NodeEffects = {
    productivityBonus, speedBonus, consumptionBonus, heatBonus: neighbourHeatBonus(node, gameData),
  }
  const fuel = nodeFuel(node, gameData, effects)
  return fuel ? { ...effects, fuel } : effects
}

/** Factorio clamps a machine's energy consumption at -80 %: the multiplier on its base draw never goes below 0.2. */
export function consumptionMultiplier(consumptionBonus: number): number {
  return Math.max(0.2, 1 + consumptionBonus)
}

/**
 * Fuel a burner row burns per execution:
 * energyUsageKw × consumptionMultiplier × craftingTime / (craftingSpeed × (1 + speedBonus)) / (fuelValueKj × effectivity),
 * i.e. the row's power draw divided by the fuel's energy. Undefined without a resolvable fuel or a positive finite amount.
 */
function nodeFuel(node: GameRecipeNode, gameData: GameData, effects: NodeEffects): Ingredient | undefined {
  const recipe = gameData.recipes[node.recipeId]
  const machine = rowMachine(node, gameData)
  if (!recipe || !machine) return undefined
  const item = resolveRowFuel(gameData, machine, node.fuelItemId)
  if (!item?.fuelValueKj) return undefined
  const amount =
    machine.energyUsageKw * consumptionMultiplier(effects.consumptionBonus) * recipe.craftingTime
    / (machine.craftingSpeed * (1 + effects.speedBonus))
    / (item.fuelValueKj * (machine.effectivity ?? 1))
  if (!Number.isFinite(amount) || amount <= 0) return undefined
  return { itemId: item.id, type: item.type, amount }
}

/**
 * Compute machine count and power draw for one recipe node after solving.
 *
 * @param throughput   - recipe executions / min for this node
 * @param craftingTime - recipe crafting time in seconds
 * @param machine      - the machine being used
 * @param effects      - precomputed module + beacon effects
 */
export function computeMachineMetrics(
  throughput: number,
  craftingTime: number,
  machine: Machine,
  effects: NodeEffects,
): { machineCountExact: number; machineCountCeil: number; powerKw: number } {
  // Effective speed accounts for speed modules/beacons.
  const effectiveCraftingSpeed = machine.craftingSpeed * (1 + effects.speedBonus)

  // machineCount = exec/min × (craftingTime_s / 60) / effectiveCraftingSpeed
  const machineCountExact =
    throughput * (craftingTime / 60) / effectiveCraftingSpeed

  const machineCountCeil = Math.ceil(machineCountExact)

  // Power: energy usage scaled by the consumption bonus (clamped at -80 %), plus drain.
  // Drain is a constant idle draw not affected by consumption modules.
  const powerKw =
    machineCountExact *
      (machine.energyUsageKw * consumptionMultiplier(effects.consumptionBonus) + machine.drainKw)

  return { machineCountExact, machineCountCeil, powerKw }
}
