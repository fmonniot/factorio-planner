import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { FoldedList } from './FoldedList'

const list = (n: number, cap?: number) =>
  render(
    <FoldedList
      items={Array.from({ length: n }, (_, i) => `item ${i}`)}
      cap={cap}
      testId="things"
      renderItem={t => <li key={t}>{t}</li>}
    />,
  )

describe('FoldedList', () => {
  it('shows everything without a toggle up to the cap', () => {
    list(6)
    expect(screen.getAllByRole('listitem')).toHaveLength(6)
    expect(screen.queryByTestId('things-toggle')).toBeNull()
  })

  it('folds past the cap and toggles', () => {
    list(7)
    expect(screen.getAllByRole('listitem')).toHaveLength(6)
    const toggle = screen.getByTestId('things-toggle')
    expect(toggle.textContent).toBe('Show all 7')
    fireEvent.click(toggle)
    expect(screen.getAllByRole('listitem')).toHaveLength(7)
    expect(toggle.textContent).toBe('Show fewer')
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(toggle)
    expect(screen.getAllByRole('listitem')).toHaveLength(6)
  })

  it('takes another cap', () => {
    list(5, 4)
    expect(screen.getAllByRole('listitem')).toHaveLength(4)
    expect(screen.getByTestId('things-toggle').textContent).toBe('Show all 5')
  })
})
