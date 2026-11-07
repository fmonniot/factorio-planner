import { describe, it, expect } from 'vitest'
import { setSlot, slotsOf } from './moduleSlots'

describe('slotsOf', () => {
  it('expands counts into slots and pads with empty ones', () => {
    expect(slotsOf([{ moduleId: 'a', count: 2 }, { moduleId: 'b', count: 1 }], 5)).toEqual(['a', 'a', 'b', undefined, undefined])
  })

  it('keeps the overflow when there are more modules than slots', () => {
    expect(slotsOf([{ moduleId: 'a', count: 3 }], 2)).toEqual(['a', 'a', 'a'])
  })

  it('has no slots for no machine and no modules', () => {
    expect(slotsOf([], 0)).toEqual([])
  })
})

describe('setSlot', () => {
  const modules = [{ moduleId: 'a', count: 2 }]

  it('fills an empty slot', () => {
    expect(setSlot(modules, 4, 2, 'b')).toEqual([{ moduleId: 'a', count: 2 }, { moduleId: 'b', count: 1 }])
  })

  it('replaces a module', () => {
    expect(setSlot(modules, 4, 0, 'b')).toEqual([{ moduleId: 'a', count: 1 }, { moduleId: 'b', count: 1 }])
  })

  it('empties a slot', () => {
    expect(setSlot(modules, 4, 1, undefined)).toEqual([{ moduleId: 'a', count: 1 }])
    expect(setSlot([{ moduleId: 'a', count: 1 }], 4, 0, undefined)).toEqual([])
  })

  it('ignores a slot index out of range', () => {
    expect(setSlot(modules, 4, 9, 'b')).toEqual(modules)
  })

  it('changes the multiset by exactly one module, whichever slot is edited', () => {
    const mods = [{ moduleId: 'a', count: 2 }, { moduleId: 'b', count: 1 }] // displayed [a, a, b, empty]
    const tally = (m: readonly { moduleId: string; count: number }[]) => {
      const t: Record<string, number> = {}
      for (const x of m) t[x.moduleId] = (t[x.moduleId] ?? 0) + x.count
      return t
    }
    expect(tally(setSlot(mods, 4, 2, 'a'))).toEqual({ a: 3 }) // b -> a
    expect(tally(setSlot(mods, 4, 0, undefined))).toEqual({ a: 1, b: 1 }) // empty slot 0
    expect(tally(setSlot(mods, 4, 3, 'b'))).toEqual({ a: 2, b: 2 }) // fill the empty slot
    expect(tally(setSlot(mods, 4, 1, 'b'))).toEqual({ a: 1, b: 2 })
  })

  it('leaves the other entries in place and the layout deterministic', () => {
    const mods = [{ moduleId: 'a', count: 1 }, { moduleId: 'b', count: 1 }, { moduleId: 'c', count: 1 }]
    const next = setSlot(mods, 4, 0, undefined)
    expect(next).toEqual([{ moduleId: 'b', count: 1 }, { moduleId: 'c', count: 1 }])
    expect(slotsOf(next, 4)).toEqual(['b', 'c', undefined, undefined])
  })

  it('does nothing when the slot already holds the module', () => {
    expect(setSlot(modules, 4, 0, 'a')).toEqual(modules)
    expect(setSlot(modules, 4, 3, undefined)).toEqual(modules)
  })
})
