import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { ServedOrderPopover } from './ServedOrderPopover'
import { makeEmptyBlock } from '../../store/blockStore'
import type { GameData, ServedEntry, ServedList } from '../../data/types'

const items = { plate: { id: 'plate', name: 'Plate', type: 'item', iconPath: '', hidden: false } } as unknown as GameData['items']
const blocks = [{ ...makeEmptyBlock('Gears'), id: 'b' }, { ...makeEmptyBlock('Belts'), id: 'c' }]
const list: ServedList = {
  consumers: [
    { blockId: 'b', connectionId: 'cb', kind: 'request', share: 30, got: 30 },
    { blockId: 'c', connectionId: 'cc', kind: 'take', share: 5, got: 5 },
  ],
  extra: { place: 2, asked: 10, got: 4 },
}

const blk = (blockId: string): ServedEntry => ({ kind: 'block', blockId })
const extra: ServedEntry = { kind: 'extra' }

function renderPopover(onClose = vi.fn()) {
  renderWith({ onClose })
  return onClose
}

function renderWith(over: Partial<React.ComponentProps<typeof ServedOrderPopover>> = {}) {
  const onMove = vi.fn()
  const onReset = vi.fn()
  render(
    <ServedOrderPopover
      itemId="plate" list={list} items={items} blocks={blocks} rateUnit="min" stored={undefined}
      onMove={onMove} onReset={onReset} x={10} y={10} onClose={vi.fn()} {...over}
    />,
  )
  return { onMove, onReset }
}

const lineOf = (key: string) => document.querySelector<HTMLElement>(`[data-line-key="${key}"]`)!
const button = (key: string, id: string) => within(lineOf(key)).getByTestId(id)

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

  it('without a stored list: the ends cannot move, and there is no divider or reset', () => {
    renderWith()
    expect(button('block:b', 'served-move-up').getAttribute('aria-disabled')).toBe('true')
    expect(button('extra', 'served-move-down').getAttribute('aria-disabled')).toBe('true')
    expect(button('block:b', 'served-move-down').getAttribute('aria-disabled')).toBe('false')
    expect(screen.queryByTestId('served-divider')).toBeNull()
    expect(screen.queryByTestId('served-reset')).toBeNull()
  })

  it('moves a line one place with the buttons, in the store terms of an insertion index', () => {
    const { onMove } = renderWith()
    const shown = [blk('b'), blk('c'), extra]
    fireEvent.click(button('block:b', 'served-move-down'))
    expect(onMove).toHaveBeenLastCalledWith(blk('b'), 2, shown)
    fireEvent.click(button('block:c', 'served-move-up'))
    expect(onMove).toHaveBeenLastCalledWith(blk('c'), 0, shown)
    fireEvent.click(button('block:c', 'served-move-down'))
    expect(onMove).toHaveBeenLastCalledWith(blk('c'), 3, shown)
    expect(screen.getByRole('status').textContent).toBe('Belts moved to place 3.')
  })

  it('ignores a click on a disabled button', () => {
    const { onMove } = renderWith()
    fireEvent.click(button('block:b', 'served-move-up'))
    fireEvent.click(button('extra', 'served-move-down'))
    expect(onMove).not.toHaveBeenCalled()
  })

  it('shows the stored list first, the rest under the divider, and adds a line last', () => {
    const three: ServedList = { consumers: [...list.consumers, { blockId: 'd', connectionId: 'cd', kind: 'request', share: 1, got: 1 }] }
    const { onMove, onReset } = renderWith({
      list: three, stored: [blk('c'), blk('b')], blocks: [...blocks, { ...makeEmptyBlock('Late'), id: 'd' }],
    })
    const ranked = within(screen.getByTestId('served-ranked')).getAllByTestId('served-line')
    expect(ranked.map(l => l.dataset.blockId)).toEqual(['c', 'b'])
    expect(screen.getByTestId('served-divider').textContent).toContain('Not ranked: served after the list')
    const unranked = within(screen.getByTestId('served-unranked')).getAllByTestId('served-line')
    expect(unranked.map(l => l.dataset.blockId)).toEqual(['d'])
    expect(within(unranked[0]).queryByTestId('served-move-up')).toBeNull()
    expect(button('block:b', 'served-move-down').getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(within(unranked[0]).getByTestId('served-add'))
    expect(onMove).toHaveBeenCalledWith(blk('d'), 2, [blk('c'), blk('b')])
    fireEvent.click(screen.getByTestId('served-reset'))
    expect(onReset).toHaveBeenCalled()
    expect(document.activeElement).toBe(screen.getByRole('dialog'))
  })

  it('skips a stale entry when computing where a line goes', () => {
    const { onMove } = renderWith({ stored: [blk('x'), blk('b'), blk('c')], list: { consumers: list.consumers } })
    fireEvent.click(button('block:c', 'served-move-up'))
    expect(onMove).toHaveBeenCalledWith(blk('c'), 1, [blk('b'), blk('c')])
  })

  it('puts an extra the stored list does not name under the divider, last', () => {
    renderWith({ stored: [blk('b'), blk('c')] })
    expect(within(screen.getByTestId('served-unranked')).getAllByTestId('served-line').map(l => l.dataset.kind)).toEqual(['extra'])
    expect(screen.getByTestId('served-unranked').textContent).toContain('Extra output')
  })

  it('reads a take as needs / got / short, and flags a take with no credit', () => {
    const takes = (need: number | undefined, notCredited?: true): ServedList => ({
      consumers: [
        { blockId: 'b', connectionId: 'cb', kind: 'take', share: 0, got: 0, ...(need !== undefined ? { need } : {}), ...(notCredited ? { notCredited } : {}) },
        { blockId: 'c', connectionId: 'cc', kind: 'request', share: 1, got: 1 },
      ],
    })
    const sole = [
      { ...blocks[0], inputConnections: [{ id: 'cb', itemId: 'plate', fromBlockId: 's' }] },
      blocks[1],
    ] as typeof blocks
    const { unmount } = render(
      <ServedOrderPopover itemId="plate" list={takes(8, true)} items={items} blocks={sole} rateUnit="min" stored={undefined} onMove={vi.fn()} onReset={vi.fn()} x={0} y={0} onClose={vi.fn()} />,
    )
    const line = lineOf('block:b')
    expect(line.textContent).toContain('needs 8.0')
    expect(line.textContent).toContain('got 0.0')
    expect(within(line).getByTestId('served-short').textContent).toContain('short 8.0')
    expect(within(line).getByTestId('served-not-credited').textContent).toBe('no credit')
    unmount()
    const two = [
      { ...blocks[0], inputConnections: [{ id: 'cb', itemId: 'plate', fromBlockId: 's' }, { id: 'cb2', itemId: 'plate', fromBlockId: 't' }] },
      blocks[1],
    ] as typeof blocks
    render(
      <ServedOrderPopover itemId="plate" list={takes(8)} items={items} blocks={two} rateUnit="min" stored={undefined} onMove={vi.fn()} onReset={vi.fn()} x={0} y={0} onClose={vi.fn()} />,
    )
    expect(within(lineOf('block:b')).queryByTestId('served-short')).toBeNull()
    expect(within(lineOf('block:b')).queryByTestId('served-not-credited')).toBeNull()
  })

  it('closes on Escape', () => {
    const onClose = renderPopover()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })
})
