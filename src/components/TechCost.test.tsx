import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TechCost } from './TechCost'
import type { ComponentProps } from 'react'

type Props = ComponentProps<typeof TechCost>

const lookup = (): Props['lookup'] => ({
  items: {
    'red-pack': { id: 'red-pack', name: 'Red Pack', iconPath: 'icons/red.png' },
    'blue-pack': { id: 'blue-pack', name: 'Blue Pack', iconPath: '' },
  },
  machines: {},
  beacons: {},
} as unknown as Props['lookup'])

const cost = () => ({ count: 10, time: 5, ingredients: [{ itemId: 'red-pack', amount: 1 }, { itemId: 'blue-pack', amount: 2 }] })

describe('TechCost', () => {
  it('gives a pack icon its alt and an instant tooltip, never a title', () => {
    render(<TechCost cost={cost()} lookup={lookup()} />)
    const icon = screen.getByAltText('Red Pack ×1')
    expect(icon).toHaveAttribute('data-tip', 'Red Pack ×1')
    expect(icon).not.toHaveAttribute('title')
  })

  it('names the letter fallback of an icon-less pack as an image with the tooltip', () => {
    render(<TechCost cost={cost()} lookup={lookup()} />)
    const fallback = screen.getByRole('img', { name: 'Blue Pack ×2' })
    expect(fallback).toHaveAttribute('data-tip', '')
    expect(fallback).not.toHaveAttribute('title')
  })

  it('puts the full trigger sentence in a tooltip only when asked to', () => {
    const trigger = { type: 'craft-item', item: 'red-pack', count: 5 } as unknown as Props['trigger']
    const { unmount } = render(<TechCost cost={null} trigger={trigger} lookup={lookup()} tooltip />)
    expect(screen.getByTestId('tech-cost').getAttribute('data-tip'), 'tooltip on').toBeTruthy()
    expect(screen.getByTestId('tech-cost')).not.toHaveAttribute('title')
    unmount()
    render(<TechCost cost={null} trigger={trigger} lookup={lookup()} />)
    expect(screen.getByTestId('tech-cost')).not.toHaveAttribute('data-tip')
  })
})
