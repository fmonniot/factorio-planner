import type { BeaconConfig, GameData, GameRecipeNode, ModuleConfig } from '../../../data/types'
import { computeNodeEffects, effectAllowed, rowMachine } from '../../../solver/effects'

// ---------------------------------------------------------------------------
// Effects of a row, per source: the machine's modules and each beacon configuration, then the total.
// The raw values are what the modules carry; the applied ones are what the solver counts (the machine's,
// the beacon's and the recipe's allowed effects filter them, see `effectAllowed`).
// ---------------------------------------------------------------------------

export interface EffectTotals {
  speed: number
  productivity: number
  consumption: number
  pollution: number
  quality: number
}

export type EffectKey = keyof EffectTotals

const zero = (): EffectTotals => ({ speed: 0, productivity: 0, consumption: 0, pollution: 0, quality: 0 })

/** Raw effects of the machine's modules (full effect per module). */
export function moduleEffects(modules: readonly ModuleConfig[], gameData: GameData): EffectTotals {
  const totals = zero()
  for (const mc of modules) {
    const mod = gameData.modules[mc.moduleId]
    if (!mod) continue
    for (const [effect, value] of Object.entries(mod.effects)) {
      if (effect in totals) totals[effect as EffectKey] += (value as number) * mc.count
    }
  }
  return totals
}

/** Raw effects of one beacon configuration: module effect × efficiency × modules per beacon × beacons (what the solver multiplies). */
export function beaconEffects(beacon: BeaconConfig, gameData: GameData): EffectTotals {
  const totals = zero()
  const mod = beacon.moduleId ? gameData.modules[beacon.moduleId] : undefined
  if (!mod) return totals
  const multiplier = beacon.beaconCount * beacon.modulesPerBeacon * beacon.distributionEfficiency
  for (const [effect, value] of Object.entries(mod.effects)) {
    if (effect in totals) totals[effect as EffectKey] += (value as number) * multiplier
  }
  return totals
}

/** The effects that count: the ones every known list of allowed effects includes, productivity only when the recipe allows it. */
export function applyRecipeConstraints(
  totals: EffectTotals,
  allowedLists: (readonly string[] | undefined)[],
  allowProductivity: boolean,
): EffectTotals {
  const ok = (effect: string) => effectAllowed(effect, ...allowedLists)
  return {
    speed: ok('speed') ? totals.speed : 0,
    productivity: allowProductivity && ok('productivity') ? totals.productivity : 0,
    consumption: ok('consumption') ? totals.consumption : 0,
    pollution: ok('pollution') ? totals.pollution : 0,
    quality: ok('quality') ? totals.quality : 0,
  }
}

export interface EffectSource {
  raw: EffectTotals
  applied: EffectTotals
}

export interface RowEffects {
  machine: EffectSource
  beacons: EffectSource[]
  /** What the solver counts for the row (speed, productivity, energy). */
  total: Pick<EffectTotals, 'speed' | 'productivity' | 'consumption'>
}

/** Effects of a recipe row per source, with the solver's own total. */
export function rowEffects(node: GameRecipeNode, beacons: readonly BeaconConfig[], gameData: GameData): RowEffects {
  const allowProductivity = gameData.recipes[node.recipeId]?.allowProductivity ?? false
  const machineAllowed = rowMachine(node, gameData)?.allowedEffects
  const machineRaw = moduleEffects(node.modules, gameData)
  const solver = computeNodeEffects(node, gameData)
  return {
    machine: { raw: machineRaw, applied: applyRecipeConstraints(machineRaw, [machineAllowed], allowProductivity) },
    beacons: beacons.map(b => {
      const raw = beaconEffects(b, gameData)
      const beaconAllowed = b.beaconId ? gameData.beacons[b.beaconId]?.allowedEffects : undefined
      return { raw, applied: applyRecipeConstraints(raw, [beaconAllowed, machineAllowed], allowProductivity) }
    }),
    total: { speed: solver.speedBonus, productivity: solver.productivityBonus, consumption: solver.consumptionBonus },
  }
}

/** "+20%" / "-15%". */
export function fmtEffect(value: number): string {
  const pct = Math.round(value * 100)
  return pct >= 0 ? `+${pct}%` : `${pct}%`
}
