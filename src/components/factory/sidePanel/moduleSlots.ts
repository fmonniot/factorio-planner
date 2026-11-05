import type { ModuleConfig } from '../../../data/types'

// ---------------------------------------------------------------------------
// Machine modules are stored as `ModuleConfig[]` (module id and count). The panel shows one button per slot,
// a view over that list: slots fill in list order, and a slot beyond the machine's count is an overflow slot.
// ---------------------------------------------------------------------------

/** One entry per slot, `undefined` for an empty one; at least `slotCount` entries, more when the modules overflow. */
export function slotsOf(modules: readonly ModuleConfig[], slotCount: number): (string | undefined)[] {
  const filled = modules.flatMap(m => Array.from({ length: Math.max(0, m.count) }, () => m.moduleId))
  const slots: (string | undefined)[] = [...filled]
  while (slots.length < slotCount) slots.push(undefined)
  return slots
}

/**
 * The module list after setting one slot (`undefined` empties it). The list is a multiset, so exactly one module changes:
 * the module shown in that slot loses one, the new one gains one. Every other entry keeps its place; the displayed slots
 * (grouped by module in list order) may therefore shift, but never change contents.
 */
export function setSlot(
  modules: readonly ModuleConfig[],
  slotCount: number,
  index: number,
  moduleId: string | undefined,
): ModuleConfig[] {
  const slots = slotsOf(modules, slotCount)
  if (index < 0 || index >= slots.length) return [...modules]
  const old = slots[index]
  if (old === moduleId) return [...modules]
  const next = modules.map(m => ({ ...m }))
  if (old !== undefined) {
    const entry = next.find(m => m.moduleId === old && m.count > 0)
    if (entry) entry.count -= 1
  }
  if (moduleId !== undefined) {
    const entry = next.find(m => m.moduleId === moduleId)
    if (entry) entry.count += 1
    else next.push({ moduleId, count: 1 })
  }
  return next.filter(m => m.count > 0)
}
