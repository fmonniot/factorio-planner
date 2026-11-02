import type { Ingredient, Item, RecipeProduct } from './types'

/** Magnitudes at or beyond this are treated as "no bound" (e.g. math.huge exported as 1.79e308). */
export const UNBOUNDED_TEMPERATURE = 1e30

/** Slack when comparing a temperature to a bound. */
const TEMPERATURE_EPSILON = 1e-9

export function isBound(v: number | undefined): v is number {
  return typeof v === 'number' && Number.isFinite(v) && Math.abs(v) < UNBOUNDED_TEMPERATURE
}

/**
 * The temperature a recipe makes of a fluid: the product's explicit `temperature`, else the fluid's
 * `defaultTemperature`. Undefined when neither is a finite number (items, Nullius fluids).
 */
export function effectiveTemperature(
  product: Pick<RecipeProduct, 'temperature'>,
  item: Pick<Item, 'defaultTemperature'> | undefined,
): number | undefined {
  const t = product.temperature ?? item?.defaultTemperature
  return typeof t === 'number' && Number.isFinite(t) ? t : undefined
}

/** True when the ingredient has a real minimum or maximum temperature. */
export function hasTemperatureBound(ing: Pick<Ingredient, 'minimumTemperature' | 'maximumTemperature'>): boolean {
  return isBound(ing.minimumTemperature) || isBound(ing.maximumTemperature)
}

/** True when a unit at temperature `t` satisfies the ingredient's bounds (a missing or unbounded side is open). */
export function acceptsTemperature(
  ing: Pick<Ingredient, 'minimumTemperature' | 'maximumTemperature'>,
  t: number,
): boolean {
  if (isBound(ing.minimumTemperature) && t < ing.minimumTemperature - TEMPERATURE_EPSILON) return false
  if (isBound(ing.maximumTemperature) && t > ing.maximumTemperature + TEMPERATURE_EPSILON) return false
  return true
}
