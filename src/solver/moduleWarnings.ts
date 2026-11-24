import type { Block, GameData, SolverWarning, SubPlan } from '../data/types'
import { moduleMisfitInBeaconRow, moduleMisfitInMachineRow } from '../data/moduleRules'
import { rowMachine } from './effects'

export type ModuleNotAllowed = Extract<SolverWarning, { type: 'module-not-allowed' }>

/**
 * The modules of a block the game would not accept: those in a machine whose effects or category the machine rejects, those in a
 * beacon the beacon rejects, and those either holder takes but the row's recipe does not (limitation lists, productivity on a
 * recipe that disallows it). One reason per module and holder: the entity's wins over the recipe's.
 * Rows are listed in plan order, one entry per distinct (recipe, kind, entity, module, reason). Undefined when none.
 */
export function moduleNotAllowedWarning(block: Block, gameData: GameData): ModuleNotAllowed | undefined {
  const misfits: ModuleNotAllowed['misfits'] = []
  const seen = new Set<string>()
  const add = (entry: ModuleNotAllowed['misfits'][number]) => {
    const key = [entry.recipeId, entry.kind, entry.entityId, entry.moduleId, entry.reason].join('\0')
    if (seen.has(key)) return
    seen.add(key)
    misfits.push(entry)
  }

  const visit = (plan: SubPlan): void => {
    for (const node of plan.nodes) {
      if (node.kind !== 'game-recipe') continue
      const machine = rowMachine(node, gameData)
      const allowProductivity = gameData.recipes[node.recipeId]?.allowProductivity ?? false
      // A machine without slots is skipped: the module cell's over-slots flag already says so, and every module would read as an effect misfit there.
      if (machine && machine.moduleSlots > 0) {
        for (const mc of node.modules) {
          const mod = gameData.modules[mc.moduleId]
          const reason = mod && moduleMisfitInMachineRow(mod, machine, node.recipeId, allowProductivity)
          if (reason) add({ recipeId: node.recipeId, moduleId: mc.moduleId, kind: 'machine', entityId: machine.id, reason })
        }
      }
      for (const config of node.beaconConfigs ?? []) {
        const beacon = config.beaconId === undefined ? undefined : gameData.beacons[config.beaconId]
        if (!beacon) continue
        for (const mc of config.modules) {
          const mod = gameData.modules[mc.moduleId]
          const reason = mod && moduleMisfitInBeaconRow(mod, beacon, node.recipeId, allowProductivity)
          if (reason) add({ recipeId: node.recipeId, moduleId: mc.moduleId, kind: 'beacon', entityId: beacon.id, reason })
        }
      }
    }
    for (const sub of plan.subPlans) visit(sub)
  }
  visit(block.rootPlan)

  return misfits.length > 0 ? { type: 'module-not-allowed', misfits } : undefined
}
