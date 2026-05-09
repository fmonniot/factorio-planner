/**
 * Integration test: validates the real Nullius game-data export against the schema.
 *
 * The export lives at public/data/nullius/game-data.json — the same file the
 * web app loads at runtime. Tests skip automatically when it is absent.
 *
 * To regenerate, see scripts/build-game-data.js (its --output default points
 * at public/data/nullius/game-data.json).
 */

import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { loadGameDataFromJson } from './loader'

const SAMPLE_PATH = resolve(
  import.meta.dirname,
  '../../public/data/nullius/game-data.json',
)

const sampleExists = existsSync(SAMPLE_PATH)

describe('Nullius game-data.json integration', () => {
  it.skipIf(!sampleExists)(
    'passes GameData schema validation',
    () => {
      const json = readFileSync(SAMPLE_PATH, 'utf-8')
      // If this throws GameDataLoadError the test fails with a useful diff.
      const data = loadGameDataFromJson(json)

      expect(data.factorioVersion).toMatch(/^\d+\.\d+\.\d+$/)
      expect(Object.keys(data.items).length).toBeGreaterThan(100)
      expect(Object.keys(data.recipes).length).toBeGreaterThan(100)
      expect(Object.keys(data.machines).length).toBeGreaterThan(0)
      expect(Object.keys(data.modules).length).toBeGreaterThan(0)
    },
  )

  it.skipIf(!sampleExists)(
    'contains expected Nullius recipes from the test corpus',
    () => {
      const json = readFileSync(SAMPLE_PATH, 'utf-8')
      const data = loadGameDataFromJson(json)

      // Corpus case 1 & 2 (Nullius dropped the -1 suffix from basic recipes)
      expect(data.recipes['nullius-iron-ingot']).toBeDefined()
      expect(data.recipes['nullius-iron-plate']).toBeDefined()
      expect(data.recipes['nullius-iron-rod']).toBeDefined()
      expect(data.recipes['nullius-iron-gear']).toBeDefined()

      // Corpus case 3
      expect(data.recipes['nullius-air-separation-2']).toBeDefined()

      // Corpus cases 4–6 (base-game recipes present in Nullius)
      expect(data.recipes['kovarex-enrichment-process']).toBeDefined()
      expect(data.recipes['uranium-processing']).toBeDefined()
    },
  )

  it.skipIf(!sampleExists)(
    'kovarex recipe has correct ignoredByProductivity values',
    () => {
      const json = readFileSync(SAMPLE_PATH, 'utf-8')
      const data = loadGameDataFromJson(json)

      const kovarex = data.recipes['kovarex-enrichment-process']
      expect(kovarex).toBeDefined()

      const u235 = kovarex.products.find(p => p.itemId === 'uranium-235')
      const u238 = kovarex.products.find(p => p.itemId === 'uranium-238')

      expect(u235?.amount).toBe(41)
      expect(u235?.ignoredByProductivity).toBe(40)
      expect(u238?.amount).toBe(2)
      expect(u238?.ignoredByProductivity).toBe(2)
    },
  )

  it.skipIf(!sampleExists)(
    'uranium-processing has probability outputs',
    () => {
      const json = readFileSync(SAMPLE_PATH, 'utf-8')
      const data = loadGameDataFromJson(json)

      const recipe = data.recipes['uranium-processing']
      expect(recipe).toBeDefined()

      const u235 = recipe.products.find(p => p.itemId === 'uranium-235')
      const u238 = recipe.products.find(p => p.itemId === 'uranium-238')

      expect(u235?.probability).toBeCloseTo(0.007)
      expect(u238?.probability).toBeCloseTo(0.993)
    },
  )

  it.skipIf(!sampleExists)(
    'all recipe madeIn machine ids exist in machines record',
    () => {
      const json = readFileSync(SAMPLE_PATH, 'utf-8')
      const data = loadGameDataFromJson(json)

      const machineIds = new Set(Object.keys(data.machines))
      const broken: string[] = []

      for (const [recipeId, recipe] of Object.entries(data.recipes)) {
        for (const machineId of recipe.madeIn) {
          if (!machineIds.has(machineId)) {
            broken.push(`${recipeId} references unknown machine ${machineId}`)
          }
        }
      }

      expect(broken).toHaveLength(0)
    },
  )

  it.skipIf(!sampleExists)(
    'defaultMachines keys are all known recipe categories',
    () => {
      const json = readFileSync(SAMPLE_PATH, 'utf-8')
      const data = loadGameDataFromJson(json)

      const machineIds = new Set(Object.keys(data.machines))

      for (const [category, machineId] of Object.entries(data.defaultMachines)) {
        expect(
          machineIds.has(machineId),
          `defaultMachines[${category}] = ${machineId} is not a known machine`,
        ).toBe(true)
      }
    },
  )
})
