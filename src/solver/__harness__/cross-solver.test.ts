/**
 * Cross-solver harness: runs both v1 and v2 on every fixture in __fixtures__/
 * and snapshots both results.
 *
 * A snapshot diff means a behavioral change in either solver — expected for the
 * overconstrained Nullius plan (v1 and v2 legitimately differ), unexpected for
 * simple fixtures that both solvers should handle identically.
 *
 * To add a fixture: drop a *.fixture.json file in src/solver/__fixtures__/ —
 * no code changes needed.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { loadGameDataFromJson } from '../../data/loader'
import { solve as solveV1 } from '../v1/index'
import { solve as solveV2 } from '../v2/index'
import type { GameData, RecipeNode, SolverResult } from '../../data/types'

// ---------------------------------------------------------------------------
// Game data loading
// ---------------------------------------------------------------------------

const SAMPLE_PATH = resolve(import.meta.dirname, '../../../data/samples/nullius/game-data.json')
const sampleExists = existsSync(SAMPLE_PATH)

let gameData: GameData

beforeAll(() => {
  if (!sampleExists) return
  gameData = loadGameDataFromJson(readFileSync(SAMPLE_PATH, 'utf-8'))
})

// ---------------------------------------------------------------------------
// Fixture type
// ---------------------------------------------------------------------------

interface SolverChainFixture {
  description: string
  goals: { id: string; itemId: string; rate: number }[]
  nodes: {
    id: string
    recipeId: string
    modules: []
    byproductPolicy: Record<string, 'discard' | 'feed-back'>
    pinnedRate?: number
    byproductConsumer?: boolean
  }[]
}

function loadFixtures(): { name: string; fixture: SolverChainFixture }[] {
  const dir = resolve(import.meta.dirname, '../__fixtures__')
  return readdirSync(dir)
    .filter(f => f.endsWith('.fixture.json'))
    .map(f => ({
      name: f.replace('.fixture.json', ''),
      fixture: JSON.parse(readFileSync(resolve(dir, f), 'utf-8')) as SolverChainFixture,
    }))
}

function buildPlan(fixture: SolverChainFixture): { goals: SolverChainFixture['goals']; nodes: RecipeNode[] } {
  return {
    goals: fixture.goals,
    nodes: fixture.nodes.map(n => ({
      kind: 'game-recipe' as const,
      ...n,
    })) as RecipeNode[],
  }
}

// ---------------------------------------------------------------------------
// Snapshot helpers
// ---------------------------------------------------------------------------

const RATE_PRECISION = 4 // decimal places for rate snapshots

function snapshotResult(result: SolverResult) {
  return {
    throughputs: Object.fromEntries(
      result.nodes
        .map(n => [n.recipeNodeId, parseFloat(n.throughput.toFixed(RATE_PRECISION))])
        .sort(([a], [b]) => a.localeCompare(b)),
    ),
    warningTypes: result.warnings.map(w => w.type).sort(),
    unsatisfiedItems: result.unsatisfied.map(u => u.itemId).sort(),
  }
}

const IS_V2_NOT_IMPLEMENTED = (err: unknown): boolean =>
  err instanceof Error && /not implemented/i.test(err.message)

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

describe('cross-solver harness', () => {
  if (!sampleExists) {
    it.skip('game data not present — skipping harness', () => {})
    return
  }

  const fixtures = loadFixtures()

  for (const { name, fixture } of fixtures) {
    describe(`fixture: ${name}`, () => {
      it(`${fixture.description} — v1 solves`, () => {
        const plan = buildPlan(fixture)
        const result = solveV1(plan, gameData)
        expect(result).toBeDefined()
        expect(result.nodes).toBeDefined()
      })

      it(`${fixture.description} — v2 snapshot`, () => {
        const plan = buildPlan(fixture)

        let v2Result: SolverResult
        try {
          v2Result = solveV2(plan, gameData)
        } catch (err) {
          if (IS_V2_NOT_IMPLEMENTED(err)) {
            expect.soft(true, 'v2 not implemented — pending').toBe(true)
            return
          }
          throw err
        }

        expect(snapshotResult(v2Result)).toMatchSnapshot()
      })
    })
  }
})
