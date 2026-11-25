import { describe, it, expect } from 'vitest'
import type { Block } from '../../data/types'
import { buildInputLines, inputEmptyState, inputLineTip, inputsReading, ruleIconsOf, type InputLine } from './inputsModel'
import type { SourceLine, SourcesModel } from './sourcesModel'
import type { BlockRow } from './sourcesRows'

const fmt = (p: number) => `${p}/m`

const madeLine = (key: 'made-here' | 'make-here', over: Partial<SourceLine> = {}): SourceLine => ({
  key, kind: key, label: key === 'made-here' ? 'Already made here' : 'Make more here', rate: 120, supplies: true, off: false, dim: false, mark: undefined, look: { kind: 'made' }, ...over,
})
const blockLine = (over: Partial<SourceLine> = {}): SourceLine => ({
  key: 'block:c1', kind: 'block', label: 'Ores', connectionId: 'c1', rate: 36, supplies: true, off: false, dim: false, mark: undefined,
  look: { kind: 'block', color: '#112233', limited: false }, ...over,
})
const importLine = (rate = 12): SourceLine => ({
  key: 'import', kind: 'import', label: 'Import', rate, supplies: rate > 0, off: false, dim: false, mark: undefined, look: { kind: 'import' },
})
const barOf = (lines: SourceLine[]): SourcesModel['bar'] => lines.filter(l => l.supplies).map(l => ({ key: l.key, label: l.label, rate: l.rate!, look: l.look }))
const model = (lines: SourceLine[], over: Partial<SourcesModel> = {}): SourcesModel => ({
  lines, need: 100, missing: 0, total: 100, bar: barOf(lines), ...over,
})
const blockRow = (over: Partial<BlockRow> = {}): BlockRow => ({
  connection: { id: 'c1', fromBlockId: 's', itemId: 'ore' } as unknown as BlockRow['connection'], source: { id: 's', name: 'Ores' } as unknown as Block, flow: undefined,
  greyed: false, tag: 'existing', tagTitle: 'Ores only gives what it has left over.', canMakeProduct: false, status: 'Limited: Ores only offers 10.0/m', ...over,
})

describe('buildInputLines', () => {
  it('gives each maker a line with its recipe, machines and share', () => {
    const lines = buildInputLines(model([madeLine('make-here', { makers: [{ recipeName: 'Smelt', machineName: 'Furnace', machineCount: 2, rate: 70 }, { recipeName: 'Cast', machineName: 'Mold', machineCount: 1, rate: 50 }] })]), [])
    expect(lines.map(l => [l.key, l.kind, l.label, l.detail, l.rate])).toEqual([
      ['make-here:0', 'make-here', 'Smelt', '2 × Furnace', 70],
      ['make-here:1', 'make-here', 'Cast', '1 × Mold', 50],
    ])
  })

  it('falls back to the line itself when it has no makers', () => {
    const lines = buildInputLines(model([madeLine('made-here')]), [])
    expect(lines).toMatchObject([{ key: 'made-here', kind: 'made-here', label: 'Already made here', rate: 120 }])
    expect(lines[0].detail).toBeUndefined()
  })

  it('reads a block line with its limit and the tag of its row', () => {
    const lines = buildInputLines(model([blockLine({ look: { kind: 'block', color: '#112233', limited: true } })]), [blockRow()])
    expect(lines).toMatchObject([{ kind: 'block', label: 'Ores', connectionId: 'c1', limited: true, block: { tag: 'existing', tagTitle: 'Ores only gives what it has left over.', status: 'Limited: Ores only offers 10.0/m' } }])
  })

  it('reads another area by its name', () => {
    const line: SourceLine = { key: 'area:a2', kind: 'other-area', label: 'Line 2', areaId: 'a2', rate: 12, supplies: true, off: false, dim: false, mark: undefined, look: { kind: 'made' } }
    expect(buildInputLines(model([line]), [])).toMatchObject([{ kind: 'other-area', label: 'Line 2', areaId: 'a2', rate: 12 }])
  })

  it('reads an import, a missing part, and both', () => {
    expect(buildInputLines(model([importLine()]), [])).toMatchObject([{ key: 'import', kind: 'import', label: 'Import', rate: 12 }])
    const missingBar = [{ key: 'import', label: 'Import', rate: 12, look: { kind: 'missing' } as const }]
    expect(buildInputLines(model([importLine()], { bar: missingBar }), [])).toMatchObject([{ key: 'missing', kind: 'missing', label: 'Missing', rate: 12 }])
    const both = [{ key: 'import', label: 'Import', rate: 5, look: { kind: 'import' } as const }, { key: 'missing', label: 'Missing', rate: 7, look: { kind: 'missing' } as const }]
    expect(buildInputLines(model([importLine(12)], { bar: both }), []).map(l => [l.kind, l.rate])).toEqual([['import', 5], ['missing', 7]])
  })

  it('lists only the supplying lines, in the order of the bar', () => {
    const lines = buildInputLines(model([blockLine(), madeLine('make-here', { rate: 0, supplies: false }), importLine(12)]), [blockRow()])
    expect(lines.map(l => l.kind)).toEqual(['block', 'import'])
  })
})

describe('inputLineTip', () => {
  const line = (over: Partial<InputLine>): InputLine => ({ key: 'k', kind: 'block', label: 'Ores', rate: 36, look: { kind: 'made' }, limited: false, ...over })
  it('names a maker and its machines', () => {
    expect(inputLineTip(line({ kind: 'make-here', label: 'Coke', detail: '1 × Assembling machine 2', rate: 4 }), fmt)).toBe('Make more here: Coke\n1 × Assembling machine 2, 4/m')
    expect(inputLineTip(line({ kind: 'made-here', label: 'Coke', detail: '1 × Assembling machine 2', rate: 4 }), fmt)).toBe('Already made here: Coke\n1 × Assembling machine 2, 4/m')
  })
  it('says only the name and figure of a made line without makers', () => {
    expect(inputLineTip(line({ kind: 'made-here', label: 'Already made here' }), fmt)).toBe('Already made here: 36/m')
  })
  it('names the area', () => {
    expect(inputLineTip(line({ kind: 'other-area', label: 'Line 2' }), fmt)).toBe('Line 2: 36/m\nMade by the rows of that area')
  })
  it('reads a block with its tag and sentence, and a limited one with its status', () => {
    const block = { tag: 'requested' as const, tagTitle: 'Ores makes what this block needs of it.', status: 'Limited: Ores only offers 10/m' }
    expect(inputLineTip(line({ block }), fmt)).toBe('Ores: 36/m (requested)\nOres makes what this block needs of it.')
    expect(inputLineTip(line({ block, limited: true }), fmt)).toBe('Ores: 36/m, limited (requested)\nLimited: Ores only offers 10/m')
  })
  it('reads an import and a missing part', () => {
    expect(inputLineTip(line({ kind: 'import', rate: 12 }), fmt)).toBe('Import: 12/m from outside the plan')
    expect(inputLineTip(line({ kind: 'missing', rate: 12 }), fmt)).toBe('Missing 12/m\nImport is off and nothing else supplies it.')
  })
})

describe('inputEmptyState', () => {
  it('tells unsolved from nothing needed from nothing supplying it', () => {
    expect(inputEmptyState(undefined)).toBeUndefined()
    expect(inputEmptyState(model([], { need: undefined }))).toBe('unsolved')
    expect(inputEmptyState(model([], { need: 0 }))).toBe('idle')
    expect(inputEmptyState(model([], { need: 12 }))).toBe('none')
    expect(inputEmptyState(model([importLine()]))).toBeUndefined()
  })
})

describe('inputsReading', () => {
  it('reads one sentence', () => {
    expect(inputsReading(model([madeLine('make-here')]), fmt)).toBe('Made by more rows here: 120/m.')
    expect(inputsReading(model([importLine(12), blockLine()]), fmt)).toBe('Imported: 12/m, From Ores: 36/m.')
  })
  it('prefixes the area of an area scope', () => {
    expect(inputsReading(model([madeLine('make-here', { rate: 70 })]), fmt, 'Line')).toBe('Line: Made by more rows here: 70/m.')
  })
  it('says so before a solve and when nothing supplies it', () => {
    expect(inputsReading(model([], { need: undefined }), fmt)).toBe('Not solved yet.')
    expect(inputsReading(model([], { need: 12 }), fmt)).toBe('Nothing supplies it.')
    expect(inputsReading(model([], { need: 0 }), fmt)).toBe('Nothing needed.')
  })
})

describe('ruleIconsOf', () => {
  it('has none for the default rule or leftover off alone', () => {
    expect(ruleIconsOf(undefined)).toEqual([])
    expect(ruleIconsOf({})).toEqual([])
    expect(ruleIconsOf({ leftoverOff: true })).toEqual([])
  })
  it('has the preset then Import off', () => {
    expect(ruleIconsOf({ makeHere: 'off', importOff: true })).toEqual([{ kind: 'byproducts-first', icon: 'dont-make' }, { kind: 'import-off', icon: 'import-off' }])
    expect(ruleIconsOf({ makeHere: 'after-blocks' })).toEqual([{ kind: 'connections-first', icon: 'receive-first' }])
    expect(ruleIconsOf({ importOff: true })).toEqual([{ kind: 'import-off', icon: 'import-off' }])
  })
})
