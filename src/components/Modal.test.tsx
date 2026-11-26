import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Modal } from './Modal'
import { isUndoBlockedByOverlay } from './factory/sidePanel/useDismiss'

const panelClass = (className?: string) => {
  render(<Modal onClose={() => {}} className={className}>x</Modal>)
  return screen.getByTestId('modal-panel').className
}

describe('Modal caps', () => {
  it('caps width and height and scrolls vertically by default', () => {
    const c = panelClass('p-4 w-80')
    expect(c).toContain('max-w-[calc(100vw-1rem)]')
    expect(c).toContain('max-h-[calc(100dvh-1rem)]')
    expect(c).toContain('overflow-y-auto')
  })

  it('leaves the width cap to a caller max-w, also behind a variant prefix', () => {
    expect(panelClass('md:max-w-lg')).not.toContain('max-w-[calc')
  })

  it('keeps the vertical scroll when the caller only sets overflow-x', () => {
    expect(panelClass('overflow-x-hidden')).toContain('overflow-y-auto')
  })

  it('leaves the scroll to a caller that sets overflow on both axes or on y', () => {
    expect(panelClass('overflow-hidden')).not.toContain('overflow-y-auto')
  })
})

describe('Modal Escape', () => {
  it('closes on Escape', () => {
    const onClose = vi.fn()
    render(<Modal onClose={onClose}>x</Modal>)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('stays open when a popup already took the key (its listener prevented the default)', () => {
    const onClose = vi.fn()
    render(<Modal onClose={onClose}>x</Modal>)
    const take = (e: KeyboardEvent) => e.preventDefault()
    window.addEventListener('keydown', take, true)
    fireEvent.keyDown(window, { key: 'Escape' })
    window.removeEventListener('keydown', take, true)
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('Modal undoable', () => {
  it('blocks the undo shortcuts by default', () => {
    render(<Modal onClose={() => {}}>x</Modal>)
    expect(isUndoBlockedByOverlay()).toBe(true)
  })

  it('leaves them working when undoable', () => {
    render(<Modal onClose={() => {}} undoable>x</Modal>)
    expect(isUndoBlockedByOverlay()).toBe(false)
  })
})
