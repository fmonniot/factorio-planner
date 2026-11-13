import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { ServedOrderPopover } from './ServedOrderPopover'
import { makeEmptyBlock } from '../../store/blockStore'
import type { GameData, ServedList } from '../../data/types'

const items = { plate: { id: 'plate', name: 'Plate', type: 'item', iconPath: '', hidden: false } } as unknown as GameData['items']
const blocks = [{ ...makeEmptyBlock('Gears'), id: 'b' }, { ...makeEmptyBlock('Belts'), id: 'c' }]
const list: ServedList = {
  consumers: [
    { blockId: 'b', connectionId: 'cb', kind: 'request', share: 30, got: 30 },
    { blockId: 'c', connectionId: 'cc', kind: 'take', share: 5, got: 5 },
  ],
  extra: { place: 2, asked: 10, got: 4 },
}

function renderPopover(onClose = vi.fn()) {
  render(<ServedOrderPopover itemId="plate" list={list} items={items} blocks={blocks} rateUnit="min" x={10} y={10} onClose={onClose} />)
  return onClose
}

describe('ServedOrderPopover', () => {
  it('lists the lines in order, short only on the short one', () => {
    renderPopover()
    const dialog = screen.getByRole('dialog', { name: 'Served order of Plate' })
    const lines = within(dialog).getAllByTestId('served-line')
    expect(lines.map(l => l.dataset.kind)).toEqual(['request', 'take', 'extra'])
    expect(lines[0].textContent).toContain('Gears')
    expect(lines[0].textContent).toContain('asked 30.0')
    expect(lines[0].textContent).toContain('got 30.0')
    expect(within(lines[0]).queryByTestId('served-short')).toBeNull()
    expect(lines[1].textContent).toContain('takes what is left')
    expect(lines[2].textContent).toContain('Extra output')
    expect(within(lines[2]).getByTestId('served-short').textContent).toContain('short 6.0')
    expect(within(dialog).getAllByTestId('served-short')).toHaveLength(1)
  })

  it('closes on Escape', () => {
    const onClose = renderPopover()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })
})
