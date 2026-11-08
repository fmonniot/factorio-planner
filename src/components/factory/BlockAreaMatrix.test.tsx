import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { BlockAreaMatrix, type BlockAreaMatrixProps } from './BlockAreaMatrix'
import { OUTSIDE, type BlockMatrix, type MatrixRow } from './areaMatrix'
import type { GameData } from '../../data/types'

const ELEC = 'power:electricity'
const gameData = {
  items: {
    [ELEC]: { id: ELEC, name: 'Electricity', type: 'item', iconPath: '', subgroup: 'power' },
    plate: { id: 'plate', name: 'Plate', type: 'item', iconPath: '', subgroup: 'parts' },
  },
  itemGroups: {
    power: { id: 'power', name: 'Power', order: 'a', iconPath: '' },
  },
  itemSubgroups: { power: { id: 'power', group: 'power', order: '' } },
} as unknown as GameData

const area = (areaId: string) => ({
  areaId, name: areaId, isRoot: false, handleNodeId: undefined,
  contents: { rowCount: 1, recipeNames: [], subFactories: [], nestedAreas: [] },
})

// A sends 600 units/min (10 MW): 300 to B, 300 outside.
const elecRow: MatrixRow = {
  itemId: ELEC, name: 'Electricity', groupId: 'power', cells: { A: 600, B: -300 },
  fromOutside: 0, toOutside: 300, total: 600,
  pairs: [{ from: 'A', to: 'B', rate: 300 }, { from: 'A', to: OUTSIDE, rate: 300 }],
}
const plateRow: MatrixRow = {
  itemId: 'plate', name: 'Plate', groupId: 'other-items', cells: { A: -30, B: 30 },
  fromOutside: 0, toOutside: 0, total: 30, pairs: [{ from: 'B', to: 'A', rate: 30 }],
}
const matrix: BlockMatrix = {
  blockId: 'b', blockName: 'Block', color: '#000', areas: [area('A'), area('B')], rows: [elecRow, plateRow],
}

function renderMatrix(over: Partial<BlockAreaMatrixProps> = {}) {
  return render(
    <BlockAreaMatrix
      matrix={matrix}
      gameData={gameData}
      rateUnit="min"
      rowMode="category"
      columnMode="table"
      query=""
      focusedAreaId={null}
      onFocus={vi.fn()}
      showAllAreas={false}
      onShowAll={vi.fn()}
      groupOverrides={new Map()}
      onToggleGroup={vi.fn()}
      closedTails={new Set()}
      onToggleTail={vi.fn()}
      onOpenArea={vi.fn()}
      {...over}
    />,
  )
}

const cell = (itemId: string, col: string) =>
  document.querySelector(`tr[data-item-id="${itemId}"] td[data-col="${col}"]`)!.textContent

describe('BlockAreaMatrix power units', () => {
  it.each(['min', 'sec'] as const)('shows electricity in MW whatever the rate unit (%s)', rateUnit => {
    renderMatrix({ rateUnit })
    expect(cell(ELEC, 'A')).toBe('+10.0MW')
    expect(cell(ELEC, 'B')).toBe('−5.0MW')
    expect(cell(ELEC, 'to-outside')).toBe('5.0MW')
  })

  it('keeps unit-less cells for items', () => {
    renderMatrix()
    expect(cell('plate', 'A')).toBe('−30.0')
  })

  it('totals a group made of electricity in power units', () => {
    renderMatrix()
    const header = document.querySelector('tbody[data-group-id="power"] tr')!
    expect(header.textContent).toContain('+10.0MW')
    expect(header.textContent).toContain('5.0MW')
  })

  it('leaves the energy rows out of the total of a mixed group', () => {
    const mixed = { ...elecRow, groupId: 'other-items' }
    renderMatrix({ matrix: { ...matrix, rows: [mixed, plateRow] } })
    const header = document.querySelector('tbody[data-group-id="other-items"] tr')!
    expect(header.textContent).toContain('−30.0')
    expect(header.textContent).not.toContain('MW')
  })

  it('shows the counterpart cells and the trades of the panel in MW', () => {
    renderMatrix({ focusedAreaId: 'A' })
    expect(cell(ELEC, 'B')).toBe('→ 5.0MW')
    const panel = screen.getByRole('complementary', { name: 'A' })
    expect(within(panel).getAllByText(/5\.0MW out/).length).toBeGreaterThan(0)
  })

  it('words the header note of an energy-only trade by its direction', () => {
    renderMatrix({ matrix: { ...matrix, rows: [elecRow] }, focusedAreaId: 'B' })
    const head = document.querySelector('thead button[title="Focus A"]')!.closest('th')!
    expect(head.textContent).toContain('sends it 1 item')
  })

  it('leaves the totals of an ungrouped matrix alone and hints at the left-out rows', () => {
    const mixed = { ...elecRow, groupId: 'other-items' }
    renderMatrix({ matrix: { ...matrix, rows: [mixed, plateRow] } })
    expect(document.querySelector('tbody[data-group-id="other-items"] span[title]')?.getAttribute('title')).toMatch(/leave out/)
  })

  it('adds no total for a group holding electricity and heat', () => {
    const heat = { ...elecRow, itemId: 'power:heat', name: 'Heat' }
    renderMatrix({ matrix: { ...matrix, rows: [elecRow, heat] } })
    const header = document.querySelector('tbody[data-group-id="power"] tr')!
    expect(header.textContent).not.toContain('MW')
  })
})
