/**
 * Id of the electricity pseudo-item the exporter adds with the power generation
 * recipes. One unit is 1 MJ, so 1 unit/s is 1 MW and 10 MW is 600 units/min.
 * Must equal ELECTRICITY_ITEM_ID in scripts/power.js.
 */
export const ELECTRICITY_ITEM_ID = 'power:electricity'

export function isElectricity(itemId: string | undefined): boolean {
  return itemId === ELECTRICITY_ITEM_ID
}
