import type { GameData, Item, Machine } from './types'

// ---------------------------------------------------------------------------
// Burner fuel
//
// A burner row burns one fuel item, an ordinary ingredient of the row (see
// rowIngredients in src/solver/build.ts). Which fuels a machine accepts comes
// from the exported data: `Machine.fuelCategories` against `Item.fuelCategory`.
// A fluid-burner row (`burns_fluid`) burns a fluid with a fuel value instead,
// optionally narrowed to `Machine.fuelFluid`. Shared by the solver and the UI.
// ---------------------------------------------------------------------------

/** Every visible item with a fuel value and no burnt result, lowest value first, then id. Computed once per item table. */
const fuelCandidates = new WeakMap<GameData['items'], Item[]>()
/** Every fluid (hidden ones too) with a fuel value, lowest value first, then id; and the visible subset. Computed once per item table. */
const fluidFuelCandidates = new WeakMap<GameData['items'], { all: Item[], visible: Item[] }>()

const byValueThenId = (a: Item, b: Item) =>
  (a.fuelValueKj ?? 0) - (b.fuelValueKj ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

/** True for the machines that burn a fuel: item burners and fluid burners. */
export function burnsFuel(machine: Machine | undefined): boolean {
  return machine?.energyType === 'burner' || machine?.energyType === 'fluid-burner'
}

function fluidCandidatesOf(gameData: GameData): { all: Item[], visible: Item[] } {
  let lists = fluidFuelCandidates.get(gameData.items)
  if (!lists) {
    const all = Object.values(gameData.items)
      .filter(item => item.type === 'fluid' && (item.fuelValueKj ?? 0) > 0)
      .sort(byValueThenId)
    lists = { all, visible: all.filter(item => !item.hidden) }
    fluidFuelCandidates.set(gameData.items, lists)
  }
  return lists
}

function candidatesOf(gameData: GameData): Item[] {
  let list = fuelCandidates.get(gameData.items)
  if (!list) {
    list = Object.values(gameData.items)
      .filter(item =>
        item.type === 'item' && !item.hidden && !item.burntResult
        && (item.fuelValueKj ?? 0) > 0 && item.fuelCategory !== undefined)
      .sort(byValueThenId)
    fuelCandidates.set(gameData.items, list)
  }
  return list
}

/**
 * Items the machine can burn: visible, with a fuel value and a category the machine accepts, no burnt
 * result (not modelled). Lowest fuel value first, then id. Empty for a machine without fuel data.
 * A fluid-burner machine burns visible fluids with a fuel value instead (only `fuelFluid` when set, even if hidden);
 * fluid temperature is irrelevant for `burns_fluid`.
 */
export function acceptedFuels(gameData: GameData, machine: Machine): Item[] {
  if (machine.energyType === 'fluid-burner') {
    const { all, visible } = fluidCandidatesOf(gameData)
    // A filtered source names its fluid, hidden or not; hidden fluids are excluded only when it accepts any.
    return machine.fuelFluid === undefined ? visible : all.filter(item => item.id === machine.fuelFluid)
  }
  const categories = machine.fuelCategories
  if (machine.energyType !== 'burner' || !categories || categories.length === 0) return []
  return candidatesOf(gameData).filter(item => categories.includes(item.fuelCategory!))
}

/** The fuel a row burns when it has no (valid) choice: the lowest-value accepted fuel (item or fluid). */
export function defaultFuel(gameData: GameData, machine: Machine): Item | undefined {
  return acceptedFuels(gameData, machine)[0]
}

/**
 * The fuel (item or fluid) a row burns: its explicit choice when the machine accepts it, else the default.
 * Undefined when the machine is not a burner or fluid burner, has no fuel data or no accepted fuel (the row then keeps
 * its power draw).
 */
export function resolveRowFuel(gameData: GameData, machine: Machine | undefined, fuelItemId: string | undefined): Item | undefined {
  if (!machine) return undefined
  const accepted = acceptedFuels(gameData, machine)
  return accepted.find(item => item.id === fuelItemId) ?? accepted[0]
}

/**
 * Whether the data set has fuel data for the machine: fuel categories (burner), or a visible fluid with a
 * fuel value, or the filter fluid itself (fluid-burner). False means "no fuel data", not "every fuel is filtered out".
 */
export function hasFuelData(gameData: GameData, machine: Machine | undefined): boolean {
  if (!machine) return false
  if (machine.energyType === 'fluid-burner') return fluidCandidatesOf(gameData).visible.length > 0 || acceptedFuels(gameData, machine).length > 0
  return (machine.fuelCategories?.length ?? 0) > 0
}
