import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { RateUnitButton } from './RateUnitButton'
import { useGameDataStore } from '../store/gameDataStore'
import { useUiStore } from '../store/uiStore'
import { makeMenuGameData } from '../test/menuGameData'

beforeEach(() => {
  useUiStore.setState({ rateUnit: 'min' })
  useGameDataStore.setState({ status: { type: 'loaded', gameData: makeMenuGameData(), sourceId: 'test' } })
})

describe('RateUnitButton', () => {
  it('renders nothing without game data', () => {
    useGameDataStore.setState({ status: { type: 'empty' } })
    const { container } = render(<RateUnitButton />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows /min and names the switch to per second', () => {
    render(<RateUnitButton />)
    const button = screen.getByRole('button', { name: 'Rates per minute, switch to per second' })
    expect(button).toHaveTextContent('/min')
  })

  it('flips the rate unit on click and renames itself', () => {
    render(<RateUnitButton />)
    fireEvent.click(screen.getByRole('button', { name: 'Rates per minute, switch to per second' }))
    expect(useUiStore.getState().rateUnit).toBe('sec')
    expect(screen.getByRole('button', { name: 'Rates per second, switch to per minute' })).toHaveTextContent('/sec')
  })
})
