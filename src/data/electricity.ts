/**
 * Ids of the energy pseudo-items the exporter adds with the power generation
 * recipes. One unit is 1 MJ, so 1 unit/s is 1 MW and 10 MW is 600 units/min.
 * Must equal ELECTRICITY_ITEM_ID and HEAT_ITEM_ID in scripts/power.js.
 */
export const ELECTRICITY_ITEM_ID = 'power:electricity'
export const HEAT_ITEM_ID = 'power:heat'
export const ENERGY_ITEM_IDS = [ELECTRICITY_ITEM_ID, HEAT_ITEM_ID] as const

/** True for electricity and heat: 1 unit = 1 MJ, shown in W-GW and typed in MW. */
export function isEnergyItem(itemId: string | undefined): boolean {
  return itemId !== undefined && (ENERGY_ITEM_IDS as readonly string[]).includes(itemId)
}
