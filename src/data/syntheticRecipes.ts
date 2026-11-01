/**
 * Recipes the data exporter invents (they are not game prototypes): mining and offshore-pump
 * recipes (`scripts/extraction.js`) and power generation recipes (`scripts/power.js`). Their ids
 * are `<prefix><name>`; the prefixes must equal the ones in those scripts.
 */
export const SYNTHETIC_RECIPE_KINDS = {
  'mining:': 'mining',
  'offshore:': 'offshore',
  'power:': 'power',
} as const

export type SyntheticRecipeKind = (typeof SYNTHETIC_RECIPE_KINDS)[keyof typeof SYNTHETIC_RECIPE_KINDS]

/** The kind of an exporter-invented recipe id, or undefined for a game recipe. */
export function syntheticRecipeKind(recipeId: string): SyntheticRecipeKind | undefined {
  for (const [prefix, kind] of Object.entries(SYNTHETIC_RECIPE_KINDS)) {
    if (recipeId.startsWith(prefix)) return kind
  }
  return undefined
}
