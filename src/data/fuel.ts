import type { GameData, Item, Machine } from './types'

// ---------------------------------------------------------------------------
// Burner fuel
//
// A burner row burns one fuel item, an ordinary ingredient of the row (see
// rowIngredients in src/solver/build.ts). Which fuels a machine accepts comes
// from the exported data: `Machine.fuelCategories` against `Item.fuelCategory`.
// Shared by the solver and the UI.
// ---------------------------------------------------------------------------

/** Every visible item with a fuel value and no burnt result, lowest value first, then id. Computed once per item table. */
const fuelCandidates = new WeakMap<GameData['items'], Item[]>()

function candidatesOf(gameData: GameData): Item[] {
  let list = fuelCandidates.get(gameData.items)
  if (!list) {
    list = Object.values(gameData.items)
      .filter(item =>
        item.type === 'item' && !item.hidden && !item.burntResult
        && (item.fuelValueKj ?? 0) > 0 && item.fuelCategory !== undefined)
      .sort((a, b) =>
        (a.fuelValueKj ?? 0) - (b.fuelValueKj ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    fuelCandidates.set(gameData.items, list)
  }
  return list
}

/**
 * Items the machine can burn: visible, with a fuel value and a category the machine accepts, no burnt
 * result (not modelled). Lowest fuel value first, then id. Empty for a machine without fuel data.
 */
export function acceptedFuels(gameData: GameData, machine: Machine): Item[] {
  const categories = machine.fuelCategories
  if (machine.energyType !== 'burner' || !categories || categories.length === 0) return []
  return candidatesOf(gameData).filter(item => categories.includes(item.fuelCategory!))
}

/** The fuel a row burns when it has no (valid) choice: the lowest-value accepted fuel. */
export function defaultFuel(gameData: GameData, machine: Machine): Item | undefined {
  return acceptedFuels(gameData, machine)[0]
}

/**
 * The fuel item a row burns: its explicit choice when the machine accepts it, else the default.
 * Undefined when the machine is not a burner, has no fuel data or no accepted fuel (the row then keeps
 * its power draw).
 */
export function resolveRowFuel(gameData: GameData, machine: Machine | undefined, fuelItemId: string | undefined): Item | undefined {
  if (!machine) return undefined
  const accepted = acceptedFuels(gameData, machine)
  return accepted.find(item => item.id === fuelItemId) ?? accepted[0]
}
