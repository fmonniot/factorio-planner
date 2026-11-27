import type { DataSetInfo } from '../data/types'

/** The mods every install has: they are not counted as part of what a data set adds. */
const BUILT_IN_MODS = ['base', 'elevated-rails', 'quality', 'space-age']

/** What the planner tells a player about a data set: the game version, the mods beyond the built-in ones and the recipe count. */
export function summarizeDataSet(info: DataSetInfo) {
  const mods = Object.keys(info.modSet).filter(m => !BUILT_IN_MODS.includes(m))
  return {
    version: info.factorioVersion,
    modCount: mods.length,
    recipeCount: info.recipeCount,
    mods,
    modSet: info.modSet,
  }
}

/** "Factorio 2.0.76 · 29 mods · 2033 recipes". */
export function dataSetInfoText(summary: ReturnType<typeof summarizeDataSet>): string {
  return `Factorio ${summary.version} · ${summary.modCount} ${summary.modCount === 1 ? 'mod' : 'mods'} · ${summary.recipeCount} ${summary.recipeCount === 1 ? 'recipe' : 'recipes'}`
}
