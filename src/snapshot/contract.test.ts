import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import Ajv2020 from 'ajv/dist/2020'
import { describe, it, expect } from 'vitest'
import { SnapshotSchema, SNAPSHOT_VERSION, type Snapshot } from './schema'
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
    const blocks = Object.values(generated).flatMap(s => s.blocks)
    const rows = blocks.flatMap(b => b.rows)
    const refs = blocks.flatMap(b => [...b.products, ...b.imports, ...b.connections])
    expect(blocks.some(b => b.areas && b.rows.every(r => r.area !== undefined)), 'a block with areas').toBe(true)
    expect(blocks.some(b => b.connections.length > 0), 'a connection').toBe(true)
    expect(refs.some(r => r.type === 'fluid'), 'a fluid').toBe(true)
    expect(refs.some(r => r.type === 'virtual' && r.id === 'electricity'), 'a virtual item').toBe(true)
    expect(blocks.some(b => b.connections.some(c => c.type === 'virtual')), 'a virtual connection').toBe(true)
    expect(blocks.some(b => b.error !== undefined && b.rows.length > 0), 'a failed block with rows').toBe(true)
    expect(rows.some(r => r.machine === undefined), 'a row without machine').toBe(true)
    expect(rows.some(r => r.machines === undefined && r.throughput === undefined), 'a row without solved values').toBe(true)
    for (const kind of ['mining', 'offshore', 'power']) {
      expect(rows.some(r => 'kind' in r && r.kind === kind && r.product !== undefined), `a ${kind} row`).toBe(true)
    }
    const warnings = blocks.flatMap(b => b.warnings)
    for (const key of ['items', 'recipes', 'blocks', 'areas'] as const) {
      expect(warnings.some(w => w[key] !== undefined), `a warning with ${key}`).toBe(true)
    }
    // The loop fixture really is a loop of blocks.
    expect(solveAll(loopBlocks(), loadSeablock()).loops.length).toBeGreaterThan(0)
    // Non-ASCII names: a multi-byte character, a 3-byte CJK one and a surrogate pair.
    const names = JSON.stringify(generated.unicode.blocks.map(b => [b.name, b.areas]))
    expect(names).toMatch(/é/)
    expect(names).toMatch(/鉄/)
    expect(names).toMatch(/🏭/u)
  })

  it('sends no exporter-invented id: no game-id field contains ":"', () => {
    for (const [name, snapshot] of Object.entries(generated)) {
      const ids = ruleIds(snapshot)
      expect(ids.length, name).toBeGreaterThan(0)
      expect(ids.filter(id => id.includes(':')), name).toEqual([])
    }
  })
})

/** Every game id in a snapshot: item references, machines and recipe ids (names and messages are free text). */
export function ruleIds(snapshot: Snapshot): string[] {
  const ids: string[] = []
  for (const b of snapshot.blocks) {
    for (const r of [...b.products, ...b.imports, ...b.connections]) ids.push(r.id)
    for (const row of b.rows) {
      if ('recipe' in row) ids.push(row.recipe)
      else if (row.product) ids.push(row.product.id)
      if (row.machine) ids.push(row.machine)
    }
    for (const w of b.warnings) ids.push(...(w.items ?? []).map(i => i.id), ...(w.recipes ?? []))
  }
  return ids
}

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

  it('accepts and rejects the same inputs as the Zod schema', () => {
    const validate = new Ajv2020({ strict: true }).compile(JSON.parse(checkedIn))
    const good = JSON.parse(readFixture('small.json'))
    const block = good.blocks[0]
    const withBlock = (over: object) => ({ ...good, blocks: [{ ...block, ...over }] })
    const cases: unknown[] = [
      good,
      { ...good, dataSet: { id: 'x' } },
      withBlock({ rows: [{ recipe: 'pipe' }] }),
      withBlock({ rows: [{ kind: 'power', product: { id: 'electricity', type: 'virtual' } }] }),
      withBlock({ error: 'failed' }),
      // Rejected by both:
      { ...good, v: 2 },
      { ...good, extra: 1 },
      { ...good, dataSet: undefined },
      { ...good, dataSet: { id: 'x', extra: 1 } },
      { ...good, dataSet: { id: '' } },
      withBlock({ color: 'red' }),
      withBlock({ products: [{ id: 'x', type: 'solid', rate: 1 }] }),
      withBlock({ products: [{ id: 'x', type: 'item', rate: -1 }] }),
      withBlock({ rows: [{ recipe: 'pipe', machinesCeil: 1.5 }] }),
      withBlock({ rows: [{ recipe: 'pipe', kind: 'power' }] }),
      withBlock({ rows: [{ kind: 'smithing' }] }),
      withBlock({ rows: [{ machine: 'asm' }] }),
      withBlock({ error: null }),
    ]
    for (const c of cases) {
      expect(validate(c), JSON.stringify(c)).toBe(SnapshotSchema.safeParse(c).success)
    }
    expect(cases.filter(c => validate(c)).length).toBe(5)
  })
})
