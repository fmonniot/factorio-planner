import { Profiler } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, createEvent, within } from '@testing-library/react'
import { LIST_ORDER_HINT, ServedOrderPopover } from './ServedOrderPopover'
import { makeEmptyBlock, makeEmptySubPlan } from '../../store/blockStore'
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

  it('refuses a toggle the raw list would not make as shown (a stale head above a tied line)', () => {
    // stored [b, X(extra, stale), c~, d~]: shown b, c (promoted to a head), d~: c reads unpressed. The raw c is already
    // tied, so tying it is a raw no-op; the shown c would stay a head, so the press is refused and nothing is stored.
    const { onTie } = render3([blk('b'), extra, tied('c'), tied('d')], { list: { consumers: three.consumers } })
    expect(button('block:c', 'served-tie').getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(button('block:c', 'served-tie'))
    expect(onTie).not.toHaveBeenCalled()
    expect(status()).toBe('Belts could not share with the line above.')
  })

  it('refuses a percentage the raw group would not show (a stale member in it)', () => {
    // stored [b, X(stale), c~, d~]; no shares: the raw group is X, c, d at a third each, c set to 70 leaves X and d at 15,
    // so the shown group {c, d} would read 70 / 15 = 82.4 / 17.6 (or 50 / 50), never the 70 asked for.
    const { onShare } = render3([blk('b'), extra, tied('c'), tied('d')], { list: { consumers: three.consumers } })
    fireEvent.change(field('Belts'), { target: { value: '70' } })
    fireEvent.keyDown(field('Belts'), { key: 'Enter' })
    expect(onShare).not.toHaveBeenCalled()
    expect(status()).toBe('Belts could not change its share.')
  })

  it('still places a line by an edge with a stale entry in the list', () => {
    // stored [b, X(stale), c~, d]: shown b, c, d. d dropped on c's top edge: shown [b, d, c]; the raw list gives
    // [b, X, d, c] (c forced to a head), so the drop lands where meant and is stored.
    const { onPlace } = render3([blk('b'), extra, tied('c'), blk('d')], { list: { consumers: three.consumers } })
    over('block:d', 'block:c', TOP, true)
    expect(onPlace).toHaveBeenCalledWith(blk('d'), { kind: 'rank', before: blk('c') }, [blk('b'), blk('c'), blk('d')])
    expect(status()).toBe('Cogs moved to its own place 2.')
  })

  it('announces an identical message again (a new status node each time)', () => {
    render3([blk('b'), blk('c'), tied('d')])
    const input = field('Belts')
    const invalid = () => { fireEvent.change(input, { target: { value: '0' } }); fireEvent.keyDown(input, { key: 'Enter' }) }
    invalid()
    const first = screen.getByRole('status')
    expect(first.textContent).toBe('Share must be above 0 and below 100.')
    invalid()
    const second = screen.getByRole('status')
    expect(second.textContent).toBe(first.textContent)
    expect(second).not.toBe(first)
  })

  it('does not re-render on a dragover that changes nothing', () => {
    const renders = vi.fn()
    render(
      <Profiler id="p" onRender={renders}>
        <ServedOrderPopover
          itemId="plate" list={three} items={items} blocks={blocks3} rateUnit="min" stored={[blk('b'), blk('c'), blk('d')]}
          onMove={vi.fn()} onReset={vi.fn()} onPlace={vi.fn()} onTie={vi.fn()} onShare={vi.fn()} x={10} y={10} onClose={vi.fn()}
        />
      </Profiler>,
    )
    const target = lineOf('block:c')
    vi.spyOn(target, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 100, 300, 40))
    const transfer = dt()
    fireEvent.dragStart(lineOf('block:d'), { dataTransfer: transfer })
    drag('dragOver', target, MIDDLE, transfer)
    expect(screen.getAllByTestId('served-drop-join')).toHaveLength(1)
    const before = renders.mock.calls.length
    drag('dragOver', target, MIDDLE, transfer)
    drag('dragOver', target, MIDDLE + 1, transfer) // same zone: the same mark
    expect(renders.mock.calls.length).toBe(before)
    drag('dragOver', target, TOP, transfer) // another zone: a new mark
    expect(renders.mock.calls.length).toBeGreaterThan(before)
    expect(screen.getByTestId('served-drop-line')).toBeTruthy()
  })

  it('makes a line draggable again when its focused percent field goes away', () => {
    const props = { itemId: 'plate', list: three, items, blocks: blocks3, rateUnit: 'min' as const, onMove: vi.fn(), onReset: vi.fn(), onPlace: vi.fn(), onTie: vi.fn(), onShare: vi.fn(), x: 10, y: 10, onClose: vi.fn() }
    const { rerender } = render(<ServedOrderPopover {...props} stored={[blk('b'), blk('c'), tied('d')]} />)
    fireEvent.focus(field('Belts'))
    expect(lineOf('block:c').getAttribute('draggable')).toBe('false')
    // the group dissolves (an undo): the field unmounts without a blur
    rerender(<ServedOrderPopover {...props} stored={[blk('b'), blk('c'), blk('d')]} />)
    expect(screen.queryByLabelText('Share of Belts in its group (%)')).toBeNull()
    expect(lineOf('block:c').getAttribute('draggable')).toBe('true')
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
      const { onPlace } = render3([blk('b'), blk('c'), tied('d')])
      over('block:b', 'block:c', MIDDLE)
      expect(screen.getAllByTestId('served-drop-join')).toHaveLength(2)
      fireEvent.dragLeave(lineOf('block:c'))
      expect(screen.queryByTestId('served-drop-join')).toBeNull()
      // dragging a line over its own group: it is already in it, so no ring and no call
      over('block:d', 'block:c', MIDDLE, true)
      expect(screen.queryByTestId('served-drop-join')).toBeNull()
      expect(onPlace).not.toHaveBeenCalled()
    })
    it('a head on its own top edge draws no mark and calls nothing; a tied member there does', () => {
      // [b, c~, d~]: b already has its own rank at that edge (derived: a no-op); c is tied, dropping it there leaves the group.
      const { onPlace } = render3([blk('b'), tied('c'), tied('d')])
      over('block:b', 'block:b', TOP, true)
      expect(screen.queryByTestId('served-drop-line')).toBeNull()
      expect(screen.queryByTestId('served-drop-join')).toBeNull()
      expect(onPlace).not.toHaveBeenCalled()
      expect(status()).toBe('')
      // dropped: the stored result is [b, c, d] (d forced to a head), so Belts has its own place 2
      over('block:c', 'block:c', TOP, true)
      expect(onPlace).toHaveBeenCalledWith(blk('c'), { kind: 'rank', before: blk('c') }, [blk('b'), blk('c'), blk('d')])
      expect(status()).toBe('Belts moved to its own place 2.')
    })
    it('a line dropped on its own middle does nothing', () => {
      const { onPlace } = render3([blk('b'), blk('c'), blk('d')])
      over('block:c', 'block:c', MIDDLE, true)
      expect(screen.queryByTestId('served-drop-join')).toBeNull()
      expect(onPlace).not.toHaveBeenCalled()
    })
  })

  describe('areas', () => {
    const hub = {
      ...makeEmptyBlock('Hub'),
      id: 'h',
      rootPlan: {
        ...makeEmptyBlock('x').rootPlan,
        subPlans: [{ ...makeEmptySubPlan('Logistics'), id: 'L', area: true }, { ...makeEmptySubPlan('Building'), id: 'B', area: true }],
      },
    }
    const blocksH = [{ ...makeEmptyBlock('Science'), id: 's' }, hub]
    const areaList: ServedList = {
      consumers: [
        { blockId: 's', connectionId: 'cs', kind: 'request', share: 30, got: 30 },
        { blockId: 'h', connectionId: 'ch', kind: 'request', share: 12, got: 12, areaId: 'L' },
        { blockId: 'h', connectionId: 'ch', kind: 'request', share: 8, got: 3, areaId: 'B' },
      ],
    }
    const s_ = blk('s')
    const hL: ServedEntry = { kind: 'block', blockId: 'h', areaId: 'L' }
    const hB: ServedEntry = { kind: 'block', blockId: 'h', areaId: 'B' }
    const shown = [s_, hL, hB]
    const KL = 'block:h:area:L'
    const KB = 'block:h:area:B'
    const renderH = (stored?: ServedEntry[], over2: Partial<React.ComponentProps<typeof ServedOrderPopover>> = {}) =>
      renderWith({ list: areaList, blocks: blocksH, stored, ...over2 })
    const HINT = 'Lines of one place that are not in a bracket (a block\'s areas) are served in table order. Move or share one to rank them apart.'

    it('draws one line per area with its figures', () => {
      renderH()
      expect(screen.getAllByTestId('served-line-name').map(n => n.textContent)).toEqual(['Science', 'Hub / Logistics', 'Hub / Building'])
      expect(ranked().map(l => l.dataset.rank)).toEqual(['1', '2', '3'])
      expect(ranked().map(l => l.dataset.areaId)).toEqual([undefined, 'L', 'B'])
      const b = lineOf(KB)
      expect(b.textContent).toContain('asked 8.0')
      expect(b.textContent).toContain('got 3.0')
      expect(within(b).getByTestId('served-short').textContent).toContain('short 5.0')
      expect(screen.getAllByTestId('served-short')).toHaveLength(1)
      expect(screen.queryByTestId('served-share')).toBeNull()
      expect(screen.queryByTestId('served-divider')).toBeNull()
    })

    it('renders a single block with two area lines and no extra', () => {
      renderH(undefined, { list: { consumers: areaList.consumers.slice(1) } })
      expect(screen.getAllByTestId('served-line')).toHaveLength(2)
    })

    it('a middle drop joins the other area, writing through the shown order', () => {
      const { onPlace } = renderH()
      over(KB, KL, MIDDLE, true)
      expect(onPlace).toHaveBeenCalledWith(hB, { kind: 'join', target: hL }, shown)
      expect(status()).toBe('Hub / Building now shares place 2 with Hub / Logistics.')
    })

    it('an edge drop gives the area its own place', () => {
      const { onPlace } = renderH()
      over(KB, KL, TOP, true)
      expect(onPlace).toHaveBeenCalledWith(hB, { kind: 'rank', before: hL }, shown)
      expect(status()).toBe('Hub / Building moved to its own place 2.')
    })

    it('moves and shares an area with the buttons', () => {
      const { onMove, onTie } = renderH()
      fireEvent.click(button(KB, 'served-move-up'))
      expect(onMove).toHaveBeenCalledWith(hB, 1, shown)
      fireEvent.click(button(KB, 'served-tie'))
      expect(onTie).toHaveBeenCalledWith(hB, true, shown)
      expect(status()).toBe('Hub / Building now shares place 2 with Hub / Logistics.')
    })

    it('draws a stored group of areas with a field each', () => {
      const { onShare } = renderH([s_, hL, { ...hB, tied: true }])
      expect(field('Hub / Logistics').value).toBe('50')
      expect(field('Hub / Building').value).toBe('50')
      fireEvent.change(field('Hub / Logistics'), { target: { value: '70' } })
      fireEvent.keyDown(field('Hub / Logistics'), { key: 'Enter' })
      expect(onShare).toHaveBeenCalledWith(hL, 70, shown)
      expect(status()).toBe('Hub / Logistics now has 70 percent of place 2.')
      expect(field('Hub / Logistics').value).toBe('50')
    })

    it('draws a plain solo entry as one place with a hint, and writes through the expanded list', () => {
      const { onMove, onTie } = renderH([s_, blk('h')])
      expect(ranked().map(l => l.dataset.rank)).toEqual(['1', '2', '2'])
      expect(screen.getAllByTestId('served-rank').map(r => r.textContent)).toEqual(['1', '2', ''])
      expect(ranked().map(l => l.dataset.spanSize)).toEqual([undefined, '2', '2'])
      expect(screen.queryByTestId('served-share')).toBeNull()
      expect(screen.queryByTestId('served-share-entry')).toBeNull()
      expect(button(KB, 'served-tie').getAttribute('aria-pressed')).toBe('false')
      expect(screen.getByText(HINT)).toBeTruthy()
      fireEvent.click(button(KB, 'served-move-up'))
      expect(onMove).toHaveBeenCalledWith(hB, 1, shown)
      fireEvent.click(button(KB, 'served-tie'))
      expect(onTie).toHaveBeenCalledWith(hB, true, shown)
      expect(status()).toBe('Hub / Building now shares place 2 with Hub / Logistics.')
    })

    it('has no hint without a span', () => {
      renderH([s_, hL, hB])
      expect(screen.queryByText(HINT)).toBeNull()
    })

    it('draws a plain entry in a group: read-only percent, tied continuation lines', () => {
      const { onTie } = renderH([s_, { ...blk('h'), tied: true }])
      expect(field('Science').value).toBe('50')
      expect(within(lineOf(KL)).getByTestId('served-share-entry').textContent).toBe('50 %')
      expect(within(lineOf(KB)).queryByTestId('served-share-entry')).toBeNull()
      expect(within(lineOf(KL)).queryByTestId('served-share')).toBeNull()
      expect(ranked().map(l => l.dataset.rank)).toEqual(['1', '1', '1'])
      expect(button(KL, 'served-tie').getAttribute('aria-pressed')).toBe('true')
      expect(button(KB, 'served-tie').getAttribute('aria-pressed')).toBe('true')
      expect(ranked().map(l => l.dataset.groupPosition)).toEqual(['first', 'middle', 'last'])
      fireEvent.click(button(KB, 'served-tie'))
      expect(onTie).toHaveBeenLastCalledWith(hB, false, shown)
      expect(status()).toBe('Hub / Building left its group and has its own place 2.')
      fireEvent.click(button(KL, 'served-tie'))
      expect(onTie).toHaveBeenLastCalledWith(hL, false, shown)
      expect(status()).toBe('Hub / Logistics and the 1 line under it left the group; they share place 2.')
    })

    it('skips a stale area entry and still computes against the raw list', () => {
      const { onMove } = renderH([{ kind: 'block', blockId: 'h', areaId: 'ghost' }, s_, hL, hB])
      expect(ranked().map(l => l.dataset.rank)).toEqual(['1', '2', '3'])
      expect(ranked().map(l => l.dataset.lineKey)).toEqual(['block:s', KL, KB])
      fireEvent.click(button(KL, 'served-move-up'))
      expect(onMove).toHaveBeenCalledWith(hL, 1, shown)
    })

    it('offers Add to list on an area the list does not rank', () => {
      const { onMove } = renderH([s_, hL])
      const b = lineOf(KB)
      expect(b.dataset.ranked).toBe('false')
      fireEvent.click(within(b).getByTestId('served-add'))
      expect(onMove).toHaveBeenCalledWith(hB, 2, [s_, hL])
    })

    it('marks the area lines of a take group served in list order', () => {
      const take = (a: string) => ({ blockId: 'h', connectionId: 'ch', kind: 'take' as const, share: 0, got: 1, need: 2, groupInListOrder: true as const, areaId: a })
      renderH([s_, hL, { ...hB, tied: true }], { list: { consumers: [areaList.consumers[0], take('L'), take('B')] } })
      expect(screen.getAllByTestId('served-list-order')).toHaveLength(2)
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
