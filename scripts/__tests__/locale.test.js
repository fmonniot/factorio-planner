import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  parseCfg, buildLocaleMap, expandPlaceholders, resolveLocale,
  resolveTechnologyName, resolveRecipeName, parsePrototypeLocale, gameName,
} from '../locale.js'

// Each call returns a fresh map.
function makeLocale() {
  return {
    'item-name.iron-plate': 'Iron plate',
    'entity-name.boiler': 'Boiler',
    'entity-name.spidertron': 'Spidertron',
    'item-name.only-item': 'Only item',
    'entity-name.only-entity': 'Only entity',
    'fluid-name.water': 'Water',
    'tile-name.stone-path': 'Stone path',
    'technology-name.mining-productivity': 'Mining productivity',
  }
}

describe('parseCfg', () => {
  it('parses sections, skips comments, keeps spaces after the equals sign', () => {
    const out = parseCfg('# c\n; c\n[item-name]\na= Alpha b\n\n[fluid-name]\nb=Beta\nnoeq\n')
    expect(out).toEqual({ 'item-name.a': ' Alpha b', 'fluid-name.b': 'Beta' })
  })
})

describe('buildLocaleMap', () => {
  it('merges .cfg files from all resolvers', () => {
    const resolvers = {
      a: {
        listFiles: () => ['locale/en/a.cfg', 'locale/en/readme.txt'],
        readFile: () => Buffer.from('[item-name]\nx=X\n'),
      },
      b: {
        listFiles: () => { throw new Error('boom') },
        readFile: () => null,
      },
      c: {
        listFiles: () => ['locale/en/c.cfg'],
        readFile: () => Buffer.from('[item-name]\ny=Y\n'),
      },
    }
    expect(buildLocaleMap(resolvers)).toEqual({ 'item-name.x': 'X', 'item-name.y': 'Y' })
  })
})

describe('expandPlaceholders', () => {
  it('expands a whole token', () => {
    expect(expandPlaceholders('__ITEM__iron-plate__', makeLocale())).toEqual({ text: 'Iron plate', ok: true })
  })

  it('expands partial tokens', () => {
    const l = makeLocale()
    expect(expandPlaceholders('Heavy __ENTITY__spidertron__', l).text).toBe('Heavy Spidertron')
    expect(expandPlaceholders('__ENTITY__boiler__ 2', l).text).toBe('Boiler 2')
  })

  it('expands two tokens', () => {
    expect(expandPlaceholders('__ITEM__iron-plate__ in __FLUID__water__', makeLocale()))
      .toEqual({ text: 'Iron plate in Water', ok: true })
  })

  it('expands nested tokens', () => {
    const l = makeLocale()
    l['item-name.nested'] = 'Big __ENTITY__boiler__'
    expect(expandPlaceholders('__ITEM__nested__', l)).toEqual({ text: 'Big Boiler', ok: true })
  })

  it('falls back across scopes', () => {
    const l = makeLocale()
    expect(expandPlaceholders('__ITEM__only-entity__', l).text).toBe('Only entity')
    expect(expandPlaceholders('__ENTITY__only-item__', l).text).toBe('Only item')
  })

  it('expands FLUID and TILE', () => {
    const l = makeLocale()
    expect(expandPlaceholders('__FLUID__water__', l).text).toBe('Water')
    expect(expandPlaceholders('__TILE__stone-path__', l).text).toBe('Stone path')
  })

  it('replaces an unknown id with the bare id and reports not ok', () => {
    expect(expandPlaceholders('__ITEM__nope__', makeLocale())).toEqual({ text: 'nope', ok: false })
  })

  it('terminates on cycles', () => {
    const l = { 'item-name.a': '__ITEM__b__', 'item-name.b': '__ITEM__a__' }
    expect(expandPlaceholders('__ITEM__a__', l).ok).toBe(false)
  })

  it('reports a malformed token as not ok', () => {
    expect(expandPlaceholders('__ITEM__x', makeLocale()).ok).toBe(false)
  })

  it('does not treat other Factorio tokens as residue', () => {
    expect(expandPlaceholders('Remote (__CONTROL__x__)', makeLocale()).ok).toBe(true)
    expect(expandPlaceholders('__REMARK_COLOR_BEGIN__Hi', makeLocale()).ok).toBe(true)
  })

  it('reports a malformed token without closing underscores as not ok', () => {
    expect(expandPlaceholders('__ITEM__sct-t3-sulfur-lightsource', makeLocale()).ok).toBe(false)
  })

  it('does not treat numeric placeholders as residue', () => {
    expect(expandPlaceholders('Foo __1__', makeLocale())).toEqual({ text: 'Foo __1__', ok: true })
  })
})

describe('resolveLocale', () => {
  it('moves to the next scope when a value cannot be resolved', () => {
    const l = makeLocale()
    l['item-name.machine'] = '__ENTITY__missing__'
    l['entity-name.machine'] = 'Machine'
    expect(resolveLocale(null, 'machine', l, 'item-name', 'entity-name')).toBe('Machine')
  })

  it('returns the id when every scope is broken', () => {
    const l = { 'item-name.m': '__ENTITY__missing__', 'entity-name.m': '__ITEM__missing__' }
    expect(resolveLocale(null, 'm', l, 'item-name', 'entity-name')).toBe('m')
  })

  it('expands a plain string', () => {
    expect(resolveLocale('Big __ENTITY__boiler__', 'x', makeLocale())).toBe('Big Boiler')
  })

  it('expands a single-key array and falls back when broken', () => {
    const l = makeLocale()
    l['item-name.ok'] = '__ENTITY__boiler__'
    l['item-name.bad'] = '__ENTITY__missing__'
    expect(resolveLocale(['item-name.ok'], 'fb', l)).toBe('Boiler')
    expect(resolveLocale(['item-name.bad'], 'fb', l)).toBe('fb')
  })

  it('expands a format template then substitutes args', () => {
    const l = makeLocale()
    l['custom.fmt'] = '__ENTITY__boiler__ __1__'
    expect(resolveLocale(['custom.fmt', '2'], 'fb', l)).toBe('Boiler 2')
  })

  it('still concatenates ["", a, b]', () => {
    expect(resolveLocale(['', 'A', ['item-name.iron-plate']], 'fb', makeLocale())).toBe('AIron plate')
  })

  it('falls back when any concatenated part is unresolvable', () => {
    const l = makeLocale()
    l['entity-name.foo'] = '__ITEM__missing__'
    expect(resolveLocale(['', ['entity-name.foo'], ' 2'], 'fb', l)).toBe('fb')
    expect(resolveLocale(['', ['item-name.nope'], ' 2'], 'fb', l)).toBe('fb')
  })

  it('falls back when a plain string has an unresolvable placeholder', () => {
    expect(resolveLocale('__ENTITY__unknown-tank__ 2', 'fb', makeLocale())).toBe('fb')
  })

  it('falls back when a format arg or template is unresolvable', () => {
    const l = makeLocale()
    l['custom.fmt'] = 'X __1__'
    l['custom.bad'] = '__ITEM__missing__ __1__'
    expect(resolveLocale(['custom.fmt', '__ITEM__missing__'], 'fb', l)).toBe('fb')
    expect(resolveLocale(['custom.bad', '2'], 'fb', l)).toBe('fb')
  })

  it('keeps values containing other Factorio tokens', () => {
    const l = { 'item-name.remote': 'Remote (__CONTROL__give-remote__)' }
    expect(resolveLocale(['item-name.remote'], 'fb', l)).toBe('Remote (__CONTROL__give-remote__)')
  })
})

describe('resolveTechnologyName', () => {
  it('resolves a placeholder name', () => {
    const l = makeLocale()
    l['technology-name.sci'] = '__ITEM__iron-plate__'
    expect(resolveTechnologyName({ name: 'sci' }, l)).toBe('Iron plate')
  })

  it('falls back to "<base> <level>" for leveled technologies', () => {
    expect(resolveTechnologyName({ name: 'mining-productivity-2' }, makeLocale())).toBe('Mining productivity 2')
  })

  it('returns the id when nothing resolves', () => {
    expect(resolveTechnologyName({ name: 'unknown' }, makeLocale())).toBe('unknown')
  })
})

describe('resolveRecipeName', () => {
  it('falls back to the main product when recipe-name is broken', () => {
    const l = makeLocale()
    l['recipe-name.r'] = '__ITEM__missing__'
    expect(resolveRecipeName({ name: 'r' }, 'iron-plate', l)).toBe('Iron plate')
  })

  it('returns the id without a main product', () => {
    expect(resolveRecipeName({ name: 'r' }, undefined, makeLocale())).toBe('r')
    expect(resolveRecipeName({ name: 'r' }, '', makeLocale())).toBe('r')
  })
})

describe('parsePrototypeLocale', () => {
  it('reads the names map', () => {
    expect(parsePrototypeLocale('{"names":{"a":"A"},"descriptions":{"a":"d"}}')).toEqual({ a: 'A' })
  })

  it('returns {} for a file without names', () => {
    expect(parsePrototypeLocale('{"descriptions":{}}')).toEqual({})
  })
})

describe('gameName', () => {
  const makeGame = () => ({
    item: { a: 'Item A', bad: 'See __ITEM__x__' },
    entity: { a: 'Entity A', b: 'Entity B' },
  })

  it('returns the name', () => {
    expect(gameName(makeGame(), ['item'], 'a')).toBe('Item A')
  })

  it('skips a value with a placeholder residue', () => {
    expect(gameName(makeGame(), ['item'], 'bad')).toBeUndefined()
  })

  it('returns undefined for a missing type or id', () => {
    expect(gameName(makeGame(), ['fluid'], 'a')).toBeUndefined()
    expect(gameName(makeGame(), ['item'], 'zzz')).toBeUndefined()
  })

  it('tries the types in order', () => {
    expect(gameName(makeGame(), ['item', 'entity'], 'a')).toBe('Item A')
    expect(gameName(makeGame(), ['item', 'entity'], 'b')).toBe('Entity B')
  })
})

describe('game-resolved names', () => {
  const makeGame = () => ({
    technology: { x: 'Science pack: Commercial AI implementation' },
    recipe: { r: 'Game recipe' },
  })

  it('technology: the game name wins over a colliding flat map', () => {
    const l = makeLocale()
    l['technology-name.x'] = 'Transport science pack'
    expect(resolveTechnologyName({ name: 'x' }, l, makeGame())).toBe('Science pack: Commercial AI implementation')
  })

  it('technology: no game, or an id missing from it, gives the old result', () => {
    const l = makeLocale()
    l['technology-name.x'] = 'Transport science pack'
    expect(resolveTechnologyName({ name: 'x' }, l)).toBe('Transport science pack')
    expect(resolveTechnologyName({ name: 'mining-productivity-2' }, l, makeGame())).toBe('Mining productivity 2')
  })

  it('technology: an infinite level whose game name duplicates the base or a sibling gets its level', () => {
    const game = { technology: { toolbelt: 'Toolbelt', 'toolbelt-2': 'Toolbelt 2', 'toolbelt-5': 'Toolbelt' } }
    expect(resolveTechnologyName({ name: 'toolbelt-5' }, makeLocale(), game)).toBe('Toolbelt 5')
    expect(resolveTechnologyName({ name: 'toolbelt-2' }, makeLocale(), game)).toBe('Toolbelt 2')
    const sib = { technology: { 'x-1': 'Foo', 'x-2': 'Foo' } }
    expect(resolveTechnologyName({ name: 'x-2' }, makeLocale(), sib)).toBe('Foo 2')
  })

  it('technology: a distinct unnumbered game name is kept as is', () => {
    const game = { technology: { 'mining-productivity-3': 'Mining productivity 3', 'mining-productivity-4': 'Mining productivity' } }
    expect(resolveTechnologyName({ name: 'mining-productivity-4' }, makeLocale(), game)).toBe('Mining productivity')
    expect(resolveTechnologyName({ name: 'lonely-1' }, makeLocale(), { technology: { 'lonely-1': 'Lonely' } })).toBe('Lonely')
  })

  it('recipe: the game name wins', () => {
    const l = makeLocale()
    l['recipe-name.r'] = 'Flat recipe'
    expect(resolveRecipeName({ name: 'r' }, 'iron-plate', l, makeGame())).toBe('Game recipe')
  })

  it('recipe: a missing id falls back to localised_name, recipe-name, then main product', () => {
    const l = makeLocale()
    l['recipe-name.s'] = 'Flat recipe'
    expect(resolveRecipeName({ name: 's' }, 'iron-plate', l, makeGame())).toBe('Flat recipe')
    expect(resolveRecipeName({ name: 't', localised_name: ['entity-name.boiler'] }, undefined, l, makeGame())).toBe('Boiler')
    expect(resolveRecipeName({ name: 'u' }, 'iron-plate', l, makeGame())).toBe('Iron plate')
  })
})

describe('build-game-data locale files (CLI)', () => {
  const script = join(dirname(fileURLToPath(import.meta.url)), '..', 'build-game-data.js')

  function run(files, extra = []) {
    const dir = mkdtempSync(join(tmpdir(), 'locale-cli-'))
    mkdirSync(join(dir, 'f')); mkdirSync(join(dir, 'm'))
    writeFileSync(join(dir, 'dump.json'), '{}')
    for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text)
    const r = spawnSync('node', [script, '--dump', join(dir, 'dump.json'), '--factorio-dir', join(dir, 'f'),
      '--mods-dir', join(dir, 'm'), '--output', join(dir, 'out.json'), '--icons-out', join(dir, 'i'), ...extra],
    { encoding: 'utf8' })
    return { ...r, dir }
  }

  it('fails naming the file when a locale file is not valid JSON', () => {
    const r = run({ 'item-locale.json': '{bad' })
    expect(r.status).not.toBe(0)
    expect(r.stderr).toContain('item-locale.json')
  })

  it('does not count a file without names and warns about it', () => {
    const r = run({ 'item-locale.json': '{}', 'fluid-locale.json': '{"names":{"water":"Water"}}' })
    expect(r.stderr).toContain('item-locale.json has no names')
    expect(r.stderr).toContain('Game locale files: 1/6')
    expect(r.stderr).toContain('missing for: item, entity')
  })

  it('--patch-names exits non-zero unless all game locale files are loaded', () => {
    const r = run({ 'fluid-locale.json': '{"names":{"water":"Water"}}' }, ['--patch-names'])
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('--locale-dir')
  })
})
