import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { RESIDUE_RE } from '../locale.js'

// Regression guard: no committed bundle may contain unexpanded Factorio
// placeholders (`__ITEM__x__`, ...) in a name. The Nullius bundle still does;
// see the backlog item "Technology data for the Nullius bundle". The exact
// equality fails once it is fixed, so the list below gets emptied.
const KNOWN = {
  nullius: [
    ...['bob-storage-tank-2', 'bob-storage-tank-3', 'bob-storage-tank-4',
      'bob-storage-tank-all-corners', 'bob-storage-tank-all-corners-2',
      'bob-storage-tank-all-corners-3', 'bob-storage-tank-all-corners-4',
      'cybersyn-constant-combinator', 'bob-repair-pack-2', 'bob-repair-pack-3',
      'bob-repair-pack-4', 'bob-repair-pack-5'].flatMap(id => [`items:${id}`, `recipes:${id}`]),
  ].sort(),
}

const SECTIONS = ['items', 'recipes', 'machines', 'modules', 'beacons', 'itemGroups', 'technologies']
const DATA_DIR = join(import.meta.dirname, '../../public/data')

function residueIds(bundle) {
  const out = []
  for (const section of SECTIONS) {
    for (const [id, entry] of Object.entries(bundle[section] ?? {})) {
      if (RESIDUE_RE.test(entry.name ?? '')) out.push(`${section}:${id}`)
    }
  }
  return out.sort()
}

describe('bundled names', () => {
  const bundles = readdirSync(DATA_DIR).filter(d => existsSync(join(DATA_DIR, d, 'game-data.json')))

  it('finds the bundles', () => {
    expect(bundles).toContain('kompetenz-seablock')
  })

  for (const dir of bundles) {
    it(`${dir} has only the known unexpanded placeholders`, () => {
      const bundle = JSON.parse(readFileSync(join(DATA_DIR, dir, 'game-data.json'), 'utf8'))
      expect(residueIds(bundle)).toEqual(KNOWN[dir] ?? [])
    })
  }
})
