import type { Block, ConnectionFlow, GameData, SolverResult, SolverWarning } from '../data/types'
import { acceptsTemperature, effectiveTemperature, hasTemperatureBound, isBound } from '../data/temperature'
import { FLOW_TOLERANCE, surplusTolerance } from './blockResult'

const temperatureData = new WeakMap<GameData, boolean>()

/** True when some recipe of `gameData` bounds an ingredient temperature (computed once per data set). */
export function hasTemperatureData(gameData: GameData): boolean {
  let v = temperatureData.get(gameData)
  if (v === undefined) {
    v = Object.values(gameData.recipes).some(r => r.ingredients.some(hasTemperatureBound))
    temperatureData.set(gameData, v)
  }
  return v
}

export type TemperatureMismatch = Extract<SolverWarning, { type: 'temperature-mismatch' }>

/**
 * The temperatures at which the nodes of `result` make `itemId`; `unknown` when one has none, `any` when at
 * least one makes it. `idle`: also count rows that do not run (what the block could make it at). A row that
 * discards the item (`discarded` holds `nodeId\0itemId`) does not supply it.
 */
function suppliedBy(
  itemId: string,
  result: SolverResult,
  recipeOf: Map<string, string> | undefined,
  gameData: GameData,
  skipNodeId: string | undefined,
  discarded: Set<string> | undefined,
  idle = false,
): { temps: number[]; unknown: boolean; any: boolean } {
  const temps: number[] = []
  let unknown = false
  let any = false
  for (const m of result.nodes) {
    if (m.recipeNodeId === skipNodeId) continue
    if (!idle && (m.outputRates[itemId] ?? 0) <= FLOW_TOLERANCE) continue
    if (discarded?.has(`${m.recipeNodeId}\0${itemId}`)) continue
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
 * it) makes that fluid at falls outside it. When the block imports the fluid (the LP's temperature rows
 * import what no row of the block can make at a fitting temperature), the candidates are every row
 * of the block that makes it, running or not, and the warning carries the import and what the block
 * makes of the fluid without using it. Anything unknown (a supplier without a temperature, no
 * supplier at all, a connection whose source passes the fluid on) stays silent.
 * `recipeIdOfNode`: blockId → recipe node id → recipe id. `discarded`: blockId → `nodeId\0itemId`
 * of the products a row discards.
 */
export function temperatureWarnings(
  blocks: Block[],
  results: Record<string, SolverResult>,
  flows: ConnectionFlow[],
  gameData: GameData,
  recipeIdOfNode: Map<string, Map<string, string>>,
  discarded: Map<string, Set<string>> = new Map(),
): Map<string, TemperatureMismatch[]> {
  const out = new Map<string, TemperatureMismatch[]>()
  for (const block of blocks) {
    const result = results[block.id]
    const recipeOf = recipeIdOfNode.get(block.id)
    if (!result || !recipeOf) continue
    const dropped = discarded.get(block.id)
    const seen = new Set<string>()
    let imported: Map<string, number> | undefined
    const importOf = (itemId: string) => {
      if (!imported) {
        imported = new Map()
        for (const u of result.unsatisfied) imported.set(u.itemId, (imported.get(u.itemId) ?? 0) + u.rate)
      }
      const rate = imported.get(itemId) ?? 0
      return rate > FLOW_TOLERANCE ? rate : 0
    }
    const list: TemperatureMismatch[] = []
    for (const n of result.nodes) {
      const recipe = gameData.recipes[recipeOf.get(n.recipeNodeId) ?? '']
      if (!recipe) continue
      for (const [fluidId, rate] of Object.entries(n.inputRates)) {
        if (rate <= FLOW_TOLERANCE) continue
        for (const ing of recipe.ingredients) {
          if (ing.itemId !== fluidId || !hasTemperatureBound(ing)) continue
          const key = `${recipe.id}\0${fluidId}\0${ing.minimumTemperature}\0${ing.maximumTemperature}`
          if (seen.has(key)) continue

          const importRate = importOf(fluidId)
          const local = suppliedBy(fluidId, result, recipeOf, gameData, n.recipeNodeId, dropped, importRate > 0)
          let unknown = local.unknown
          const temps = [...local.temps]
          for (const f of flows) {
            if (f.toBlockId !== block.id || f.itemId !== fluidId) continue
            if (f.rate <= FLOW_TOLERANCE || (f.status !== 'ok' && f.status !== 'limited')) continue
            const src = results[f.fromBlockId]
            const upstream = src
              ? suppliedBy(fluidId, src, recipeIdOfNode.get(f.fromBlockId), gameData, undefined, discarded.get(f.fromBlockId))
              : undefined
            // A source with no producer of the fluid passes it through: its temperature is unknown.
            // So is one that also receives the fluid over a connection and may forward it. An import does not
            // count: the LP never imports what the block then has left over (an import costs more than
            // not making it), so what the source offers is what its own rows make.
            const passesOn = flows.some(g => g.toBlockId === f.fromBlockId && g.itemId === fluidId && g.rate > FLOW_TOLERANCE)
            if (!upstream || !upstream.any || passesOn) { unknown = true; continue }
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
          if (importRate > 0) {
            warning.imported = importRate
            const unused = unusedRate(fluidId, block.id, result, flows, importRate, dropped)
            if (unused > 0) warning.unused = unused
          }
          list.push(warning)
        }
      }
    }
    if (list.length > 0) out.set(block.id, list)
  }
  return out
}

/**
 * What block `blockId` makes of `itemId` that nothing takes: its rows' net output plus the import and
 * what it receives, less what it sends to other blocks (a discarded output is not counted). Above the item's surplus tolerance, else 0.
 */
function unusedRate(
  itemId: string,
  blockId: string,
  result: SolverResult,
  flows: ConnectionFlow[],
  importRate: number,
  discarded: Set<string> | undefined,
): number {
  let made = 0
  let taken = 0
  for (const m of result.nodes) {
    if (!discarded?.has(`${m.recipeNodeId}\0${itemId}`)) made += m.outputRates[itemId] ?? 0
    taken += m.inputRates[itemId] ?? 0
  }
  let received = 0
  let sent = 0
  for (const f of flows) {
    if (f.itemId !== itemId) continue
    if (f.toBlockId === blockId) received += f.rate
    if (f.fromBlockId === blockId) sent += f.rate
  }
  const unused = made + importRate + received - taken - sent
  return unused > surplusTolerance(Math.max(made + importRate + received, taken + sent)) ? unused : 0
}
