import type { GameData, RecipeNode, Machine } from '../../data/types'

// ---------------------------------------------------------------------------
// Module and beacon effects
//
// Computes the effective bonuses (speed, productivity, consumption) for a
// recipe node from its configured machine modules and optional beacon.
//
// Machine modules: each module contributes its full effect.
// Beacon modules:  each beacon contributes:
//   effect × distributionEfficiency × modulesPerBeacon × beaconCount
//
// All bonuses are additive (summed, then added to 1 for the multiplier).
// Example: 4 prod-3 modules with +10% productivity each = +40% total bonus.
//
// Productivity adjusts the stoichiometry matrix before solving (handled by
// buildStoichiometryMatrix via productivityMap).
//
// Speed and consumption are applied post-solve to compute machine counts
// and power draw.
// ---------------------------------------------------------------------------

export interface NodeEffects {
  productivityBonus: number  // e.g. 0.40 for +40%
  speedBonus: number         // e.g. 0.30 for +30%
  consumptionBonus: number   // e.g. -0.20 for −20%
}

/**
 * Compute the combined module + beacon effects for a single recipe node.
 * Returns zero for all bonuses if the node has no modules or beacons.
 *
 * @param node     - the recipe node from the plan
 * @param gameData - used to look up module effect values
 */
export function computeNodeEffects(node: RecipeNode, gameData: GameData): NodeEffects {
  let productivityBonus = 0
  let speedBonus = 0
  let consumptionBonus = 0

  // Machine module contributions (full effect per module).
  for (const mc of node.modules) {
    const mod = gameData.modules[mc.moduleId]
    if (!mod) continue
    productivityBonus += (mod.effects.productivity ?? 0) * mc.count
    speedBonus        += (mod.effects.speed ?? 0) * mc.count
    consumptionBonus  += (mod.effects.consumption ?? 0) * mc.count
  }

  // Beacon contributions.
  const beacon = node.beaconConfig
  if (beacon) {
    const mod = gameData.modules[beacon.moduleId]
    if (mod) {
      const multiplier =
        beacon.distributionEfficiency * beacon.modulesPerBeacon * beacon.beaconCount
      productivityBonus += (mod.effects.productivity ?? 0) * multiplier
      speedBonus        += (mod.effects.speed ?? 0) * multiplier
      consumptionBonus  += (mod.effects.consumption ?? 0) * multiplier
    }
  }

  return { productivityBonus, speedBonus, consumptionBonus }
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

  // Power: energy usage scaled by consumption bonus, plus drain.
  // Drain is a constant idle draw not affected by consumption modules.
  const powerKw =
    machineCountExact *
      (machine.energyUsageKw * (1 + effects.consumptionBonus) + machine.drainKw)

  return { machineCountExact, machineCountCeil, powerKw }
}
