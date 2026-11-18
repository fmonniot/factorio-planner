import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import {
  applyWhatIf, findArea, findBlock, formatReport, inspectPlan, parseAreaImportOff, parseAreaOff, parseAreaSourcing, servedReportOf, type InspectReport,
} from './inspect'
import type { AppState, Block, GameData, GameRecipeNode, MultiBlockSolve, ServedEntry, SubPlan } from '../data/types'
import { loadAppStateFromJson, loadGameDataFromJson } from '../data/loader'

// Runs on the committed Seablock export and the Extra Sulfur block saved with the
// surplus-aware-objective initiative: the heavy-mud / hydrogen-sulfide route that block solves to.

const gameData = loadGameDataFromJson(
  readFileSync(resolve(import.meta.dirname, '../../public/data/kompetenz-seablock/game-data.json'), 'utf-8'),
)
const planJson = readFileSync(
  resolve(import.meta.dirname, '../../initiatives/surplus-aware-objective/extra-sulfur.plan.json'),
  'utf-8',
)

function plan() {
  return loadAppStateFromJson(planJson)
}

describe('inspectPlan', () => {
  it('reports the rows, the left-over heavy mud and the imports of the block', () => {
    const report = inspectPlan(plan(), gameData, 'Extra Sulfur')
    expect(report.error).toBeUndefined()
    expect(report.rows.filter(r => r.throughput > 1e-6).map(r => r.recipeId).sort()).toEqual([
      'angels-solid-sulfur',
      'angels-water-heavy-mud',
    ])
    const mud = report.items.find(i => i.itemId === 'angels-water-heavy-mud')
    expect(mud?.net, 'heavy mud has no consumer').toBeCloseTo(12_000_000, -2)
    expect(report.items.find(i => i.itemId === 'sulfur')).toMatchObject({ isProduct: true })
    expect(report.unsatisfied.map(u => u.itemId)).toContain('angels-water-viscous-mud')
    expect(report.warnings.map(w => w.type)).toEqual(['overconstrained', 'coproduct-driven'])
    expect(report.totals.executions).toBeCloseTo(62_000, 0)
  })

  it('finds a block by id, name or name ignoring case, and lists the names when it is unknown', () => {
    const state = plan()
    const block = state.blocks[0]
    expect(findBlock(state, block.id)).toBe(block)
    expect(findBlock(state, block.name.toUpperCase())).toBe(block)
    expect(() => findBlock(state, 'nope')).toThrow(`Blocks: ${block.name}`)
  })

  it('drops a recipe and the solver falls back to the lime loop', () => {
    const report = inspectPlan(plan(), gameData, 'Extra Sulfur', { drop: ['angels-solid-sulfur'] })
    expect(report.rows.find(r => r.recipeId === 'angels-yellow-waste-water-purification')?.throughput).toBeCloseTo(6000, 0)
    expect(report.items.find(i => i.itemId === 'angels-water-heavy-mud')?.net ?? 0).toBeLessThan(1)
  })

  it('does not modify the plan it is given', () => {
    const state = plan()
    const before = JSON.stringify(state)
    applyWhatIf(state, state.blocks[0].id, { pins: { 'angels-solid-sulfur': 1 }, drop: ['angels-water-heavy-mud'], noArea: true })
    expect(JSON.stringify(state)).toBe(before)
  })

  it('rejects an unknown sourcing value instead of guessing', () => {
    const state = plan()
    expect(() => applyWhatIf(state, state.blocks[0].id, { sourcing: { sulfur: 'conections-first' as never } })).toThrow(/expected/)
  })

  it('pins a recipe and sets item sourcing on the block only', () => {
    const state = plan()
    const next = applyWhatIf(state, state.blocks[0].id, { pins: { 'angels-solid-sulfur': 1 }, sourcing: { sulfur: 'byproducts-first' } })
    expect(next.blocks[0].sourceRules).toEqual({ sulfur: { makeHere: 'off' } })
    expect(next.blocks[0].rootPlan.nodes.find(n => n.kind === 'game-recipe' && n.recipeId === 'angels-solid-sulfur')).toMatchObject({
      pinnedRate: 1,
    })
  })

  it('formats a report with its sections', () => {
    const text = formatReport(inspectPlan(plan(), gameData, 'Extra Sulfur'))
    expect(text).toContain('Block "Extra Sulfur"')
    expect(text).toContain('angels-water-heavy-mud')
    expect(text).toContain('sulfur [product]')
    expect(text).toContain('Imports')
    expect(text).toContain('coproduct-driven')
  })
})

describe('servedReportOf', () => {
  const blk = (id: string, opts: { from?: string; list?: ServedEntry[]; extra?: number } = {}): Block =>
    ({
      id, name: `Block ${id}`, color: '#60a5fa',
      products: opts.extra !== undefined ? [{ id: 'p0', itemId: 'plate', extraRate: opts.extra }] : [],
      sourceRules: {},
      inputConnections: opts.from ? [{ id: `c-${id}`, itemId: 'plate', fromBlockId: opts.from }] : [],
      ...(opts.list ? { servedOrder: { plate: opts.list } } : {}),
      rootPlan: { id: `root-${id}`, name: 'root', nodes: [], subPlans: [] },
    }) as unknown as Block
  const consumer = (id: string, share: number, got: number, kind: 'request' | 'take' = 'request') => ({ blockId: id, connectionId: `c-${id}`, kind, share, got })
  const served = (consumers: Array<ReturnType<typeof consumer> & { areaId?: string }>, extra?: { place: number; asked: number; got: number }): MultiBlockSolve['served'] => ({
    A: { plate: { consumers, ...(extra ? { extra } : {}) } },
  })

  it('ranks the lines, groups the tied ones and marks what the list does not name', () => {
    const list: ServedEntry[] = [{ kind: 'block', blockId: 'B' }, { kind: 'block', blockId: 'C', share: 80 }, { kind: 'block', blockId: 'D', tied: true, share: 20 }]
    const blocks = [blk('A', { list, extra: 10 }), blk('B', { from: 'A' }), blk('C', { from: 'A' }), blk('D', { from: 'A' }), blk('E', { from: 'A' })]
    const [item] = servedReportOf(blocks, 'A', served(
      [consumer('B', 30, 30), consumer('C', 20, 12), consumer('D', 10, 3), consumer('E', 5, 0)],
      { place: 3, asked: 10, got: 0 },
    ))
    expect(item.ranked).toBe(true)
    expect(item.lines.map(l => [l.name, l.rank, l.listed])).toEqual([
      ['Block B', 1, true], ['Block C', 2, true], ['Block D', 2, true], ['extra output', 3, false], ['Block E', 4, false],
    ])
    expect(item.lines[0].group).toBeUndefined()
    expect(item.lines[1].group).toEqual({ size: 2, percent: 80 })
    expect(item.lines[2].group).toEqual({ size: 2, percent: 20 })
    expect(item.lines[3]).toMatchObject({ kind: 'extra', share: 10, got: 0 })
    expect(item.lines[3]).not.toHaveProperty('blockId')
  })

  it('marks a group whose takes carry groupInListOrder as served in list order, with no percent', () => {
    // List {T1, T2} (tied, no shares) on A: the solver could not share the group by need, so it served T1 first, not 50/50.
    const list: ServedEntry[] = [{ kind: 'block', blockId: 'T1' }, { kind: 'block', blockId: 'T2', tied: true }]
    const blocks = [blk('A', { list }), blk('T1', { from: 'A' }), blk('T2', { from: 'A' })]
    const take = (id: string, share: number, got: number) => ({ ...consumer(id, share, got, 'take'), groupInListOrder: true as const })
    const [item] = servedReportOf(blocks, 'A', served([take('T1', 25, 25), take('T2', 25, 5)]))
    expect(item.lines.map(l => [l.rank, l.group])).toEqual([
      [1, { size: 2, listOrder: true }],
      [1, { size: 2, listOrder: true }],
    ])
    expect(item.lines[0].group).not.toHaveProperty('percent')
  })

  it('a group of takes without the flag shows its percents', () => {
    const list: ServedEntry[] = [{ kind: 'block', blockId: 'T1' }, { kind: 'block', blockId: 'T2', tied: true }]
    const blocks = [blk('A', { list }), blk('T1', { from: 'A' }), blk('T2', { from: 'A' })]
    const [item] = servedReportOf(blocks, 'A', served([consumer('T1', 15, 15, 'take'), consumer('T2', 15, 15, 'take')]))
    expect(item.lines.map(l => l.group)).toEqual([{ size: 2, percent: 50 }, { size: 2, percent: 50 }])
  })

  it('ranks an item with no list from 1 and says so', () => {
    const blocks = [blk('A'), blk('B', { from: 'A' }), blk('C', { from: 'A' })]
    const [item] = servedReportOf(blocks, 'A', served([consumer('B', 30, 30), consumer('C', 20, 15)]))
    expect(item.ranked).toBe(false)
    expect(item.lines.map(l => [l.rank, l.listed])).toEqual([[1, false], [2, false]])
  })

  it('names an area line like the Areas pane: the root is "Top level", a sub-factory has its own name, a gone one its id', () => {
    const B = {
      ...blk('B', { from: 'A' }),
      rootPlan: { id: 'root-B', name: 'root', nodes: [], subPlans: [{ id: 'L', name: 'Line', nodes: [], subPlans: [] }] },
    } as unknown as Block
    const [item] = servedReportOf([blk('A'), B], 'A', served([
      { ...consumer('B', 4, 4), areaId: 'root-B' }, { ...consumer('B', 3, 3), areaId: 'L' }, { ...consumer('B', 1, 1), areaId: 'gone' },
    ]))
    expect(item.lines.map(l => l.name)).toEqual(['Block B / Top level', 'Block B / Line', 'Block B / gone'])
  })
})

describe('formatReport served lists', () => {
  it('prints groups, lines the list does not name and the unranked header', () => {
    const report: InspectReport = {
      block: { id: 'A', name: 'A' }, rows: [], items: [], unsatisfied: [], replacedImports: [], warnings: [], flows: [], areaRoutes: [], areas: [], areaItems: [],
      totals: { executions: 0, machineCountExact: 0, machineCountCeil: 0, powerKw: 0 },
      served: [
        { itemId: 'plate', ranked: true, lines: [
          { rank: 1, name: 'B', blockId: 'B', kind: 'request', listed: true, share: 30, got: 30 },
          { rank: 2, name: 'C', blockId: 'C', kind: 'request', group: { size: 2, percent: 80 }, listed: true, share: 20, got: 12 },
          { rank: 3, name: 'E', blockId: 'E', kind: 'request', listed: false, share: 5, got: 0 },
        ] },
        { itemId: 'ore', ranked: true, lines: [
          { rank: 1, name: 'T1', blockId: 'T1', kind: 'take', group: { size: 2, listOrder: true }, listed: true, share: 25, got: 25 },
          { rank: 1, name: 'T2', blockId: 'T2', kind: 'take', group: { size: 2, listOrder: true }, listed: true, share: 25, got: 5 },
        ] },
        { itemId: 'gear', ranked: false, lines: [{ rank: 1, name: 'B', blockId: 'B', kind: 'take', listed: false, share: 4, got: 4 }] },
      ],
    }
    const text = formatReport(report)
    expect(text).toContain('Served lists')
    expect(text).toContain('[group of 2, 80.00%]')
    expect(text).toContain('T1 [group of 2, in list order]')
    expect(text).not.toContain('[group of 2, 50')
    expect(text).toContain('(not in the list)')
    expect(text).toContain('(no list: solve order)')
    expect(text).toContain('plate  (list)')
  })
})

describe('area what-ifs', () => {
  // Case 13's recipes on a local data set: area L uses 12 plate and B uses 8 (both pinned), each has a plate row.
  const recipe = (id: string, from: string, to: string): GameData['recipes'][string] => ({
    id, name: id, category: 'crafting', craftingTime: 1,
    ingredients: [{ itemId: from, type: 'item', amount: 1 }], products: [{ itemId: to, type: 'item', amount: 1 }],
    madeIn: [], allowProductivity: false, mainProduct: undefined, hidden: false, subgroup: '', order: '',
  })
  const data = (): GameData => ({
    factorioVersion: '2.0.0', modSet: {}, items: {},
    recipes: { 'case13-make-plate': recipe('case13-make-plate', 'case13-ore', 'case13-plate'), 'case13-use-plate': recipe('case13-use-plate', 'case13-plate', 'case13-gear') },
    machines: {}, modules: {}, beacons: {}, defaultMachines: {}, itemGroups: {}, itemSubgroups: {}, technologies: {}, startingRecipes: [],
  })
  const PLATE = 'case13-plate'
  const now = new Date().toISOString()
  const row = (recipeId: string, where: string, pinnedRate?: number): GameRecipeNode =>
    ({ kind: 'game-recipe', id: `${recipeId}@${where}`, recipeId, modules: [], byproductPolicy: {}, ...(pinnedRate === undefined ? {} : { pinnedRate }) })
  const area = (id: string, name: string, nodes: GameRecipeNode[]): SubPlan => ({ id, name, nodes, subPlans: [], area: true, createdAt: now, updatedAt: now })
  const stateOf = (ids: [string, string] = ['L', 'B'], names: [string, string] = ['L', 'B'], blockRules: Block['sourceRules'] = {}): AppState => ({
    blocks: [{
      id: 'H', name: 'H', color: '#60a5fa',
      products: [{ id: 'p0', itemId: 'case13-gear', extraRate: 20 }],
      sourceRules: blockRules, inputConnections: [],
      rootPlan: {
        id: 'root-H', name: 'root', nodes: [], createdAt: now, updatedAt: now,
        subPlans: [
          area(ids[0], names[0], [row('case13-use-plate', ids[0], 12), row('case13-make-plate', ids[0])]),
          area(ids[1], names[1], [row('case13-use-plate', ids[1], 8), row('case13-make-plate', ids[1])]),
        ],
      },
    }],
    activeBlockId: 'H', horizonTechnologyIds: [], defaultMachineOverrides: {},
  })
  const rulesOf = (state: AppState, areaId: string) => state.blocks[0].rootPlan.subPlans.find(p => p.id === areaId)!.sourceRules

  describe('parsing', () => {
    it('reads <area>:<item>=<mode>, splitting on the last = and then the first :', () => {
      expect(parseAreaSourcing(['L:case13-plate=off', 'Top level:power:heat=first', 'B:x=here'])).toEqual([
        { area: 'L', itemId: 'case13-plate', mode: 'off' },
        { area: 'Top level', itemId: 'power:heat', mode: 'first' },
        { area: 'B', itemId: 'x', mode: 'here' },
      ])
      expect(parseAreaSourcing(['Top level:power:heat=off'])).toEqual([{ area: 'Top level', itemId: 'power:heat', mode: 'off' }])
    })
    it('rejects an entry that is not <area>:<item>=<mode>', () => {
      for (const bad of ['L:plate', 'plate=off', ':plate=off', 'L:=off', '=off']) {
        expect(() => parseAreaSourcing([bad]), bad).toThrow(`--area-sourcing expects <area>:<item>=<first|off|here>, got "${bad}"`)
      }
      expect(() => parseAreaSourcing(['L:plate=maybe'])).toThrow('--area-sourcing L:plate=maybe: expected first, off or here')
    })
    it('reads <area>:<item> for Import off', () => {
      expect(parseAreaImportOff(['L:plate', 'Top level:power:heat'])).toEqual([{ area: 'L', itemId: 'plate' }, { area: 'Top level', itemId: 'power:heat' }])
      for (const bad of ['plate', ':plate', 'L:']) {
        expect(() => parseAreaImportOff([bad]), bad).toThrow(`--area-import-off expects <area>:<item>, got "${bad}"`)
      }
    })
  })

  describe('parseAreaOff', () => {
    it('reads <area>:<item>=<other area>, splitting on the last = and then the first :', () => {
      expect(parseAreaOff(['L:case13-plate=M1', 'Top level:power:heat=Line'])).toEqual([
        { area: 'L', itemId: 'case13-plate', other: 'M1' },
        { area: 'Top level', itemId: 'power:heat', other: 'Line' },
      ])
    })
    it('rejects an entry that is not <area>:<item>=<other area>', () => {
      for (const bad of ['plate', ':plate=M1', 'L:=M1', 'L:plate=', 'L:plate']) {
        expect(() => parseAreaOff([bad]), bad).toThrow(`--area-off expects <area>:<item>=<other area>, got "${bad}"`)
      }
    })
  })

  describe('findArea', () => {
    it('finds an area by id, by name, by name ignoring case, and the root as "Top level"', () => {
      const block = stateOf(['sp-l', 'sp-b'], ['Line', 'Bay']).blocks[0]
      expect(findArea(block, 'sp-l')).toBe('sp-l')
      expect(findArea(block, 'Line')).toBe('sp-l')
      expect(findArea(block, 'bay')).toBe('sp-b')
      expect(findArea(block, 'Top level')).toBe('root-H')
      expect(findArea(block, 'TOP LEVEL')).toBe('root-H')
    })
    it('names the areas when it finds none, and asks for an id when a name is ambiguous', () => {
      const block = stateOf(['sp-l', 'sp-b'], ['Line', 'Bay']).blocks[0]
      expect(() => findArea(block, 'zz')).toThrow('No area "zz" in block "H". Areas: Top level, Line, Bay')
      const twins = stateOf(['sp-l', 'sp-b'], ['Same', 'Same']).blocks[0]
      expect(() => findArea(twins, 'Same')).toThrow('Area name "Same" is ambiguous in block "H": use an id (sp-l, sp-b)')
    })
    it('says so when the block has no areas', () => {
      const block = { ...stateOf().blocks[0], rootPlan: { ...stateOf().blocks[0].rootPlan, subPlans: [] } }
      expect(() => findArea(block, 'L')).toThrow('Block "H" has no areas')
    })
  })

  describe('applyWhatIf', () => {
    it("builds the area's rule from the block's: first adds makeHere, here removes it", () => {
      const state = stateOf(['L', 'B'], ['L', 'B'], { [PLATE]: { importOff: true } })
      const first = applyWhatIf(state, 'H', { areaSourcing: [{ area: 'L', itemId: PLATE, mode: 'first' }] })
      expect(rulesOf(first, 'L')).toEqual({ [PLATE]: { importOff: true, makeHere: 'after-blocks' } })
      expect(rulesOf(first, 'B')).toBeUndefined()
      const here = applyWhatIf(state, 'H', { areaSourcing: [{ area: 'L', itemId: PLATE, mode: 'here' }] })
      expect(rulesOf(here, 'L')).toEqual({ [PLATE]: { importOff: true } })
      const bare = applyWhatIf(stateOf(), 'H', { areaSourcing: [{ area: 'L', itemId: PLATE, mode: 'here' }] })
      expect(rulesOf(bare, 'L'), 'a rule is written even when it equals the block\'s').toEqual({ [PLATE]: {} })
    })
    it('turns Import off in an area, keeping the rest of its rule', () => {
      const state = applyWhatIf(stateOf(), 'H', { areaSourcing: [{ area: 'L', itemId: PLATE, mode: 'off' }], areaImportOff: [{ area: 'L', itemId: PLATE }] })
      expect(rulesOf(state, 'L')).toEqual({ [PLATE]: { makeHere: 'off', importOff: true } })
      const keep = stateOf()
      keep.blocks[0].rootPlan.subPlans[0].sourceRules = { [PLATE]: { makeHere: 'off', areasOff: ['B'] } }
      expect(rulesOf(applyWhatIf(keep, 'H', { areaImportOff: [{ area: 'L', itemId: PLATE }] }), 'L')).toEqual({ [PLATE]: { makeHere: 'off', areasOff: ['B'], importOff: true } })
    })
    it('resolves the area by id, name, "Top level" and case', () => {
      const state = stateOf(['sp-l', 'sp-b'], ['Line', 'Bay'])
      for (const [wanted, id] of [['sp-l', 'sp-l'], ['Line', 'sp-l'], ['bay', 'sp-b']] as const) {
        expect(rulesOf(applyWhatIf(state, 'H', { areaImportOff: [{ area: wanted, itemId: PLATE }] }), id), wanted).toEqual({ [PLATE]: { importOff: true } })
      }
      expect(state.blocks[0].rootPlan.sourceRules).toBeUndefined()
      expect(applyWhatIf(state, 'H', { areaImportOff: [{ area: 'top level', itemId: PLATE }] }).blocks[0].rootPlan.sourceRules).toEqual({ [PLATE]: { importOff: true } })
    })
    it('throws for an unknown area, a block with no areas, a bad mode and --no-area together with an area edit', () => {
      const state = stateOf()
      expect(() => applyWhatIf(state, 'H', { areaImportOff: [{ area: 'zz', itemId: PLATE }] })).toThrow('No area "zz"')
      const flat = { ...state, blocks: [{ ...state.blocks[0], rootPlan: { ...state.blocks[0].rootPlan, subPlans: [] } }] }
      expect(() => applyWhatIf(flat, 'H', { areaImportOff: [{ area: 'L', itemId: PLATE }] })).toThrow('Block "H" has no areas')
      expect(() => applyWhatIf(state, 'H', { areaSourcing: [{ area: 'L', itemId: PLATE, mode: 'maybe' as never }] })).toThrow('--area-sourcing L:case13-plate=maybe: expected first, off or here')
      expect(() => applyWhatIf(state, 'H', { noArea: true, areaImportOff: [{ area: 'L', itemId: PLATE }] })).toThrow('--no-area cannot be combined with --area-sourcing, --area-import-off or --area-off')
    })
    it('--area-off writes areasOff, resolving the other area by id, name, case and "Top level", merging without duplicates', () => {
      const state = stateOf(['sp-l', 'sp-b'], ['Line', 'Bay'])
      const done = applyWhatIf(state, 'H', { areaOff: [
        { area: 'Line', itemId: PLATE, other: 'sp-b' }, { area: 'sp-l', itemId: PLATE, other: 'bay' }, { area: 'sp-l', itemId: PLATE, other: 'TOP LEVEL' },
      ] })
      expect(rulesOf(done, 'sp-l')).toEqual({ [PLATE]: { areasOff: ['sp-b', 'root-H'] } })
      expect(rulesOf(state, 'sp-l')).toBeUndefined()
    })
    it('--area-off throws for a self-switch and an unknown other area', () => {
      const state = stateOf()
      expect(() => applyWhatIf(state, 'H', { areaOff: [{ area: 'L', itemId: PLATE, other: 'L' }] })).toThrow('--area-off L:case13-plate=L: an area cannot switch itself off')
      expect(() => applyWhatIf(state, 'H', { areaOff: [{ area: 'L', itemId: PLATE, other: 'zz' }] })).toThrow('No area "zz"')
    })
    it('does not modify the plan it is given', () => {
      const state = stateOf()
      const before = JSON.stringify(state)
      applyWhatIf(state, 'H', { areaSourcing: [{ area: 'L', itemId: PLATE, mode: 'off' }], areaImportOff: [{ area: 'B', itemId: PLATE }] })
      expect(JSON.stringify(state)).toBe(before)
    })
  })

  describe('inspectPlan', () => {
    it("lists each area's rules and, per area item, what each area receives, imports and misses", () => {
      const report = inspectPlan(stateOf(), data(), 'H', { areaSourcing: [{ area: 'L', itemId: PLATE, mode: 'off' }] })
      expect(report.areas.map(a => [a.id, a.name, a.rules])).toEqual([
        ['root-H', 'Top level', {}], ['L', 'L', { [PLATE]: { makeHere: 'off' } }], ['B', 'B', {}],
      ])
      expect(report.areaItems).toEqual([{ itemId: PLATE, areas: [{ areaId: 'L', name: 'L', received: 0, imported: 12, missing: 0 }] }])
      const text = formatReport(report)
      expect(text).toContain('L  case13-plate  off  Import on')
      expect(text).toContain('case13-plate  L  0  12.00  0')
    })
    it('--area-off: the solve reads the switch, and the report says so', () => {
      const state = stateOf(['L', 'M1'], ['L', 'M1'])
      const m2 = area('M2', 'M2', [row('case13-make-plate', 'M2')])
      const rootPlan = state.blocks[0].rootPlan
      const plan: SubPlan = {
        ...rootPlan,
        subPlans: [
          area('L', 'L', [row('case13-use-plate', 'L', 12)]), area('M1', 'M1', [row('case13-make-plate', 'M1')]), m2,
        ],
      }
      const three: AppState = { ...state, blocks: [{ ...state.blocks[0], products: [{ id: 'p0', itemId: 'case13-gear', extraRate: 12 }], rootPlan: plan }] }
      const report = inspectPlan(three, data(), 'H', { areaOff: [{ area: 'L', itemId: PLATE, other: 'M1' }] })
      expect(report.areaRoutes.filter(r => r.itemId === PLATE).map(r => [r.from, r.to, Math.round(r.rate * 1e6) / 1e6])).toEqual([['M2', 'L', 12]])
      const text = formatReport(report)
      expect(text).toContain('takes nothing from M1')
      expect(text).not.toContain('not read by the solver')
    })
    it('reads what Import off makes of the leg: missing instead of imported', () => {
      const report = inspectPlan(stateOf(), data(), 'H', {
        areaSourcing: [{ area: 'L', itemId: PLATE, mode: 'off' }], areaImportOff: [{ area: 'L', itemId: PLATE }],
      })
      expect(report.areaItems).toEqual([{ itemId: PLATE, areas: [{ areaId: 'L', name: 'L', received: 0, imported: 0, missing: 12 }] }])
      expect(formatReport(report)).toContain('L  case13-plate  off  Import off')
    })
    it('prints an area with no rule as following the block, and no area item when no leg comes from outside', () => {
      const text = formatReport(inspectPlan(stateOf(), data(), 'H'))
      expect(text).toContain('Top level  follows the block')
      expect(text).not.toContain('Area items from outside')
    })
  })
})

describe('imports the connections replaced', () => {
  // Case 22 A, row b as two blocks: H (25 gears, P turns 1 ingot into 2 plates, the ingot row pinned at 10) takes plate from S.
  // Alone H imports 15 ingots (ore is raw, imported either way); with the connection it imports none.
  const recipe = (id: string, from: string, fromAmount: number, to: string, toAmount: number): GameData['recipes'][string] => ({
    id, name: id, category: 'crafting', craftingTime: 1,
    ingredients: [{ itemId: from, type: 'item', amount: fromAmount }], products: [{ itemId: to, type: 'item', amount: toAmount }],
    madeIn: [], allowProductivity: false, mainProduct: undefined, hidden: false, subgroup: '', order: '',
  })
  const data = (): GameData => ({
    factorioVersion: '2.0.0', modSet: {}, items: {},
    recipes: {
      gear: recipe('gear', 'plate', 2, 'gear', 1),
      'plate-12': recipe('plate-12', 'ingot', 1, 'plate', 2),
      ingot: recipe('ingot', 'ore', 1, 'ingot', 1),
      'mine-plate': recipe('mine-plate', 'ore', 1, 'plate', 1),
    },
    machines: {}, modules: {}, beacons: {}, defaultMachines: {}, itemGroups: {}, itemSubgroups: {}, technologies: {}, startingRecipes: [],
  })
  const now = new Date().toISOString()
  const row = (id: string, recipeId = id, pinnedRate?: number): GameRecipeNode =>
    ({ kind: 'game-recipe', id, recipeId, modules: [], byproductPolicy: {}, ...(pinnedRate === undefined ? {} : { pinnedRate }) })
  const block = (id: string, products: Array<[string, number]>, nodes: GameRecipeNode[], inputConnections: Block['inputConnections'] = []): Block => ({
    id, name: id, color: '#60a5fa',
    products: products.map(([itemId, extraRate], i) => ({ id: `p-${id}-${i}`, itemId, extraRate })),
    sourceRules: {}, inputConnections,
    rootPlan: { id: `root-${id}`, name: id, nodes, subPlans: [], createdAt: now, updatedAt: now },
  })
  const state = (): AppState => ({
    blocks: [
      block('S', [['plate', 0]], [row('mine-plate')]),
      block('H', [['gear', 25]], [row('gear'), row('plate-12'), row('ingot', 'ingot', 10)], [{ id: 'c-H', itemId: 'plate', fromBlockId: 'S' }]),
    ],
    activeBlockId: 'H', horizonTechnologyIds: [], defaultMachineOverrides: {},
  })

  it('lists the ingot import the plate connection replaced, and not the raw ore imported both ways', () => {
    const report = inspectPlan(state(), data(), 'H')
    expect(report.replacedImports.map(r => ({ ...r, without: Math.round(r.without * 1e6) / 1e6, now: Math.round(r.now * 1e6) / 1e6 })))
      .toEqual([{ itemId: 'ingot', without: 15, now: 0 }])
    const text = formatReport(report)
    expect(text).toContain('Imports the connections replaced')
    expect(text).toContain('ingot  15.00  0')
  })

  it('says nothing for a block without input connections', () => {
    const report = inspectPlan(state(), data(), 'S')
    expect(report.replacedImports).toEqual([])
    expect(formatReport(report)).not.toContain('Imports the connections replaced')
  })
})
