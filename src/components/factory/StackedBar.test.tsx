import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { StackedBar } from './StackedBar'
import type { BarSegment } from './StackedBar'
import { segmentLook } from './segmentLooks'

const seg = (key: string, patch: Partial<BarSegment> = {}): BarSegment => ({
  key,
  look: segmentLook('export', '#3b82f6'),
  weight: 1,
  name: key,
  tipName: key,
  testId: 'seg',
  ...patch,
})

describe('StackedBar', () => {
  it('fades only the fill of a traced-out segment, never its tooltip or text', () => {
    render(<StackedBar segments={[seg('a', { faded: true, tipAmount: '5', detail: 'More' }), seg('b')]} />)
    const [a, b] = screen.getAllByTestId('seg')
    const fills = screen.getAllByTestId('summary-segment-fill')
    expect(fills[0].style.opacity).toBe('0.5')
    expect(fills[1].style.opacity).toBe('')
    // Opacity applies to the whole subtree of an element: none above the tooltip may carry it.
    for (let el: HTMLElement | null = a.querySelector('[data-testid="summary-segment-tip"]'); el && el !== a.parentElement; el = el.parentElement) {
      expect(el.style.opacity, el.tagName).toBe('')
    }
    expect(b.style.opacity).toBe('')
  })

  it('exposes the second line of the tooltip as the description, not as part of the name', () => {
    render(<StackedBar segments={[seg('a', { tipAmount: '5.0', note: '2 items', detail: 'Limited: only offers 3' }), seg('b')]} />)
    const [a, b] = screen.getAllByTestId('seg')
    expect(a).toHaveAccessibleName('a · 5.0 · 2 items')
    expect(a).toHaveAccessibleDescription('Limited: only offers 3')
    expect(b).not.toHaveAttribute('aria-describedby')
  })

  it('on touch, the first tap opens the tooltip without the action, the second runs it', () => {
    const onClick = vi.fn()
    render(<StackedBar segments={[seg('a', { onClick, tipAmount: '5' }), seg('b', { onClick: vi.fn() })]} />)
    const [a, b] = screen.getAllByTestId('seg')
    const tipOf = (el: HTMLElement) => el.querySelector('[aria-hidden="true"]:not([data-testid])') as HTMLElement
    expect(tipOf(a).className).toContain('hidden')
    fireEvent.pointerDown(a, { pointerType: 'touch' })
    fireEvent.click(a)
    expect(onClick).not.toHaveBeenCalled()
    expect(tipOf(a).className).not.toContain('hidden')
    // A tap on another segment moves the tooltip.
    fireEvent.pointerDown(b, { pointerType: 'touch' })
    expect(tipOf(a).className).toContain('hidden')
    fireEvent.click(b)
    expect(tipOf(b).className).not.toContain('hidden')
    fireEvent.pointerDown(a, { pointerType: 'touch' })
    fireEvent.click(a)
    fireEvent.pointerDown(a, { pointerType: 'touch' })
    fireEvent.click(a)
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(tipOf(a).className).toContain('hidden')
  })

  it('a mouse click or the keyboard runs the action at once, and Escape closes a tapped tooltip', () => {
    const onClick = vi.fn()
    render(<StackedBar segments={[seg('a', { onClick })]} />)
    const [a] = screen.getAllByTestId('seg')
    fireEvent.pointerDown(a, { pointerType: 'mouse' })
    fireEvent.click(a)
    expect(onClick).toHaveBeenCalledTimes(1)
    fireEvent.pointerDown(a, { pointerType: 'touch' })
    fireEvent.keyDown(a, { key: 'Enter' })
    fireEvent.click(a)
    expect(onClick).toHaveBeenCalledTimes(2)
    fireEvent.pointerDown(a, { pointerType: 'touch' })
    fireEvent.click(a)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(a.querySelector('[aria-hidden="true"]:not([data-testid])')!.className).toContain('hidden')
  })
})
