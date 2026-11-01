import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import Ajv2020 from 'ajv/dist/2020'
import { describe, it, expect } from 'vitest'
import { SnapshotSchema, SNAPSHOT_VERSION } from './schema'
import { buildSnapshotFixtures, loopBlocks, buildSnapshotJsonSchema, loadSeablock, toFileText } from '../test/snapshotFixtures'
import { solveAll } from '../solver'

// The checked-in contract (contract/) is read by the Lua and Rust tests. These tests keep it
// in step with the Zod schema and the projection; run `npm run contract` to regenerate it.

const CONTRACT_DIR = resolve(import.meta.dirname, '../../contract')
const FIXTURES_DIR = join(CONTRACT_DIR, 'fixtures')

const fixtureFiles = readdirSync(FIXTURES_DIR).filter(f => f.endsWith('.json')).sort()
const readFixture = (file: string): string => readFileSync(join(FIXTURES_DIR, file), 'utf-8')

function containsNull(value: unknown): boolean {
  if (value === null) return true
  if (Array.isArray(value)) return value.some(containsNull)
  if (typeof value === 'object') return Object.values(value as object).some(containsNull)
  return false
}

describe('contract fixtures', () => {
  const generated = buildSnapshotFixtures()

  it('has every fixture the generator builds, and no other', () => {
    expect(fixtureFiles).toEqual(Object.keys(generated).map(n => `${n}.json`).sort())
  })

  it.each(fixtureFiles)('%s parses with SnapshotSchema', file => {
    const result = SnapshotSchema.safeParse(JSON.parse(readFixture(file)))
    expect(result.success, result.success ? '' : result.error.message).toBe(true)
    expect(JSON.parse(readFixture(file)).v).toBe(SNAPSHOT_VERSION)
  })

  it.each(fixtureFiles)('%s matches a fresh generation', file => {
    const name = file.replace(/\.json$/, '')
    expect(readFixture(file), `run npm run contract; ${file} is out of date`).toBe(toFileText(generated[name]))
  })

  it.each(fixtureFiles)('%s contains no JSON null', file => {
    expect(containsNull(JSON.parse(readFixture(file)))).toBe(false)
    expect(readFixture(file)).not.toMatch(/\bnull\b/)
  })

  it('covers the shapes the other sides must read', () => {
    const all = Object.values(generated)
    const blocks = all.flatMap(s => s.blocks)
    expect(blocks.some(b => b.areas && b.rows.every(r => r.area !== undefined)), 'a block with areas').toBe(true)
    expect(blocks.some(b => b.connections.length > 0), 'a connection').toBe(true)
    expect(blocks.some(b => b.warnings.length > 0), 'a warning').toBe(true)
    expect(blocks.some(b => b.products.some(p => p.type === 'fluid')), 'a fluid').toBe(true)
    // The loop fixture really is a loop of blocks.
    const gameData = loadSeablock()
    expect(Object.keys(generated)).toContain('seablock-loop')
    expect(solveAll(loopBlocks(), gameData).loops.length).toBeGreaterThan(0)
    // Non-ASCII names: a multi-byte character, a 3-byte CJK one and a surrogate pair.
    const names = JSON.stringify(generated.unicode.blocks.map(b => [b.name, b.areas]))
    expect(names).toMatch(/é/)
    expect(names).toMatch(/鉄/)
    expect(names).toMatch(/🏭/u)
  })
})

describe('contract/snapshot.schema.json', () => {
  const checkedIn = readFileSync(join(CONTRACT_DIR, 'snapshot.schema.json'), 'utf-8')

  it('matches a fresh generation from the Zod schema', () => {
    expect(checkedIn, 'run npm run contract; snapshot.schema.json is out of date').toBe(
      toFileText(buildSnapshotJsonSchema()),
    )
  })

  it('validates every fixture', () => {
    const validate = new Ajv2020({ strict: true }).compile(JSON.parse(checkedIn))
    for (const file of fixtureFiles) {
      const ok = validate(JSON.parse(readFixture(file)))
      expect(ok, `${file}: ${JSON.stringify(validate.errors)}`).toBe(true)
    }
  })

  it('rejects what the Zod schema rejects', () => {
    const validate = new Ajv2020({ strict: true }).compile(JSON.parse(checkedIn))
    const good = JSON.parse(readFixture('small.json'))
    const bad: unknown[] = [
      { ...good, v: 2 },
      { ...good, extra: 1 },
      { ...good, dataSet: undefined },
      { ...good, blocks: [{ ...good.blocks[0], color: 'red' }] },
      { ...good, blocks: [{ ...good.blocks[0], products: [{ id: 'x', type: 'solid', rate: 1 }] }] },
      { ...good, blocks: [{ ...good.blocks[0], error: null }] },
    ]
    for (const b of bad) {
      expect(validate(b), JSON.stringify(b)).toBe(false)
      expect(SnapshotSchema.safeParse(b).success).toBe(false)
    }
  })
})
