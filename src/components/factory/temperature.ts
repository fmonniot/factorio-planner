import type { GameData, Recipe, SolverWarning } from '../../data/types'
import { fmtTemperatureRange, fmtTemperatureValue } from '../../data/temperature'

export { fmtTemperatureRange, fmtTemperatureValue }

/** itemId → label for every ingredient of `recipe` that has a temperature bound. */
export function ingredientTemperatureLabels(recipe: Recipe): Record<string, string> {
  const perItem: Record<string, string[]> = {}
  for (const ing of recipe.ingredients) {
    const label = fmtTemperatureRange(ing.minimumTemperature, ing.maximumTemperature)
    if (label === undefined) continue
    const labels = (perItem[ing.itemId] ??= [])
    if (!labels.includes(label)) labels.push(label)
  }
  return Object.fromEntries(Object.entries(perItem).map(([id, labels]) => [id, labels.join(', ')]))
}

/** itemId → label for every product of `recipe` with an explicit temperature (e.g. "165°C"). */
export function productTemperatureLabels(recipe: Recipe): Record<string, string> {
  const perItem: Record<string, string[]> = {}
  for (const p of recipe.products) {
    const label = fmtTemperatureRange(p.temperature, p.temperature)
    if (label === undefined) continue
    const labels = (perItem[p.itemId] ??= [])
    if (!labels.includes(label)) labels.push(label)
  }
  return Object.fromEntries(Object.entries(perItem).map(([id, labels]) => [id, labels.join(', ')]))
}

/**
 * Sentence for a `temperature-mismatch` warning (heat only), e.g. "Heat Exchanger (Heat) needs Heat at ≥500°C,
 * but it is only supplied at 400°C."
 */
export function fmtTemperatureWarning(
  w: Extract<SolverWarning, { type: 'temperature-mismatch' }>,
  gameData: GameData,
): string {
  const recipe = gameData.recipes[w.recipeId]?.name ?? w.recipeId
  const item = gameData.items[w.itemId]?.name ?? w.itemId
  const need = fmtTemperatureRange(w.minimum, w.maximum) ?? ''
  const supplied = w.supplied.map(t => `${fmtTemperatureValue(t)}°C`).join(', ')
  return `${recipe} needs ${item} at ${need}, but it is only supplied at ${supplied}.`
}

/**
 * Sentence for a `no-fitting-temperature` warning, e.g. "Steam Turbine needs Steam at ≥465°C, but nothing in this
 * block makes it and it cannot be imported." Several rows: "A, B and C need Steam at …".
 */
export function fmtNoFittingTemperature(
  w: Extract<SolverWarning, { type: 'no-fitting-temperature' }>,
  gameData: GameData,
): string {
  const names = w.recipeIds.map(id => gameData.recipes[id]?.name ?? id)
  const who = names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
  const verb = names.length <= 1 ? 'needs' : 'need'
  const item = gameData.items[w.itemId]?.name ?? w.itemId
  const need = fmtTemperatureRange(w.min, w.max)
  const at = need === undefined ? '' : ` at ${need}`
  return `${who} ${verb} ${item}${at}, but nothing in this block makes it and it cannot be imported.`
}

/** A connection of a block: its id and the block it takes from (what `warningTargets` and the warning text read of it). */
export interface ConnectionLink { id: string; fromBlockId: string }

/**
 * Sentence for a `connection-temperature` warning, e.g. "Steam from Boilers is 165°C, but this block needs steam at ≥465°C."
 * `sourceName` names the block a connection takes from.
 */
export function fmtConnectionTemperature(
  w: Extract<SolverWarning, { type: 'connection-temperature' }>,
  gameData: GameData,
  sourceName: (connectionId: string) => string,
): string {
  return w.connections
    .map(c => {
      const item = gameData.items[c.itemId]?.name ?? c.itemId
      const offered = c.offered.map(o => `${fmtTemperatureValue(o.temperature)}°C`).join(', ')
      const needed = c.needed.map(n => fmtTemperatureRange(n.min, n.max) ?? 'any temperature').join(', ')
      return `${item} from ${sourceName(c.connectionId)} is ${offered}, but this block needs ${item.toLowerCase()} at ${needed}.`
    })
    .join(' ')
}
