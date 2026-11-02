import type { Block, ConnectionFlow, GameData, SolverResult, SolverWarning } from '../data/types'
import { acceptsTemperature, effectiveTemperature, hasTemperatureBound, isBound } from '../data/temperature'
import { FLOW_TOLERANCE } from './blockResult'

export type TemperatureMismatch = Extract<SolverWarning, { type: 'temperature-mismatch' }>

/** Every temperature (distinct) at which the nodes of `result` make `itemId`, or undefined when one of them has none. */
function suppliedBy(
  itemId: string,
  result: SolverResult,
  recipeOf: Map<string, string> | undefined,
  gameData: GameData,
  skipNodeId: string | undefined,
): { temps: number[]; unknown: boolean; any: boolean } {
  const temps: number[] = []
  let unknown = false
  let any = false
  for (const m of result.nodes) {
    if (m.recipeNodeId === skipNodeId) continue
    if ((m.outputRates[itemId] ?? 0) <= FLOW_TOLERANCE) continue
    const recipe = gameData.recipes[recipeOf?.get(m.recipeNodeId) ?? '']
    if (!recipe) continue
    for (const p of recipe.products) {
      if (p.itemId !== itemId) continue
      any = true
      const t = effectiveTemperature(p, gameData.items[itemId])
      if (t === undefined) unknown = true
      else temps.push(t)
    }
  }
  return { temps, unknown, any }
}

/**
 * Fluid temperature mismatches per block. A consumer row warns when a fluid it takes has a
 * temperature bound and every temperature the block (its other rows plus the blocks connected into
 * it) makes that fluid at falls outside it. Anything unknown (a supplier without a temperature, no
 * supplier at all, a fluid still imported, a pass-through connection) stays silent. Read-only: the
 * solver itself ignores temperatures. `recipeIdOfNode`: blockId → recipe node id → recipe id.
 */
export function temperatureWarnings(
  blocks: Block[],
  results: Record<string, SolverResult>,
  flows: ConnectionFlow[],
  gameData: GameData,
  recipeIdOfNode: Map<string, Map<string, string>>,
): Map<string, TemperatureMismatch[]> {
  const out = new Map<string, TemperatureMismatch[]>()
  for (const block of blocks) {
    const result = results[block.id]
    const recipeOf = recipeIdOfNode.get(block.id)
    if (!result || !recipeOf) continue
    const seen = new Set<string>()
    const list: TemperatureMismatch[] = []
    for (const n of result.nodes) {
      const recipe = gameData.recipes[recipeOf.get(n.recipeNodeId) ?? '']
      if (!recipe) continue
      for (const [fluidId, rate] of Object.entries(n.inputRates)) {
        if (rate <= FLOW_TOLERANCE) continue
        if (result.unsatisfied.some(u => u.itemId === fluidId && u.rate > FLOW_TOLERANCE)) continue
        for (const ing of recipe.ingredients) {
          if (ing.itemId !== fluidId || !hasTemperatureBound(ing)) continue
          const key = `${recipe.id}\0${fluidId}\0${ing.minimumTemperature}\0${ing.maximumTemperature}`
          if (seen.has(key)) continue

          const local = suppliedBy(fluidId, result, recipeOf, gameData, n.recipeNodeId)
          let unknown = local.unknown
          const temps = [...local.temps]
          for (const f of flows) {
            if (f.toBlockId !== block.id || f.itemId !== fluidId) continue
            if (f.rate <= FLOW_TOLERANCE || (f.status !== 'ok' && f.status !== 'limited')) continue
            const src = results[f.fromBlockId]
            const upstream = src ? suppliedBy(fluidId, src, recipeIdOfNode.get(f.fromBlockId), gameData, undefined) : undefined
            // A source with no producer of the fluid passes it through: its temperature is unknown.
            if (!upstream || !upstream.any) { unknown = true; continue }
            if (upstream.unknown) unknown = true
            temps.push(...upstream.temps)
          }
          if (unknown || temps.length === 0) continue
          if (temps.some(t => acceptsTemperature(ing, t))) continue
          seen.add(key)
          const warning: TemperatureMismatch = {
            type: 'temperature-mismatch',
            recipeId: recipe.id,
            itemId: fluidId,
            supplied: [...new Set(temps)].sort((a, b) => a - b),
          }
          if (isBound(ing.minimumTemperature)) warning.minimum = ing.minimumTemperature
          if (isBound(ing.maximumTemperature)) warning.maximum = ing.maximumTemperature
          list.push(warning)
        }
      }
    }
    if (list.length > 0) out.set(block.id, list)
  }
  return out
}
