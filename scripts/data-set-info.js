/**
 * data-set-info.js
 *
 * The `info.json` that sits beside each bundled `game-data.json`: what the first-visit screen shows about a data set
 * before the (several megabyte) bundle is loaded. Derived from the bundle, so it never holds anything the bundle lacks.
 */

/** The info of a game data bundle: the game version, the mod versions and the number of recipes a player can use. */
export function dataSetInfoOf(bundle) {
  return {
    factorioVersion: bundle.factorioVersion,
    modSet: bundle.modSet,
    recipeCount: Object.values(bundle.recipes).filter(r => !r.hidden).length,
  }
}
