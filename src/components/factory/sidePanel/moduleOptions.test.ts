import { describe, it, expect } from 'vitest'
import type { GameData } from '../../../data/types'
import { machineModuleOptions, beaconModuleOptions } from './moduleOptions'

const mod = (id: string, name: string) => ({
  id, name, iconPath: '', category: 'speed', effects: { speed: 0.2 }, limitation: [], limitationBlacklist: [], tier: 1,
})
const gd = {
  recipes: { r: { allowProductivity: false } },
  modules: { z: mod('z', 'Zed'), a: mod('a', 'Alpha'), m: mod('m', 'Mid') },
} as unknown as GameData
const horizon = { moduleIds: null } as never

describe('module options', () => {
  it('lists the modules of a machine and of a beacon by name', () => {
    const effects = { allowedEffects: ['speed', 'consumption', 'pollution', 'productivity', 'quality'] }
    expect(machineModuleOptions(gd, horizon, effects, 'r').map(m => m.id)).toEqual(['a', 'm', 'z'])
    expect(beaconModuleOptions(gd, horizon, effects, 'r').map(m => m.id)).toEqual(['a', 'm', 'z'])
  })
})
