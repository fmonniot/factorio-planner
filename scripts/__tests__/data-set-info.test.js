import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { dataSetInfoOf } from '../data-set-info.js'

const root = join(import.meta.dirname, '..', '..', 'public', 'data')

describe('dataSetInfoOf', () => {
  it('keeps the versions and counts the recipes a player can use', () => {
    expect(dataSetInfoOf({
      factorioVersion: '2.0.1',
      modSet: { base: '2.0.1', nullius: '2.0.4' },
      recipes: { a: { hidden: false }, b: { hidden: true }, c: {} },
      items: { ignored: {} },
    })).toEqual({ factorioVersion: '2.0.1', modSet: { base: '2.0.1', nullius: '2.0.4' }, recipeCount: 2 })
  })
})

describe('bundled data sets', () => {
  for (const name of readdirSync(root).filter(n => existsSync(join(root, n, 'game-data.json')))) {
    it(`${name}: info.json matches game-data.json (run npm run data-info after an export)`, () => {
      const bundle = JSON.parse(readFileSync(join(root, name, 'game-data.json'), 'utf8'))
      const info = JSON.parse(readFileSync(join(root, name, 'info.json'), 'utf8'))
      expect(info).toEqual(dataSetInfoOf(bundle))
    })
  }
})
