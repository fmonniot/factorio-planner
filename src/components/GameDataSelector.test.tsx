import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { GameDataSelector } from './GameDataSelector'
import { useGameDataStore } from '../store/gameDataStore'

const KEY = 'factorio-planner:game-data-source'

beforeEach(() => {
  localStorage.clear()
  useGameDataStore.setState({
    status: { type: 'empty' },
    importGameDataUrl: vi.fn().mockResolvedValue(undefined),
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('GameDataSelector persisted id', () => {
  it('normalises and rewrites a legacy kompetenz-seablock/ value', () => {
    localStorage.setItem(KEY, 'kompetenz-seablock/')
    render(<GameDataSelector />)
    expect(screen.getByLabelText('Game data source')).toHaveValue('kompetenz-seablock')
    expect(localStorage.getItem(KEY)).toBe('kompetenz-seablock')
  })

  it('still uses the normalised id when the rewrite throws', () => {
    localStorage.setItem(KEY, 'kompetenz-seablock/')
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError')
    })
    expect(() => render(<GameDataSelector />)).not.toThrow()
    expect(screen.getByLabelText('Game data source')).toHaveValue('kompetenz-seablock')
  })
})
