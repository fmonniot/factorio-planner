import { describe, it, expect } from 'vitest'
import { modulesFromSlots, setSlot, slotsOf } from './moduleSlots'

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

describe('modulesFromSlots', () => {
  it('groups equal modules in order of first appearance and drops empty slots', () => {
    expect(modulesFromSlots(['a', undefined, 'b', 'a'])).toEqual([{ moduleId: 'a', count: 2 }, { moduleId: 'b', count: 1 }])
  })
})

describe('setSlot', () => {
  const modules = [{ moduleId: 'a', count: 2 }]

  it('fills an empty slot', () => {
    expect(setSlot(modules, 4, 2, 'b')).toEqual([{ moduleId: 'a', count: 2 }, { moduleId: 'b', count: 1 }])
  })

  it('replaces a module', () => {
    expect(setSlot(modules, 4, 0, 'b')).toEqual([{ moduleId: 'b', count: 1 }, { moduleId: 'a', count: 1 }])
  })

  it('empties a slot', () => {
    expect(setSlot(modules, 4, 1, undefined)).toEqual([{ moduleId: 'a', count: 1 }])
    expect(setSlot([{ moduleId: 'a', count: 1 }], 4, 0, undefined)).toEqual([])
  })

  it('ignores a slot index out of range', () => {
    expect(setSlot(modules, 4, 9, 'b')).toEqual(modules)
  })
})
