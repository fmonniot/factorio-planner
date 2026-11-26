import { describe, it, expect, vi } from 'vitest'
import { render, screen, within, fireEvent } from '@testing-library/react'
import { BlockAreaMatrix, FROM_OUTSIDE_TIP, TRADES_ORDER_TIP, type BlockAreaMatrixProps } from './BlockAreaMatrix'
import { outsideTip } from './matrixFormat'
import { expectTip } from '../../test/byTip'
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
  key: ELEC, itemId: ELEC, name: 'Electricity', groupId: 'power', cells: { A: 600, B: -300 },
  fromOutside: 0, toOutside: 300, total: 600,
  pairs: [{ from: 'A', to: 'B', rate: 300 }, { from: 'A', to: OUTSIDE, rate: 300 }],
}
const plateRow: MatrixRow = {
  key: 'plate', itemId: 'plate', name: 'Plate', groupId: 'other-items', cells: { A: -30, B: 30 },
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

  it('words a counterpart cell as who sends what to whom, with no rule appended', () => {
    renderMatrix({ focusedAreaId: 'A' })
    const tip = document.querySelector<HTMLElement>('td[data-counterpart="true"]')!.getAttribute('data-tip')!
    expect(tip).toMatch(/^.+ sends .+ of .+ to .+\.$/)
    expect(tip).not.toContain('Areas higher')
  })

  it('states the ordering rule once, as the tooltip of the Trades with heading, and prints no counterpart note', () => {
    renderMatrix({ focusedAreaId: 'A' })
    expectTip(screen.getByTestId('trades-with-label'), TRADES_ORDER_TIP)
    expect(TRADES_ORDER_TIP).toBe('Areas higher in the table supply first; an area with its own row for the item is served before the others.')
    expect(screen.queryByText(/Counterpart cells read/)).toBeNull()
  })

  describe('contents of the focused area', () => {
    const withContents = (contents: Partial<(typeof matrix.areas)[number]['contents']>): BlockMatrix => ({
      ...matrix,
      areas: [{ ...area('A'), contents: { ...area('A').contents, ...contents } }, area('B')],
    })
    const contentsOf = () => screen.getByTestId('area-contents')

    it('lists the sub-factories, areas inside and rows as labelled name lists', () => {
      renderMatrix({
        matrix: withContents({ rowCount: 3, subFactories: ['Compression'], nestedAreas: ['Cooling'], recipeNames: ['Steam electrolysis', 'Hydrogen', 'Oxygen'] }),
        focusedAreaId: 'A',
      })
      const section = contentsOf()
      expect(within(section).getByTestId('area-contents-subfactories')).toHaveTextContent('Sub-factoriesCompression')
      expect(within(section).getByTestId('area-contents-areas')).toHaveTextContent('Areas insideCooling')
      const rows = within(section).getByTestId('area-contents-rows')
      expect(within(rows).getAllByRole('listitem').map(li => li.textContent)).toEqual(['Steam electrolysis', 'Hydrogen', 'Oxygen'])
      expect(within(section).queryByTestId('area-contents-more')).toBeNull()
    })

    it('shows the first four rows and a "+N more" chip', () => {
      renderMatrix({ matrix: withContents({ rowCount: 7, recipeNames: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] }), focusedAreaId: 'A' })
      const rows = within(contentsOf()).getByTestId('area-contents-rows')
      expect(within(rows).getAllByRole('listitem').map(li => li.textContent)).toEqual(['a', 'b', 'c', 'd', '+3 more'])
      expect(within(rows).getByTestId('area-contents-more')).toHaveTextContent('+3 more')
    })

    it('leaves out an empty list and says nothing for "none"', () => {
      renderMatrix({ matrix: withContents({ recipeNames: ['a'] }), focusedAreaId: 'A' })
      expect(within(contentsOf()).queryByTestId('area-contents-subfactories')).toBeNull()
      expect(within(contentsOf()).queryByTestId('area-contents-areas')).toBeNull()
      expect(screen.queryByText(/No sub-factories|No rows|Rows:|Rows include/)).toBeNull()
    })

    it('omits the section when nothing is inside', () => {
      renderMatrix({ matrix: withContents({ rowCount: 0 }), focusedAreaId: 'A' })
      expect(screen.queryByTestId('area-contents')).toBeNull()
      expect(screen.queryByText('Contents')).toBeNull()
    })
  })

  it('words the header note of an energy-only trade by its direction', () => {
    renderMatrix({ matrix: { ...matrix, rows: [elecRow] }, focusedAreaId: 'B' })
    const head = document.querySelector('thead button[data-tip="Focus A"]')!.closest('th')!
    expect(head.textContent).toContain('sends it 1 item')
  })

  it('leaves the totals of an ungrouped matrix alone and hints at the left-out rows', () => {
    const mixed = { ...elecRow, groupId: 'other-items' }
    renderMatrix({ matrix: { ...matrix, rows: [mixed, plateRow] } })
    const note = document.querySelector('tbody[data-group-id="other-items"] span[data-tip]')
    expect(note?.getAttribute('data-tip')).toMatch(/leave out/)
    const toggle = document.querySelector<HTMLElement>('tbody[data-group-id="other-items"] th button')!
    expect(toggle).toHaveAccessibleDescription(/leave out/)
    expect(toggle).not.toHaveAttribute('title')
  })

  it('adds no total for a group holding electricity and heat', () => {
    const heat = { ...elecRow, itemId: 'power:heat', name: 'Heat' }
    renderMatrix({ matrix: { ...matrix, rows: [elecRow, heat] } })
    const header = document.querySelector('tbody[data-group-id="power"] tr')!
    expect(header.textContent).not.toContain('MW')
  })

  it('lists under each partner the items traded, with their direction', () => {
    renderMatrix({ focusedAreaId: 'A' })
    const lines = screen.getByTestId('trade-lines-B')
    const elec = lines.querySelector(`[data-item-id="${ELEC}"]`)!
    expect(elec.textContent).toContain('Electricity')
    expect(elec.textContent).toContain('5.0MW out')
    const plate = lines.querySelector('[data-item-id="plate"]')!
    expect(plate.textContent).toContain('Plate')
    expect(plate.textContent).toContain('in')
    expect(plate.getAttribute('data-direction')).toBe('in')
    // Items before energy.
    expect([...lines.querySelectorAll('li')].map(l => l.getAttribute('data-item-id'))).toEqual(['plate', ELEC])
  })

  it('folds a long list of trades after four and unfolds it', () => {
    const rows: MatrixRow[] = ['a', 'b', 'c', 'd', 'e'].map((id, i) => ({
      key: id, itemId: id, name: id.toUpperCase(), groupId: 'other-items', cells: { A: 10 - i, B: -(10 - i) },
      fromOutside: 0, toOutside: 0, total: 10 - i, pairs: [{ from: 'A', to: 'B', rate: 10 - i }],
    }))
    renderMatrix({ matrix: { ...matrix, rows }, focusedAreaId: 'A' })
    expect(screen.getByTestId('trade-lines-B').querySelectorAll('li')).toHaveLength(4)
    const toggle = screen.getByTestId('trade-lines-B-toggle')
    expect(toggle.textContent).toBe('Show all 5')
    fireEvent.click(toggle)
    expect(screen.getByTestId('trade-lines-B').querySelectorAll('li')).toHaveLength(5)
  })
})

describe('BlockAreaMatrix rows of a split fluid', () => {
  const steam = (key: string, temp: MatrixRow['temp'], total: number): MatrixRow => ({
    key, itemId: 'steam', temp, name: 'Steam', groupId: 'power', cells: { A: total, B: -total },
    fromOutside: 0, toOutside: 0, total, pairs: [{ from: 'A', to: 'B', rate: total }],
  })

  it('renders one row per key with its label and data attributes', () => {
    renderMatrix({ matrix: { ...matrix, rows: [steam('steam@165', { at: 165 }, 60), steam('steam[465,]', { min: 465 }, 30)] } })
    const rows = [...document.querySelectorAll('tr[data-item-id="steam"]')]
    expect(rows.map(r => r.getAttribute('data-flow-key'))).toEqual(['steam@165', 'steam[465,]'])
    expect(rows.map(r => r.querySelector('[data-testid="matrix-row-temperature"]')?.textContent)).toEqual(['165°C', '≥465°C'])
  })

  it('lists the trade lines of a focus per key', () => {
    renderMatrix({ matrix: { ...matrix, rows: [steam('steam@165', { at: 165 }, 60), steam('steam[465,]', { min: 465 }, 30)] }, focusedAreaId: 'A' })
    const lines = [...screen.getByTestId('trade-lines-B').querySelectorAll('li')]
    expect(lines).toHaveLength(2)
    expect(lines.every(l => l.getAttribute('data-item-id') === 'steam')).toBe(true)
    expect(lines.map(l => l.textContent)).toEqual([expect.stringContaining('Steam 165°C'), expect.stringContaining('Steam ≥465°C')])
  })
})

describe('BlockAreaMatrix outside split', () => {
  const splitRow: MatrixRow = {
    key: 'plate', itemId: 'plate', name: 'Plate', groupId: 'other-items', cells: { A: -5 },
    fromOutside: 5, toOutside: 0, total: 0, fromSplit: { connected: 3, imported: 2, missing: 0 }, pairs: [],
  }
  const withRows = (...rows: MatrixRow[]): BlockMatrix => ({ ...matrix, rows })
  const fromCell = (itemId = 'plate') => document.querySelector<HTMLElement>(`tr[data-item-id="${itemId}"] td[data-col="from-outside"]`)!
  const bar = (td: HTMLElement) => td.querySelector<HTMLElement>('[data-testid="outside-split"]')

  it('keeps the figure and adds the parts as attributes, a bar and a tooltip', () => {
    renderMatrix({ matrix: withRows(splitRow) })
    const td = fromCell()
    expect(td.textContent).toBe('5.00')
    expect(td).toHaveAttribute('data-rate', '5')
    expect(td).toHaveAttribute('data-connected', '3')
    expect(td).toHaveAttribute('data-imported', '2')
    expect(td).toHaveAttribute('data-missing', '0')
    expectTip(td, '3.00/m connected and 2.00/m imported.')
    const parts = [...bar(td)!.children] as HTMLElement[]
    expect(parts.map(p => p.getAttribute('data-part'))).toEqual(['connected', 'imported'])
    expect(parts.map(p => p.style.width)).toEqual(['60%', '40%'])
  })

  it('words the tooltip in the rate unit and with every clause', () => {
    expect(outsideTip({ connected: 60, imported: 120, missing: 0 }, 'sec')).toBe('1.00/s connected and 2.00/s imported.')
    expect(outsideTip({ connected: 3, imported: 2, missing: 1 }, 'min')).toBe('3.00/m connected, 2.00/m imported and 1.00/m missing because Import is off.')
    expect(outsideTip({ connected: 5, imported: 0, missing: 0 }, 'min')).toBe('All 5.00/m connected.')
    expect(outsideTip({ connected: 0, imported: 5, missing: 0 }, 'min')).toBe('All 5.00/m imported.')
  })

  it('draws a missing part in the bar', () => {
    renderMatrix({ matrix: withRows({ ...splitRow, fromSplit: { connected: 2, imported: 1, missing: 2 } }) })
    expect([...bar(fromCell())!.children].map(p => p.getAttribute('data-part'))).toEqual(['connected', 'imported', 'missing'])
  })

  it('leaves a row with no split plain', () => {
    renderMatrix({ matrix: withRows({ ...splitRow, fromSplit: undefined }) })
    expect(fromCell()).not.toHaveAttribute('data-connected')
    expect(bar(fromCell())).toBeNull()
  })

  it('shows no split in focus mode', () => {
    renderMatrix({ matrix: withRows(splitRow), focusedAreaId: 'A' })
    const td = fromCell()
    expect(td).not.toHaveAttribute('data-connected')
    expect(td).not.toHaveAttribute('data-tip')
    expect(bar(td)).toBeNull()
  })

  it('shows no bar on electricity', () => {
    renderMatrix({ matrix: withRows({ ...elecRow, fromOutside: 0 }) })
    expect(bar(fromCell(ELEC))).toBeNull()
    expect(fromCell(ELEC).textContent).toBe('')
  })

  it('explains the column in the tooltip of its heading', () => {
    renderMatrix()
    expectTip(screen.getByText('From outside'), FROM_OUTSIDE_TIP)
  })
})
