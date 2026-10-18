import { describe, it, expect } from 'vitest'
import { techDepths, layoutTechTree, techStates, CARD_W, CARD_H, COL_GAP, ROW_GAP } from './techTree'
import type { GameData } from './types'

type Techs = GameData['technologies']

function tech(id: string, prerequisites: string[] = []) {
  return { id, name: id, prerequisites, unlockedRecipes: [], iconPath: '' }
}

function techMap(...list: ReturnType<typeof tech>[]): Techs {
  return Object.fromEntries(list.map(t => [t.id, t]))
}

function makeTechs(): Techs {
  return techMap(
    tech('a'),
    tech('b', ['a']),
    tech('c', ['b']),
    tech('left', ['a']),
    tech('right', ['a']),
    tech('top', ['left', 'right']),
    tech('x', ['y']),
    tech('y', ['x']),
    tech('other'),
    tech('z', ['missing']),
  )
}

function makeGameData(): GameData {
  return {
    factorioVersion: '2.0.0',
    modSet: {},
    items: {},
    recipes: {},
    machines: {},
    modules: {},
    beacons: {},
    defaultMachines: {},
    itemGroups: {},
    itemSubgroups: {},
    technologies: makeTechs(),
    startingRecipes: [],
  }
}

describe('techDepths', () => {
  it('uses the longest prerequisite chain', () => {
    const d = techDepths(makeTechs())
    expect([d.get('a'), d.get('b'), d.get('c')]).toEqual([0, 1, 2])
    expect(d.get('top')).toBe(2)
  })

  it('ignores unknown prerequisites', () => {
    expect(techDepths(makeTechs()).get('z')).toBe(0)
  })

  it('breaks a cycle', () => {
    const d = techDepths(makeTechs())
    expect(d.get('x')).toBe(1)
    expect(d.get('y')).toBe(0)
  })
})

describe('layoutTechTree', () => {
  it('drops cycle back-edges', () => {
    const { edges } = layoutTechTree(makeTechs())
    expect(edges.some(e => e.from === 'y' && e.to === 'x')).toBe(true)
    expect(edges.some(e => e.from === 'x' && e.to === 'y')).toBe(false)
  })

  it('orders rows to reduce crossings', () => {
    const { nodes } = layoutTechTree(techMap(tech('a'), tech('b'), tech('p', ['b']), tech('q', ['a'])))
    expect(nodes.q.row, 'barycenter puts q next to a').toBe(0)
    expect(nodes.p.row).toBe(1)
  })

  it('computes coordinates, size and edge endpoints', () => {
    const l = layoutTechTree(techMap(tech('a'), tech('b', ['a']), tech('c', ['a'])))
    expect(l.nodes.a).toMatchObject({ column: 0, x: 0, y: 0 })
    expect(l.nodes.c).toMatchObject({ column: 1, row: 1, x: CARD_W + COL_GAP, y: CARD_H + ROW_GAP })
    expect(l.width).toBe(2 * (CARD_W + COL_GAP) - COL_GAP)
    expect(l.height).toBe(2 * (CARD_H + ROW_GAP) - ROW_GAP)
    const e = l.edges.find(x => x.to === 'c')!
    expect(e).toEqual({
      from: 'a', to: 'c',
      x1: CARD_W, y1: CARD_H / 2,
      x2: CARD_W + COL_GAP, y2: CARD_H + ROW_GAP + CARD_H / 2,
    })
  })

  it('returns zeros for no technologies', () => {
    expect(layoutTechTree({})).toEqual({ nodes: {}, edges: [], width: 0, height: 0 })
  })

  it('is deterministic whatever the insertion order', () => {
    const forward = makeTechs()
    const reversed = Object.fromEntries(Object.entries(makeTechs()).reverse())
    expect(layoutTechTree(reversed)).toEqual(layoutTechTree(forward))
  })
})

describe('techStates', () => {
  const states = (targets: string[]) => techStates(makeGameData(), targets)

  it('has only roots available without targets', () => {
    const s = states([])
    expect(s.a).toBe('available')
    expect(s.other).toBe('available')
    for (const id of ['b', 'left', 'right', 'top', 'x', 'y']) expect(s[id], id).toBe('locked')
  })

  it('researches a target and its prerequisites', () => {
    const s = states(['b'])
    expect([s.a, s.b]).toEqual(['researched', 'researched'])
    expect([s.c, s.left, s.right]).toEqual(['available', 'available', 'available'])
    expect(s.top).toBe('locked')
  })

  it('makes top available once both branches are researched', () => {
    expect(states(['left', 'right']).top).toBe('available')
  })

  it('treats an unknown target like no target', () => {
    expect(states(['nope'])).toEqual(states([]))
  })

  it('treats a technology with only unknown prerequisites as available', () => {
    expect(states([]).z).toBe('available')
  })
})
