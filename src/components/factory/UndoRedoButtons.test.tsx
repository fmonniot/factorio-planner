import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { UndoRedoButtons } from './UndoRedoButtons'
import { useBlockStore, makeEmptyBlock } from '../../store/blockStore'

const undoButton = () => screen.getByRole('button', { name: /^Undo/ })
const redoButton = () => screen.getByRole('button', { name: /^Redo/ })
const store = () => useBlockStore.getState()

describe('UndoRedoButtons', () => {
  let activeId: string
  let sourceId: string
  let otherId: string

  beforeEach(() => {
    const active = makeEmptyBlock('Consumer')
    const source = makeEmptyBlock('Source')
    const other = makeEmptyBlock('Gears')
    activeId = active.id
    sourceId = source.id
    otherId = other.id
    useBlockStore.setState({ blocks: [active, source, other], activeBlockId: active.id, history: {} })
  })

  afterEach(() => vi.restoreAllMocks())

  it('starts with both buttons disabled', () => {
    render(<UndoRedoButtons />)
    expect(undoButton()).toBeDisabled()
    expect(redoButton()).toBeDisabled()
  })

  it('enables Undo after an edit, and Redo after clicking it', () => {
    render(<UndoRedoButtons />)
    act(() => store().addProduct({ id: 'p1', itemId: 'plate', extraRate: 60 }))
    expect(undoButton()).toBeEnabled()
    expect(redoButton()).toBeDisabled()
    fireEvent.click(undoButton())
    expect(store().blocks.find(b => b.id === activeId)!.products).toEqual([])
    expect(undoButton()).toBeDisabled()
    expect(redoButton()).toBeEnabled()
  })

  it('names the shortcut for the platform', () => {
    const platform = vi.spyOn(navigator, 'platform', 'get')
    platform.mockReturnValue('Win32')
    const { unmount } = render(<UndoRedoButtons />)
    expect(undoButton()).toHaveAccessibleName('Undo (Ctrl+Z)')
    expect(redoButton()).toHaveAccessibleName('Redo (Ctrl+Y)')
    unmount()
    platform.mockReturnValue('MacIntel')
    render(<UndoRedoButtons />)
    expect(undoButton()).toHaveAccessibleName('Undo (Cmd+Z)')
    expect(redoButton()).toHaveAccessibleName('Redo (Cmd+Shift+Z)')
  })

  it('names the block of an edit made elsewhere, until the undo switches to it', () => {
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('Win32')
    render(<UndoRedoButtons />)
    act(() => store().addInputConnection('plate', sourceId, otherId))
    expect(undoButton()).toHaveAccessibleName('Undo in Gears (Ctrl+Z)')
    fireEvent.click(undoButton())
    expect(store().activeBlockId).toBe(otherId)
    expect(redoButton()).toHaveAccessibleName('Redo (Ctrl+Y)')
    expect(undoButton()).toBeDisabled()
    expect(undoButton()).toHaveAccessibleName('Undo (Ctrl+Z)')
  })
})
