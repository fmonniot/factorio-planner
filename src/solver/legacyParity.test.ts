import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import { solveAll } from './index'
import { exactKey } from './solveCache'
import { loadGameDataFromJson, parseAppState } from '../data/loader'

// Guard for blocks without areas: they must keep solving exactly as before the area-aware solve
// existed. Every plan in e2e/fixtures is solved on its bundled data set and the whole result
// (nodes, flows, loops, errors) is compared, digit for digit, with a committed golden file.
// Regenerate (`vitest -u`) only for a solver change that is meant to change the results of
// blocks without areas.

const ROOT = resolve(import.meta.dirname, '../..')
const FIXTURES = resolve(ROOT, 'e2e/fixtures')

function bundled(dir: string) {
  return loadGameDataFromJson(readFileSync(resolve(ROOT, `public/data/${dir}/game-data.json`), 'utf-8'))
}

const nullius = bundled('nullius')
const seablock = bundled('kompetenz-seablock')

// Plans written for areas: their e2e flow turns an area on, so they are not part of the golden.
const AREA_FIXTURES = new Set(['separate-area.json'])

function planFixtures(): string[] {
  return readdirSync(FIXTURES)
    .filter(f => f.endsWith('.json') && !AREA_FIXTURES.has(f))
    .filter(f => 'blocks' in JSON.parse(readFileSync(resolve(FIXTURES, f), 'utf-8')))
    .sort()
}

describe('legacy parity (blocks without areas)', () => {
  it('solves every e2e fixture plan exactly as the golden file records', async () => {
    const lines: string[] = []
    for (const file of planFixtures()) {
      const state = parseAppState(JSON.parse(readFileSync(resolve(FIXTURES, file), 'utf-8')))
      const gameData = file.includes('seablock') ? seablock : nullius
      lines.push(`${file}\t${exactKey(solveAll(state.blocks, gameData))}`)
    }
    expect(lines.length).toBeGreaterThan(10)
    await expect(lines.join('\n') + '\n').toMatchFileSnapshot('__snapshots__/legacyParity.json')
  })
})
