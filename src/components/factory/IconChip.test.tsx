import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { IconChip, MoreBadge, PinBadge, SourcingBadge } from './IconChip'

describe('IconChip', () => {
  it('draws the quantity in the bottom-right corner and the badges in the top-right corner', () => {
    render(<IconChip alt="Gear" quantity="12.5" badges={<PinBadge />} />)
    expect(screen.getByText('12.5')).toHaveClass('right-0', 'bottom-0')
    expect(screen.getByTestId('chip-pin').parentElement).toHaveClass('-top-1', '-right-1')
  })

  it('is a span without onClick and a button with it', () => {
    const { rerender } = render(<IconChip alt="Gear" title="Gear" />)
    expect(screen.queryByRole('button')).toBeNull()
    const onClick = vi.fn()
    rerender(<IconChip alt="Gear" title="Gear" onClick={onClick} />)
    fireEvent.click(screen.getByRole('button'))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('draws items and entities at 32px (a 38px slot with the 6px gap)', () => {
    const { rerender, container } = render(<IconChip alt="Gear" />)
    expect(container.querySelector('.w-8.h-8')).not.toBeNull()
    expect(container.querySelector('.w-7')).toBeNull()
    rerender(<IconChip alt="Gear" size="entity" />)
    expect(container.querySelector('.w-8.h-8')).not.toBeNull()
  })

  it('draws an item quantity at 11px outlined in four directions, an entity quantity at 9px', () => {
    const { rerender } = render(<IconChip alt="Gear" quantity="12k" />)
    const q = screen.getByText('12k')
    expect(q).toHaveClass('text-[11px]', 'font-bold', 'font-mono', 'right-0', 'bottom-0')
    expect(q.style.textShadow).toBe('-1px 0 #000, 1px 0 #000, 0 -1px #000, 0 1px #000')
    rerender(<IconChip alt="Gear" size="entity" quantity="3" />)
    expect(screen.getByText('3')).toHaveClass('text-[9px]')
  })

  it('puts a faint plate behind an item chip and none behind an entity chip', () => {
    const { rerender } = render(<IconChip alt="Gear" data-testid="chip" />)
    expect(screen.getByTestId('chip')).toHaveClass('rounded-[5px]', 'bg-[rgba(148,163,184,0.09)]', 'shadow-[inset_0_0_0_1px_rgba(148,163,184,0.10)]')
    rerender(<IconChip alt="Gear" size="entity" data-testid="chip" />)
    expect(screen.getByTestId('chip').className).not.toContain('rgba(148,163,184')
  })

  it('draws a quiet placeholder in gray-700 / gray-600 that the row and the chip brighten, and a plain one as before', () => {
    const { container, rerender } = render(<IconChip alt="Add" size="entity" empty quiet quantity="0/2" />)
    const box = container.querySelector('.border-dashed')!
    expect(box).toHaveClass('border-gray-700', 'group-hover/row:border-gray-600', 'group-focus-within/row:border-gray-600', 'group-data-[selected=true]/row:border-gray-600', 'group-hover/chip:border-gray-400!', 'group-focus-visible/chip:border-gray-400!')
    const chip = container.firstElementChild!
    expect(chip).toHaveClass('text-gray-600', 'group-hover/row:text-gray-400', 'hover:text-gray-200!', 'focus-visible:text-gray-200!')
    expect(screen.getByText('0/2')).not.toHaveClass('text-gray-400')
    rerender(<IconChip alt="Add" size="entity" empty quantity="0/2" />)
    expect(container.querySelector('.border-dashed')).toHaveClass('border-gray-600', 'text-gray-500')
    expect(screen.getByText('0/2')).toHaveClass('text-gray-400')
  })

  it('draws an empty slot as a dashed plus with its quantity', () => {
    const { container } = render(<IconChip alt="Add" empty quantity="0/4" />)
    expect(container.querySelector('.border-dashed')).toHaveTextContent('+')
    expect(screen.getByText('0/4')).toBeInTheDocument()
  })

  it('never clips its badges (no overflow-hidden on the chip itself)', () => {
    render(<IconChip alt="Gear" badges={<MoreBadge count={2} />} data-testid="chip" />)
    expect(screen.getByTestId('chip')).not.toHaveClass('overflow-hidden')
    expect(screen.getByTestId('chip-more')).toHaveTextContent('+2')
  })

  it('badges: sourcing letters', () => {
    render(<SourcingBadge letter="B" mode="byproducts-first" />)
    expect(screen.getByTestId('item-tile-sourcing')).toHaveTextContent('B')
  })
})
