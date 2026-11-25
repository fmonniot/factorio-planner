import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { AllBlocksMatrix, NET_TIP, NOT_SUPPLIED_TIP, NOT_TAKEN_TIP, type AllBlocksMatrixProps } from './AllBlocksMatrix'
import { expectTip } from '../../test/byTip'
import type { PlanMatrixRow } from './planAreaMatrix'
import type { GameData } from '../../data/types'

const ELEC = 'power:electricity'
const gameData = {
  items: { [ELEC]: { id: ELEC, name: 'Electricity', type: 'item', iconPath: '', subgroup: 'power' } },
  itemGroups: { power: { id: 'power', name: 'Power', order: 'a', iconPath: '' } },
  itemSubgroups: { power: { id: 'power', group: 'power', order: '' } },
} as unknown as GameData

// Block A leaves 600 units/min (10 MW); 300 are taken by B, 300 are not taken.
const row: PlanMatrixRow = {
  key: ELEC, itemId: ELEC, name: 'Electricity', groupId: 'power',
  net: { A: 600, B: -300 }, areaCells: {},
  delivered: 300, notTaken: 300, notSupplied: 0, total: 600,
  flows: [{
    connectionId: 'c1', fromBlockId: 'A', toBlockId: 'B', itemId: ELEC,
    available: 600, capped: false, rate: 300, status: 'ok', kind: 'take',
  }],
}

function renderMatrix(over: Partial<AllBlocksMatrixProps> = {}) {
  return render(
    <AllBlocksMatrix
      model={{
        blocks: [
          { blockId: 'A', name: 'Alpha', color: '#111111', areas: [] },
          { blockId: 'B', name: 'Bravo', color: '#222222', areas: [] },
        ],
        rows: [row],
      }}
      gameData={gameData}
      rateUnit="min"
      rowMode="category"
      query=""
      crossingOnly={false}
      onCrossingOnly={vi.fn()}
      expandedBlocks={new Set()}
      onToggleBlock={vi.fn()}
      selectedKey={null}
      onSelectKey={vi.fn()}
      groupOverrides={new Map()}
      onToggleGroup={vi.fn()}
      closedTails={new Set()}
      onToggleTail={vi.fn()}
      {...over}
    />,
  )
}

const cell = (col: string) => document.querySelector(`tr[data-item-id="${ELEC}"] td[data-col="${col}"]`)!.textContent

describe('AllBlocksMatrix power units', () => {
  it.each(['min', 'sec'] as const)('shows the net and the not-taken cells in MW (%s)', rateUnit => {
    renderMatrix({ rateUnit })
    expect(cell('A:net')).toBe('+10.0MW')
    expect(cell('B:net')).toBe('−5.0MW')
    expect(cell('not-taken')).toBe('5.0MW')
  })

  it('words the inspector in power units', () => {
    const { container } = renderMatrix({ selectedKey: ELEC })
    const text = container.textContent ?? ''
    expect(text).toContain('Alpha +10.0MW leaves the block')
    expect(text).toContain('Alpha → Bravo: 5.0MW')
    expect(screen.getByTestId('inspector-not-taken')).toHaveTextContent(/^Not taken\s*5\.0MW$/)
    expect(text).not.toMatch(/not taken by any block|not supplied by any block/)
    expect(text).not.toContain('/m')
  })

  it('shows what is not supplied as a label and a figure', () => {
    renderMatrix({
      model: {
        blocks: [{ blockId: 'A', name: 'Alpha', color: '#111111', areas: [] }, { blockId: 'B', name: 'Bravo', color: '#222222', areas: [] }],
        rows: [{ ...row, notTaken: 0, notSupplied: 600 }],
      },
      selectedKey: ELEC,
    })
    expect(screen.getByTestId('inspector-not-supplied')).toHaveTextContent(/^Not supplied\s*10\.0MW$/)
    expect(screen.queryByTestId('inspector-not-taken')).toBeNull()
    expectTip(within(screen.getByTestId('inspector-not-supplied')).getByText('Not supplied'), NOT_SUPPLIED_TIP)
    expect(document.body.textContent).not.toMatch(/is not supplied by any block/)
  })

  it('explains the Net, Not taken and Not supplied headers in tooltips', () => {
    renderMatrix({ model: {
      blocks: [{ blockId: 'A', name: 'Alpha', color: '#111111', areas: [] }, { blockId: 'B', name: 'Bravo', color: '#222222', areas: [] }],
      rows: [{ ...row, notSupplied: 600 }],
    } })
    const nets = screen.getAllByRole('columnheader', { name: 'Net' })
    expect(nets).toHaveLength(2)
    for (const net of nets) expectTip(net, NET_TIP)
    expectTip(screen.getByText('Not taken'), NOT_TAKEN_TIP)
    expectTip(screen.getByText('Not supplied'), NOT_SUPPLIED_TIP)
    expect(NET_TIP).toBe('What the block takes or leaves across its boundary.')
    expect(NOT_TAKEN_TIP).toBe('Not taken by any block: extra output, byproduct or surplus.')
    expect(NOT_SUPPLIED_TIP).toBe('Not supplied by any block: it is imported.')
  })
})

describe('AllBlocksMatrix rows of a split fluid', () => {
  const steamRow = (key: string, temp: PlanMatrixRow['temp'], total: number): PlanMatrixRow => ({
    key, itemId: 'steam', temp, name: 'Steam', groupId: 'power',
    net: { A: total }, areaCells: {}, delivered: 0, notTaken: total, notSupplied: 0, total, flows: [],
  })
  const model = {
    blocks: [{ blockId: 'A', name: 'Alpha', color: '#111111', areas: [] }],
    rows: [steamRow('steam@165', { at: 165 }, 60), steamRow('steam@465', { at: 465 }, 30)],
  }
  const gd = {
    ...gameData,
    items: { ...gameData.items, steam: { id: 'steam', name: 'Steam', type: 'fluid', iconPath: '', subgroup: 'power' } },
  } as unknown as GameData

  it('renders one row per key with its label', () => {
    renderMatrix({ model, gameData: gd })
    const rows = [...document.querySelectorAll('tr[data-item-id="steam"]')]
    expect(rows.map(r => r.getAttribute('data-flow-key'))).toEqual(['steam@165', 'steam@465'])
    expect(rows.map(r => r.querySelector('[data-testid="matrix-row-temperature"]')?.textContent)).toEqual(['165°C', '465°C'])
  })

  it('selects a key and names the inspector after it', () => {
    const onSelectKey = vi.fn()
    renderMatrix({ model, gameData: gd, onSelectKey })
    fireEvent.click(document.querySelector('tr[data-flow-key="steam@465"] button')!)
    expect(onSelectKey).toHaveBeenCalledWith('steam@465')
    renderMatrix({ model, gameData: gd, selectedKey: 'steam@465' })
    expect(screen.getByRole('region', { name: 'Steam 465°C across blocks' })).toBeTruthy()
  })
})
