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

/** The module list a slot view stands for: equal modules grouped in order of first appearance, empty slots dropped. */
export function modulesFromSlots(slots: readonly (string | undefined)[]): ModuleConfig[] {
  const counts = new Map<string, number>()
  for (const id of slots) if (id !== undefined) counts.set(id, (counts.get(id) ?? 0) + 1)
  return [...counts].map(([moduleId, count]) => ({ moduleId, count }))
}

/** The module list after setting one slot (`undefined` empties it). */
export function setSlot(
  modules: readonly ModuleConfig[],
  slotCount: number,
  index: number,
  moduleId: string | undefined,
): ModuleConfig[] {
  const slots = slotsOf(modules, slotCount)
  if (index < 0 || index >= slots.length) return [...modules]
  slots[index] = moduleId
  return modulesFromSlots(slots)
}
