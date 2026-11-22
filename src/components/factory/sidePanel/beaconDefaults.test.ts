import { describe, it, expect } from 'vitest'
import type { GameData } from '../../../data/types'
import { defaultBeaconConfig } from './beaconDefaults'

const mod = (id: string, name: string, category: string) => ({
  id, name, iconPath: '', category, effects: { speed: 0.2 }, limitation: [], limitationBlacklist: [], tier: 1,
})
// Fresh each call.
const makeData = (categories?: string[]) => ({
  recipes: { r: { allowProductivity: false } },
  modules: { a: mod('a', 'Agriculture', 'angels-bio-yield'), s: mod('s', 'Speed', 'speed') },
  beacons: {
    beacon: {
      id: 'beacon', name: 'Beacon', hidden: false, moduleSlots: 2, distributionEfficiency: 1.5,
      allowedEffects: ['speed'], ...(categories && { allowedModuleCategories: categories }),
    },
  },
}) as unknown as GameData
const horizon = { moduleIds: null, beaconIds: null } as never

describe('defaultBeaconConfig and module categories', () => {
  it('takes the first module by name when the beacon lists no categories', () => {
    expect(defaultBeaconConfig(makeData(), horizon, 'r')?.modules).toEqual([{ moduleId: 'a', count: 2 }])
  })

  it('skips a first module whose category the beacon does not list', () => {
    expect(defaultBeaconConfig(makeData(['speed']), horizon, 'r')?.modules).toEqual([{ moduleId: 's', count: 2 }])
  })

  it('is undefined when no module fits', () => {
    expect(defaultBeaconConfig(makeData([]), horizon, 'r')).toBeUndefined()
  })
})
