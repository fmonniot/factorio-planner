import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { TooltipLayer, tipText } from './TooltipLayer'
import { expectTip, tipOf } from '../test/byTip'

function over(el: Element, pointerType = 'mouse') {
  const e = new Event('pointerover', { bubbles: true })
  Object.defineProperty(e, 'pointerType', { value: pointerType })
  fireEvent(el, e)
}

function setup(props: Record<string, string> = { 'aria-label': 'Iron Plate — 3/s', 'data-tip': '' }) {
  render(<><button data-testid="chip" {...props}>x</button><div data-testid="away">y</div><TooltipLayer /></>)
  return screen.getByTestId('chip')
}

describe('TooltipLayer', () => {
  it('shows the aria-label on pointer over, instantly, and hides the tooltip from assistive technology', () => {
    over(setup())
    const tip = screen.getByTestId('tooltip')
    expect(tip).toHaveTextContent('Iron Plate — 3/s')
    expect(tip).toHaveAttribute('aria-hidden', 'true')
    expect(tip.parentElement).toBe(document.body)
  })

  it('ignores touch pointers', () => {
    over(setup(), 'touch')
    expect(screen.queryByTestId('tooltip')).toBeNull()
  })

  it('closes when the pointer moves onto something without a tip', () => {
    const chip = setup()
    over(chip)
    over(screen.getByTestId('away'))
    expect(screen.queryByTestId('tooltip')).toBeNull()
  })

  it('lets data-tip override the aria-label', () => {
    const chip = setup({ 'aria-label': 'Slot, 3 per minute', 'data-tip': 'Iron Plate' })
    expect(tipText(chip)).toBe('Iron Plate')
    over(chip)
    expect(screen.getByTestId('tooltip')).toHaveTextContent('Iron Plate')
  })

  it('keeps a newline in the text as a line break', () => {
    over(setup({ 'data-tip': 'a\nb' }))
    const tip = screen.getByTestId('tooltip')
    expect(tip.textContent).toBe('a\nb')
    expect(tip.className).toContain('whitespace-pre-line')
  })

  it('follows the aria-label while open', async () => {
    const chip = setup()
    over(chip)
    await act(async () => { chip.setAttribute('aria-label', 'Iron Plate — 4/s'); await Promise.resolve() })
    expect(await screen.findByText('Iron Plate — 4/s')).toBeInTheDocument()
  })

  it('closes when the anchor is removed', async () => {
    setup()
    const chip = document.createElement('button')
    chip.setAttribute('data-tip', 'Plain')
    document.body.appendChild(chip)
    over(chip)
    expect(screen.getByTestId('tooltip')).toBeInTheDocument()
    await act(async () => { chip.remove(); await Promise.resolve() })
    expect(screen.queryByTestId('tooltip')).toBeNull()
  })

  it('closes on Escape and on press', () => {
    const chip = setup()
    over(chip)
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(screen.queryByTestId('tooltip')).toBeNull()
    over(chip)
    fireEvent.pointerDown(chip)
    expect(screen.queryByTestId('tooltip')).toBeNull()
  })

  it('closes when a touch pointer comes over, after a mouse opened it', () => {
    const chip = setup()
    over(chip)
    over(chip, 'touch')
    expect(screen.queryByTestId('tooltip')).toBeNull()
  })

  it('stays placed when the pointer crosses from one child of the chip to another', () => {
    render(<><button data-testid="chip" aria-label="Iron Plate — 3/s" data-tip=""><img alt="" data-testid="icon" /><span data-testid="qty">3</span></button><TooltipLayer /></>)
    over(screen.getByTestId('icon'))
    const tip = screen.getByTestId('tooltip')
    expect(tip.style.visibility).not.toBe('hidden')
    over(screen.getByTestId('qty'))
    expect(screen.getByTestId('tooltip')).toBe(tip)
    expect(screen.getByTestId('tooltip').style.visibility).not.toBe('hidden')
  })

  it('closes when an ancestor of the anchor is removed', async () => {
    setup()
    const wrap = document.createElement('div')
    const mid = document.createElement('div')
    const chip = document.createElement('button')
    chip.setAttribute('data-tip', 'Plain')
    mid.appendChild(chip)
    wrap.appendChild(mid)
    document.body.appendChild(wrap)
    over(chip)
    expect(screen.getByTestId('tooltip')).toBeInTheDocument()
    await act(async () => { wrap.remove(); await Promise.resolve() })
    expect(screen.queryByTestId('tooltip')).toBeNull()
  })

  describe('keyboard focus', () => {
    afterEach(() => { vi.restoreAllMocks() })
    const focusIn = (chip: HTMLElement, visible: boolean) => {
      const real = chip.matches.bind(chip)
      vi.spyOn(chip, 'matches').mockImplementation(sel => (sel === ':focus-visible' ? visible : real(sel)))
      fireEvent.focusIn(chip)
    }

    it('opens on :focus-visible', () => {
      focusIn(setup(), true)
      expect(screen.getByTestId('tooltip')).toHaveTextContent('Iron Plate — 3/s')
    })

    it('does not open on focus that is not :focus-visible (a mouse click)', () => {
      focusIn(setup(), false)
      expect(screen.queryByTestId('tooltip')).toBeNull()
    })
  })

  describe('closes on', () => {
    const opened = () => { over(setup()); expect(screen.getByTestId('tooltip')).toBeInTheDocument() }
    const gone = () => expect(screen.queryByTestId('tooltip')).toBeNull()

    it('focusout', () => { opened(); fireEvent.focusOut(screen.getByTestId('chip')); gone() })
    it('window blur', () => { opened(); fireEvent.blur(window); gone() })
    it('resize', () => { opened(); fireEvent(window, new Event('resize')); gone() })
    it('a scroll of any container', () => { opened(); fireEvent.scroll(screen.getByTestId('away')); gone() })
    it('dragstart', () => { opened(); fireEvent.dragStart(screen.getByTestId('chip')); gone() })
    it('contextmenu', () => { opened(); fireEvent.contextMenu(screen.getByTestId('chip')); gone() })
    it('pointerout to nowhere', () => { opened(); fireEvent.pointerOut(screen.getByTestId('chip'), { relatedTarget: null }); gone() })
  })

  it('tipOf reads the closest anchor, or nothing', () => {
    render(<div data-tip="Outer"><button data-testid="in">x</button></div>)
    expect(tipOf(screen.getByTestId('in'))).toBe('Outer')
    render(<button data-testid="bare">x</button>)
    expect(tipOf(screen.getByTestId('bare'))).toBe('')
  })

  it('expectTip checks the text, the description and the absence of a title', () => {
    render(<button data-testid="b" data-tip="Why" aria-description="Why">x</button>)
    expectTip(screen.getByTestId('b'), 'Why')
  })

  it('expectTip can skip the description', () => {
    render(<button data-testid="b" aria-label="Name" data-tip="">x</button>)
    expectTip(screen.getByTestId('b'), 'Name', { describe: false })
  })
})
