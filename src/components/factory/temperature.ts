import type { Recipe } from '../../data/types'

/** Magnitudes at or beyond this are treated as "no bound" (e.g. math.huge exported as 1.79e308). */
export const UNBOUNDED_TEMPERATURE = 1e30

/** "95", "26.5", "-10": at most 1 decimal, trailing ".0" stripped, -0 shown as "0". */
export function fmtTemperatureValue(value: number): string {
  const r = Math.round(value * 10) / 10
  return String(Object.is(r, -0) ? 0 : r)
}

function isBound(v: number | undefined): v is number {
  return typeof v === 'number' && Number.isFinite(v) && Math.abs(v) < UNBOUNDED_TEMPERATURE
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
