import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Segment, Segmented } from './SegmentedControl'

describe('SegmentedControl', () => {
  it('is a named group of pressed-state buttons', () => {
    const onClick = vi.fn()
    render(
      <Segmented label="Mode">
        <Segment pressed onClick={() => {}}>One</Segment>
        <Segment pressed={false} onClick={onClick}>Two</Segment>
      </Segmented>,
    )
    expect(screen.getByRole('group', { name: 'Mode' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'One' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Two' })).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(screen.getByRole('button', { name: 'Two' }))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('has no group role without a label', () => {
    render(<Segmented><Segment pressed onClick={() => {}}>One</Segment></Segmented>)
    expect(screen.queryByRole('group')).not.toBeInTheDocument()
  })

  it('reports aria-checked for a menu radio', () => {
    render(
      <Segmented size="sm">
        <Segment role="menuitemradio" pressed tabIndex={-1} onClick={() => {}}>/sec</Segment>
        <Segment role="menuitemradio" pressed={false} tabIndex={-1} onClick={() => {}}>/min</Segment>
      </Segmented>,
    )
    const sec = screen.getByRole('menuitemradio', { name: '/sec' })
    expect(sec).toHaveAttribute('aria-checked', 'true')
    expect(sec).not.toHaveAttribute('aria-pressed')
    expect(screen.getByRole('menuitemradio', { name: '/min' })).toHaveAttribute('aria-checked', 'false')
  })
})
