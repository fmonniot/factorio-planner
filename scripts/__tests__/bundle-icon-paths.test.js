import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

// Regression guard: committed bundles hold public-relative iconPaths
// (`/data/<dataset>/icons/<id>.png`), never machine-specific absolute paths.
const PUBLIC_DIR = join(import.meta.dirname, '../../public')
const DATA_DIR = join(PUBLIC_DIR, 'data')

function collect(node, out = []) {
  if (Array.isArray(node)) node.forEach(n => collect(n, out))
  else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (k === 'iconPath' && typeof v === 'string') out.push(v)
      else collect(v, out)
    }
  }
  return out
}

describe('bundled icon paths', () => {
  const bundles = readdirSync(DATA_DIR).filter(d => existsSync(join(DATA_DIR, d, 'game-data.json')))

  it('finds the bundles', () => {
    expect(bundles).toContain('nullius')
  })

  for (const dir of bundles) {
    const paths = collect(JSON.parse(readFileSync(join(DATA_DIR, dir, 'game-data.json'), 'utf8'))).filter(p => p !== '')

    it(`${dir} has only public-relative iconPaths`, () => {
      const bad = paths.filter(p => p.startsWith('//') || p.includes('/Users/') || p.includes('/home/')
        || /^[A-Za-z]:\\/.test(p) || !p.startsWith('/data/'))
      expect(bad.slice(0, 5), 'iconPaths that are absolute or start with //').toEqual([])
    })

    it(`${dir} iconPaths exist on disk`, () => {
      const missing = paths.filter(p => !existsSync(join(PUBLIC_DIR, p)))
      expect(missing.slice(0, 5), 'iconPaths with no file under public/').toEqual([])
    })
  }
})
