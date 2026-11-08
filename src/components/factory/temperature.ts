import type { GameData, Recipe, SolverWarning } from '../../data/types'
import { isBound } from '../../data/temperature'

/** "95", "26.5", "-10": at most 1 decimal, trailing ".0" stripped, -0 shown as "0". */
export function fmtTemperatureValue(value: number): string {
  const r = Math.round(value * 10) / 10
  return String(Object.is(r, -0) ? 0 : r)
}

/** Label for an ingredient's temperature bounds, or undefined when neither bound is set. */
export function fmtTemperatureRange(min?: number, max?: number): string | undefined {
  const lo = isBound(min) ? fmtTemperatureValue(min) : undefined
  const hi = isBound(max) ? fmtTemperatureValue(max) : undefined
  if (lo !== undefined && hi !== undefined) return lo === hi ? `${lo}°C` : `${lo}–${hi}°C`
  if (lo !== undefined) return `≥${lo}°C`
  if (hi !== undefined) return `≤${hi}°C`
  return undefined
}

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
 * Sentence for a `temperature-mismatch` warning, e.g. "Steam Turbine (Steam) needs Steam at ≥465°C, but it is
 * only supplied at 165°C." When the block imports the fluid instead: "…, but it is only made at 165°C, so
 * 666.7/min is imported and the 60/min made is left unused." `fmtRate` formats an items/min rate.
 */
export function fmtTemperatureWarning(
  w: Extract<SolverWarning, { type: 'temperature-mismatch' }>,
  gameData: GameData,
  fmtRate: (perMin: number) => string = r => `${Math.round(r * 10) / 10}/min`,
): string {
  const recipe = gameData.recipes[w.recipeId]?.name ?? w.recipeId
  const item = gameData.items[w.itemId]?.name ?? w.itemId
  const need = fmtTemperatureRange(w.minimum, w.maximum) ?? ''
  const supplied = w.supplied.map(t => `${fmtTemperatureValue(t)}°C`).join(', ')
  if (w.imported === undefined) return `${recipe} needs ${item} at ${need}, but it is only supplied at ${supplied}.`
  const unused = w.unused === undefined ? '' : ` and the ${fmtRate(w.unused)} made is left unused`
  return `${recipe} needs ${item} at ${need}, but it is only made at ${supplied}, so ${fmtRate(w.imported)} is imported${unused}.`
}
