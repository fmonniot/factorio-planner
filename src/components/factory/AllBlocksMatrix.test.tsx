import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import { AllBlocksMatrix, type AllBlocksMatrixProps } from './AllBlocksMatrix'
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
  itemId: ELEC, name: 'Electricity', groupId: 'power',
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
      selectedItemId={null}
      onSelectItem={vi.fn()}
      groupOverrides={new Map()}
      onToggleGroup={vi.fn()}
      openTails={new Set()}
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
    const { container } = renderMatrix({ selectedItemId: ELEC })
    const text = container.textContent ?? ''
    expect(text).toContain('Alpha +10.0MW leaves the block')
    expect(text).toContain('Alpha → Bravo: 5.0MW')
    expect(text).toContain('5.0MW is not taken by any block')
    expect(text).not.toContain('/m')
  })
})
