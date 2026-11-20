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

/**
 * The modules of a beacon after its type changes from `oldSlots` to `newSlots` slots. One module type filling every old slot
 * keeps filling every slot of the new type; anything else keeps its modules from the start of the list, dropping the overflow.
 */
export function fitModules(modules: readonly ModuleConfig[], oldSlots: number, newSlots: number): ModuleConfig[] {
  const used = modules.filter(m => m.count > 0)
  const total = used.reduce((n, m) => n + m.count, 0)
  if (used.length === 1 && total === oldSlots) return newSlots > 0 ? [{ ...used[0], count: newSlots }] : []
  let room = newSlots
  const out: ModuleConfig[] = []
  for (const m of used) {
    const count = Math.min(m.count, room)
    if (count <= 0) break
    out.push({ ...m, count })
    room -= count
  }
  return out
}
