import type { Block, GameData, SolverResult, ConnectionFlow, SourceRule } from '../../data/types'
import type { RateUnit } from '../../store/uiStore'
import { dedicatedProduct } from '../../solver/areas'
import { rowMachine } from '../../solver/effects'
import { fmtItemRateText } from './ItemTile'
import { presetOf } from '../../data/sourceRules'

// ---------------------------------------------------------------------------
// The sentence under each sourcing choice of the side panel: how this block gets one item under the
// mode, from what the solver did. A pure function of plain data (like `productChangeText.ts`); no
// generated text. Rates are items/min and go through `fmtItemRateText`.
// ---------------------------------------------------------------------------

/** A recipe row of the block that makes the item. */
export interface ItemMaker {
  recipeName: string
  machineName: string
  /** Machines the solver needs for the row (rounded up). */
  machineCount: number
  /** items/min of the item the row makes (gross). */
  rate: number
  /** The item is a co-product of the row, not its primary product. */
  byproduct: boolean
}

/** A connection that delivers the item to the block. */
export interface ItemConnection {
  blockName: string
  /** items/min the source offers over the connection. */
  offered: number
  /** items/min taken (informational; the sentence speaks of what the rows make). */
  taken: number
}

export interface SourcingTextInput {
  itemName: string
  itemId: string
  /** The item's stored rule; undefined is the default rule (Make it here, Import on). */
  rule: SourceRule | undefined
  makers: ItemMaker[]
  connections: ItemConnection[]
  unit: RateUnit
  /** There is a solve for the block; without one the rows' rates are unknown. */
  solved?: boolean
}

const EPS = 1e-6

function list(parts: string[]): string {
  if (parts.length <= 1) return parts.join('')
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

function makerLabel(m: ItemMaker): string {
  return `${m.recipeName} (${m.machineCount} × ${m.machineName})`
}

export function sourcingText(input: SourcingTextInput): string {
  const { itemName, itemId, rule, makers, connections, unit, solved = true } = input
  const mode = presetOf(rule)
  const noImport = rule?.importOff === true
  const primaries = makers.filter(m => !m.byproduct)
  const rate = (perMin: number) => fmtItemRateText(itemId, perMin / 60, unit)
  // Import is off: Make it here and Receive it first say so in a suffix, Don't make more here in its last clause.
  const importOff = noImport ? ' Import is off.' : ''

  if (mode === 'byproducts-first') {
    // Every row that already makes the item, whatever its dedicated product.
    // Without a solve the rates are unknown: name the rows that make it as a byproduct, without a rate.
    const used = solved
      ? makers.filter(m => m.rate > EPS).map(m => `${m.recipeName} ${rate(m.rate)}`).join(', ')
      : makers.filter(m => m.byproduct).map(m => m.recipeName).join(', ')
    const rest = (imported: string) => (noImport ? 'missing: Import is off' : imported)
    const blocks = list(connections.map(c => c.blockName))
    if (used) {
      return connections.length > 0
        ? `Uses what this block already makes (${used}), then takes from ${blocks}. The rest is ${rest('imported')}.`
        : `Uses what this block already makes (${used}). The rest is ${rest('imported')}.`
    }
    return connections.length > 0
      ? `No row here already makes ${itemName}; it is taken from ${blocks}, and the rest is ${rest('imported')}.`
      : `No row here already makes ${itemName}; it is ${rest('imported')}.`
  }

  if (mode === 'connections-first') {
    const rest = primaries.length > 0 ? list(primaries.map(m => m.recipeName)) : undefined
    if (connections.length === 0) {
      return (rest ? `No connection for ${itemName}; ${rest} covers it.` : `No connection for ${itemName}; it is imported.`) + importOff
    }
    const offered = connections.reduce((sum, c) => sum + c.offered, 0)
    const head = `Taken from ${list(connections.map(c => c.blockName))} first (${rate(offered)} offered)`
    const made = primaries.reduce((sum, m) => sum + m.rate, 0)
    // The connection covers everything when no row of its own has to run for the item.
    if (rest && made > EPS) return `${head}, then ${rest} makes the rest.${importOff}`
    return `${head}.${importOff}`
  }

  // Make it here
  if (makers.length === 0) {
    // Connections deliver what they can; only the rest is imported (the sentence of Don't make more here, with no row).
    return connections.length > 0
      ? `No row here makes ${itemName}; it is taken from ${list(connections.map(c => c.blockName))}, and the rest is imported.${importOff}`
      : `No row here makes ${itemName}; it is imported.${importOff}`
  }
  return `Made here by ${list(makers.map(makerLabel))}.${importOff}`
}

// ---------------------------------------------------------------------------
// Gathering the inputs from the plan and the solve
// ---------------------------------------------------------------------------

/** The block's recipe rows that make `itemId`, with what the solver ran them at. */
export function itemMakers(block: Block, gameData: GameData, result: SolverResult | undefined, itemId: string): ItemMaker[] {
  const solved = new Map(result?.nodes.map(n => [n.recipeNodeId, n]) ?? [])
  const makers: ItemMaker[] = []
  const visit = (plan: Block['rootPlan']) => {
    for (const n of plan.nodes) {
      if (n.kind !== 'game-recipe') continue
      const recipe = gameData.recipes[n.recipeId]
      if (!recipe || !recipe.products.some(p => p.itemId === itemId)) continue
      const s = solved.get(n.id)
      makers.push({
        recipeName: recipe.name,
        machineName: rowMachine(n, gameData)?.name ?? 'machine',
        machineCount: s?.machineCountCeil ?? 0,
        rate: s?.outputRates[itemId] ?? 0,
        byproduct: dedicatedProduct(n, recipe) !== itemId,
      })
    }
    plan.subPlans.forEach(visit)
  }
  visit(block.rootPlan)
  return makers
}

/** The block's connections that deliver `itemId`, with the offered and taken rates of the latest solve. */
export function itemConnections(
  block: Block,
  blocks: readonly Block[],
  flows: readonly ConnectionFlow[],
  itemId: string,
): ItemConnection[] {
  return block.inputConnections
    .filter(c => c.itemId === itemId && c.fromBlockId !== block.id)
    .flatMap(c => {
      const source = blocks.find(b => b.id === c.fromBlockId)
      if (!source) return []
      const flow = flows.find(f => f.connectionId === c.id)
      return [{ blockName: source.name, offered: flow?.available ?? 0, taken: flow?.rate ?? 0 }]
    })
}
