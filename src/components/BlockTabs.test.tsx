import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { BlockTabs } from './BlockTabs'
import { useBlockStore, makeEmptyBlock } from '../store/blockStore'
import { useGameDataStore } from '../store/gameDataStore'
import type { GameData } from '../data/types'

beforeEach(() => {
  const block = makeEmptyBlock('Test')
  useBlockStore.setState({ blocks: [block], activeBlockId: block.id, history: {} })
  useGameDataStore.setState({ status: { type: 'empty' } })
})

describe('BlockTabs editability', () => {
  it.each([
    ['empty', { type: 'empty' as const }],
    ['loading', { type: 'loading' as const }],
    ['error', { type: 'error' as const, message: 'boom' }],
  ])('is disabled while game data is %s', (_name, status) => {
    useGameDataStore.setState({ status })
    render(<BlockTabs />)
    expect(screen.getByTitle('Add block'), 'add button').toBeDisabled()
    expect(screen.getByTitle('Test'), 'block tab').toBeDisabled()
  })

  it('is enabled once game data is loaded', () => {
    useGameDataStore.setState({
      status: { type: 'loaded', gameData: { items: {} } as unknown as GameData, sourceId: 'test' },
    })
    render(<BlockTabs />)
    expect(screen.getByTitle('Add block')).toBeEnabled()
    expect(screen.getByTitle('Test')).toBeEnabled()
  })
})

describe('BlockTabs context menu', () => {
  it('duplicates a block from the right-click menu', () => {
    useGameDataStore.setState({
      status: { type: 'loaded', gameData: { items: {} } as unknown as GameData, sourceId: 'test' },
    })
    render(<BlockTabs />)
    fireEvent.contextMenu(screen.getByTitle('Test'))
    expect(screen.getByRole('menuitem', { name: 'Rename' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Duplicate' }))
    expect(screen.getByTitle('Test')).toBeInTheDocument()
    expect(screen.getByTitle('Test (copy)')).toBeInTheDocument()
  })
})
