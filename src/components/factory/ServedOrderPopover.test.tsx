import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, createEvent, within } from '@testing-library/react'
import { LIST_ORDER_HINT, ServedOrderPopover } from './ServedOrderPopover'
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
  const onPlace = vi.fn()
  const onTie = vi.fn()
  const onShare = vi.fn()
  render(
    <ServedOrderPopover
      itemId="plate" list={list} items={items} blocks={blocks} rateUnit="min" stored={undefined}
      onMove={onMove} onReset={onReset} onPlace={onPlace} onTie={onTie} onShare={onShare} x={10} y={10} onClose={vi.fn()} {...over}
    />,
  )
  return { onMove, onReset, onPlace, onTie, onShare }
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

  it('reads a take as needs / got, never short, and flags a take with no credit', () => {
    const takes = (need: number | undefined, notCredited?: true): ServedList => ({
      consumers: [
        { blockId: 'b', connectionId: 'cb', kind: 'take', share: 0, got: 0, ...(need !== undefined ? { need } : {}), ...(notCredited ? { notCredited } : {}) },
        { blockId: 'c', connectionId: 'cc', kind: 'request', share: 1, got: 1 },
      ],
    })
    const { unmount } = render(
      <ServedOrderPopover itemId="plate" list={takes(8, true)} items={items} blocks={blocks} rateUnit="min" stored={undefined} onMove={vi.fn()} onReset={vi.fn()} onPlace={vi.fn()} onTie={vi.fn()} onShare={vi.fn()} x={0} y={0} onClose={vi.fn()} />,
    )
    const line = lineOf('block:b')
    expect(line.textContent).toContain('needs 8.0')
    expect(line.textContent).toContain('got 0.0')
    expect(within(line).queryByTestId('served-short')).toBeNull()
    expect(within(line).getByTestId('served-not-credited').textContent).toBe('no credit')
    unmount()
    render(
      <ServedOrderPopover itemId="plate" list={takes(undefined)} items={items} blocks={blocks} rateUnit="min" stored={undefined} onMove={vi.fn()} onReset={vi.fn()} onPlace={vi.fn()} onTie={vi.fn()} onShare={vi.fn()} x={0} y={0} onClose={vi.fn()} />,
    )
    expect(lineOf('block:b').textContent).toContain('takes what is left')
    expect(within(lineOf('block:b')).queryByTestId('served-not-credited')).toBeNull()
  })

  it('closes on a scroll outside the popover, not on one inside it', () => {
    const onClose = renderPopover()
    fireEvent.scroll(screen.getByTestId('served-ranked'))
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.scroll(document.body)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('keeps its clicks and drags from reaching the components around it', () => {
    const onClick = vi.fn()
    const onDragStart = vi.fn()
    render(
      <div onClick={onClick} onDragStart={onDragStart}>
        <ServedOrderPopover itemId="plate" list={list} items={items} blocks={blocks} rateUnit="min" stored={undefined} onMove={vi.fn()} onReset={vi.fn()} onPlace={vi.fn()} onTie={vi.fn()} onShare={vi.fn()} x={0} y={0} onClose={vi.fn()} />
      </div>,
    )
    fireEvent.click(screen.getByText('Served in this order'))
    fireEvent.dragStart(lineOf('block:b'))
    expect(onClick).not.toHaveBeenCalled()
    expect(onDragStart).not.toHaveBeenCalled()
  })

  it('announces the place an added line takes', () => {
    renderWith({ stored: [blk('b'), blk('c')], list: { consumers: [...list.consumers, { blockId: 'd', connectionId: 'cd', kind: 'request', share: 1, got: 1 }] }, blocks: [...blocks, { ...makeEmptyBlock('Cogs'), id: 'd' }] })
    fireEvent.click(button('block:d', 'served-add'))
    expect(screen.getByRole('status').textContent).toBe('Cogs moved to place 3.')
  })

  it('does not announce or call onMove for a move that changes nothing', () => {
    const { onMove } = renderWith({ stored: [blk('b'), blk('c')] })
    fireEvent.click(button('block:c', 'served-move-down')) // disabled: the last line
    expect(onMove).not.toHaveBeenCalled()
    expect(screen.getByRole('status').textContent).toBe('')
  })

  it('closes on Escape', () => {
    const onClose = renderPopover()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })
})

describe('ServedOrderPopover groups, shares and drops', () => {
  const three: ServedList = {
    consumers: [
      { blockId: 'b', connectionId: 'cb', kind: 'request', share: 30, got: 30 },
      { blockId: 'c', connectionId: 'cc', kind: 'request', share: 20, got: 15 },
      { blockId: 'd', connectionId: 'cd', kind: 'request', share: 10, got: 0 },
    ],
    extra: { place: 3, asked: 10, got: 0 },
  }
  const blocks3 = [{ ...makeEmptyBlock('Gears'), id: 'b' }, { ...makeEmptyBlock('Belts'), id: 'c' }, { ...makeEmptyBlock('Cogs'), id: 'd' }]
  const render3 = (stored?: ServedEntry[], over: Partial<React.ComponentProps<typeof ServedOrderPopover>> = {}) =>
    renderWith({ list: three, blocks: blocks3, stored, ...over })
  const tied = (blockId: string, share?: number): ServedEntry => ({ kind: 'block', blockId, tied: true, ...(share !== undefined ? { share } : {}) })
  const shared = (blockId: string, share: number): ServedEntry => ({ kind: 'block', blockId, share })
  const status = () => screen.getByRole('status').textContent
  const ranked = () => within(screen.getByTestId('served-ranked')).getAllByTestId('served-line')
  const field = (name: string) => screen.getByLabelText(`Share of ${name} in its group (%)`) as HTMLInputElement

  const dt = () => ({ setData: vi.fn(), getData: vi.fn(), effectAllowed: '', dropEffect: '' })
  // happy-dom has no DragEvent, so the event is a plain one and `clientY` is set by hand.
  const drag = (type: 'dragOver' | 'drop', target: HTMLElement, clientY: number, dataTransfer: ReturnType<typeof dt>) => {
    const event = createEvent[type](target, { dataTransfer })
    Object.defineProperty(event, 'clientY', { value: clientY })
    fireEvent(target, event)
  }
  function over(from: string, to: string, clientY: number, finish = false) {
    const target = lineOf(to)
    vi.spyOn(target, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 100, 300, 40))
    const transfer = dt()
    fireEvent.dragStart(lineOf(from), { dataTransfer: transfer })
    drag('dragOver', target, clientY, transfer)
    if (finish) drag('drop', target, clientY, transfer)
    return target
  }
  const TOP = 102
  const MIDDLE = 120
  const BOTTOM = 138

  it('draws a group: one rank, a bracket, a percent field per member, the toggle states', () => {
    render3([blk('b'), shared('c', 80), tied('d', 20)])
    expect(ranked().map(l => l.dataset.rank)).toEqual(['1', '2', '2'])
    expect(screen.getAllByTestId('served-rank').slice(0, 3).map(r => r.textContent)).toEqual(['1', '2', ''])
    expect(ranked().map(l => l.dataset.groupPosition)).toEqual([undefined, 'first', 'last'])
    expect(field('Belts').value).toBe('80')
    expect(field('Cogs').value).toBe('20')
    expect(screen.queryByLabelText('Share of Gears in its group (%)')).toBeNull()
    expect(button('block:b', 'served-tie').getAttribute('aria-disabled')).toBe('true')
    expect(button('block:c', 'served-tie').getAttribute('aria-pressed')).toBe('false')
    expect(button('block:d', 'served-tie').getAttribute('aria-pressed')).toBe('true')
    expect(button('block:d', 'served-tie').textContent).toBe('Share')
  })

  it('shows an equal split that is stored nowhere', () => {
    const { onShare, onPlace, onTie, onMove } = render3([blk('b'), blk('c'), tied('d')])
    expect([field('Belts').value, field('Cogs').value]).toEqual(['50', '50'])
    expect(onShare).not.toHaveBeenCalled()
    expect(onPlace).not.toHaveBeenCalled()
    expect(onTie).not.toHaveBeenCalled()
    expect(onMove).not.toHaveBeenCalled()
  })

  it('shows a three-way split with one decimal', () => {
    render3([blk('b'), tied('c'), tied('d')])
    expect(['Gears', 'Belts', 'Cogs'].map(n => field(n).value)).toEqual(['33.3', '33.3', '33.3'])
  })

  it('toggles a line into the group above', () => {
    const { onTie } = render3()
    fireEvent.click(button('block:d', 'served-tie'))
    expect(onTie).toHaveBeenCalledWith(blk('d'), true, [blk('b'), blk('c'), blk('d'), extra])
    expect(status()).toBe('Cogs now shares place 2 with Belts.')
  })

  it('toggles a group head into the line above and says the lines under it went along', () => {
    const { onTie } = render3([blk('b'), blk('c'), tied('d')])
    fireEvent.click(button('block:c', 'served-tie'))
    expect(onTie).toHaveBeenCalledWith(blk('c'), true, [blk('b'), blk('c'), blk('d')])
    expect(status()).toBe('Belts now shares place 1 with Gears. The 1 line under it went with it.')
  })

  it('toggles the last member and a middle member out of a group', () => {
    const { onTie } = render3([blk('b'), tied('c'), tied('d')])
    fireEvent.click(button('block:d', 'served-tie'))
    expect(onTie).toHaveBeenLastCalledWith(blk('d'), false, [blk('b'), blk('c'), blk('d')])
    expect(status()).toBe('Cogs left its group and has its own place 2.')
    fireEvent.click(button('block:c', 'served-tie'))
    expect(onTie).toHaveBeenLastCalledWith(blk('c'), false, [blk('b'), blk('c'), blk('d')])
    expect(status()).toBe('Belts and the 1 line under it left the group; they share place 2.')
  })

  it('ignores the toggle of the first line', () => {
    const { onTie } = render3()
    fireEvent.click(button('block:b', 'served-tie'))
    expect(onTie).not.toHaveBeenCalled()
    expect(status()).toBe('')
  })

  it('refuses to share with a stale entry directly above and says so', () => {
    const { onTie } = render3([blk('b'), extra, blk('c')], { list: { consumers: three.consumers } })
    fireEvent.click(button('block:c', 'served-tie'))
    expect(onTie).not.toHaveBeenCalled()
    expect(status()).toBe('Belts could not share with the line above.')
  })

  describe('percent field', () => {
    const setup = () => {
      const r = render3([blk('b'), blk('c'), tied('d')])
      return { ...r, input: field('Belts') }
    }
    it('commits on Enter', () => {
      const { onShare, input } = setup()
      fireEvent.change(input, { target: { value: '70' } })
      fireEvent.keyDown(input, { key: 'Enter' })
      expect(onShare).toHaveBeenCalledTimes(1)
      expect(onShare).toHaveBeenCalledWith(blk('c'), 70, [blk('b'), blk('c'), blk('d')])
      expect(status()).toBe('Belts now has 70 percent of place 2.')
    })
    it('commits once on blur', () => {
      const { onShare, input } = setup()
      fireEvent.change(input, { target: { value: '70' } })
      fireEvent.blur(input)
      expect(onShare).toHaveBeenCalledTimes(1)
      expect(onShare).toHaveBeenCalledWith(blk('c'), 70, [blk('b'), blk('c'), blk('d')])
    })
    it('stores nothing for the value it already shows', () => {
      const { onShare, input } = setup()
      fireEvent.change(input, { target: { value: '50' } })
      fireEvent.keyDown(input, { key: 'Enter' })
      expect(onShare).not.toHaveBeenCalled()
      expect(status()).toBe('')
    })
    it('refuses 0, 100 and an empty field', () => {
      const { onShare, input } = setup()
      for (const value of ['0', '100', '']) {
        fireEvent.change(input, { target: { value } })
        fireEvent.keyDown(input, { key: 'Enter' })
        expect(input.value).toBe('50')
        expect(status()).toBe('Share must be above 0 and below 100.')
      }
      expect(onShare).not.toHaveBeenCalled()
    })
    it('reverts on the first Escape and lets the second close the popover', () => {
      const onClose = vi.fn()
      const { input } = (() => { const r = render3([blk('b'), blk('c'), tied('d')], { onClose }); return { ...r, input: field('Belts') } })()
      fireEvent.change(input, { target: { value: '30' } })
      fireEvent.keyDown(input, { key: 'Escape' })
      expect(input.value).toBe('50')
      expect(onClose).not.toHaveBeenCalled()
      fireEvent.keyDown(document, { key: 'Escape' })
      expect(onClose).toHaveBeenCalled()
    })
  })

  describe('drops', () => {
    it('a middle drop joins the group of the target', () => {
      const { onPlace } = render3([blk('b'), blk('c'), blk('d')])
      const target = over('block:d', 'block:c', MIDDLE)
      expect(screen.getAllByTestId('served-drop-join')).toHaveLength(1)
      expect(screen.queryByTestId('served-drop-line')).toBeNull()
      drag('drop', target, MIDDLE, dt())
      expect(onPlace).toHaveBeenCalledWith(blk('d'), { kind: 'join', target: blk('c') }, [blk('b'), blk('c'), blk('d')])
      expect(status()).toBe('Cogs now shares place 2 with Belts.')
    })
    it('a top edge gives the line its own place before the target', () => {
      const { onPlace } = render3([blk('b'), blk('c'), blk('d')])
      const target = over('block:d', 'block:c', TOP)
      expect(screen.getByTestId('served-drop-line').dataset.side).toBe('before')
      expect(screen.queryByTestId('served-drop-join')).toBeNull()
      drag('drop', target, TOP, dt())
      expect(onPlace).toHaveBeenCalledWith(blk('d'), { kind: 'rank', before: blk('c') }, [blk('b'), blk('c'), blk('d')])
      expect(status()).toBe('Cogs moved to its own place 2.')
    })
    it('a bottom edge goes before the next line', () => {
      const { onPlace } = render3([blk('b'), blk('c'), blk('d')])
      const target = over('block:b', 'block:c', BOTTOM)
      expect(screen.getByTestId('served-drop-line').dataset.side).toBe('after')
      drag('drop', target, BOTTOM, dt())
      expect(onPlace).toHaveBeenCalledWith(blk('b'), { kind: 'rank', before: blk('d') }, [blk('b'), blk('c'), blk('d')])
      expect(status()).toBe('Gears moved to its own place 2.')
    })
    it('the bottom edge of the last line goes last', () => {
      const { onPlace } = render3([blk('b'), blk('c'), blk('d')])
      over('block:b', 'block:d', BOTTOM, true)
      expect(onPlace).toHaveBeenCalledWith(blk('b'), { kind: 'rank', before: null }, [blk('b'), blk('c'), blk('d')])
    })
    it('a drop that changes nothing shows no mark and calls nothing', () => {
      const { onPlace } = render3([blk('b'), blk('c'), blk('d')])
      over('block:d', 'block:c', BOTTOM, true)
      expect(screen.queryByTestId('served-drop-line')).toBeNull()
      expect(screen.queryByTestId('served-drop-join')).toBeNull()
      expect(onPlace).not.toHaveBeenCalled()
      expect(status()).toBe('')
    })
    it('the divider takes a line last', () => {
      const { onPlace } = render3([blk('b'), blk('c')])
      const divider = screen.getByTestId('served-divider')
      const transfer = dt()
      fireEvent.dragStart(lineOf('block:d'), { dataTransfer: transfer })
      fireEvent.drop(divider, { clientY: 0, dataTransfer: transfer })
      expect(onPlace).toHaveBeenCalledWith(blk('d'), { kind: 'rank', before: null }, [blk('b'), blk('c')])
    })
    it('rings every line of the target group, nothing for the line itself', () => {
      render3([blk('b'), blk('c'), tied('d')])
      over('block:b', 'block:c', MIDDLE)
      expect(screen.getAllByTestId('served-drop-join')).toHaveLength(2)
      fireEvent.dragLeave(lineOf('block:c'))
      expect(screen.queryByTestId('served-drop-join')).toBeNull()
    })
    it('a line dropped on its own middle does nothing', () => {
      const { onPlace } = render3([blk('b'), blk('c'), blk('d')])
      over('block:c', 'block:c', MIDDLE, true)
      expect(screen.queryByTestId('served-drop-join')).toBeNull()
      expect(onPlace).not.toHaveBeenCalled()
    })
  })

  describe('list order badge', () => {
    const takes = (flag: boolean): ServedList => ({
      consumers: [
        three.consumers[0],
        { blockId: 'c', connectionId: 'cc', kind: 'take', share: 0, got: 1, need: 2, ...(flag ? { groupInListOrder: true as const } : {}) },
        { blockId: 'd', connectionId: 'cd', kind: 'take', share: 0, got: 1, need: 2, ...(flag ? { groupInListOrder: true as const } : {}) },
      ],
    })
    it('marks every member of a group served in list order and keeps the percent fields editable', () => {
      render3([blk('b'), blk('c'), tied('d')], { list: takes(true) })
      const badges = screen.getAllByTestId('served-list-order')
      expect(badges).toHaveLength(2)
      expect(badges[0].textContent).toBe('list order')
      expect(badges[0].getAttribute('title')).toBe(LIST_ORDER_HINT)
      expect(field('Belts').disabled).toBe(false)
    })
    it('draws none without the flag', () => {
      render3([blk('b'), blk('c'), tied('d')], { list: takes(false) })
      expect(screen.queryAllByTestId('served-list-order')).toHaveLength(0)
    })
  })
})
