import { describe, it, expect, beforeEach } from 'vitest'
import { render, renderHook, fireEvent } from '@testing-library/react'
import { useUndoShortcuts, undoShortcutOf } from './useUndoShortcuts'
import { Modal } from '../Modal'
import { ConnectionLimitEditor } from './ConnectionLimitEditor'
import { useOverlayOpen } from './sidePanel/useDismiss'
import { useBlockStore, makeEmptyBlock } from '../../store/blockStore'

const store = () => useBlockStore.getState()
const products = () => store().blocks[0].products

function Overlay() {
  useOverlayOpen()
  return null
}

/** Fires the key on `target` and returns whether the event was cancelled (handled). */
function press(init: KeyboardEventInit, target: Element = document.body): boolean {
  return !fireEvent.keyDown(target, init)
}

const key = (init: KeyboardEventInit) => new KeyboardEvent('keydown', init)

describe('undoShortcutOf', () => {
  it('maps Ctrl/Cmd+Z to undo and Shift+Ctrl/Cmd+Z and Ctrl+Y to redo', () => {
    expect(undoShortcutOf(key({ key: 'z', ctrlKey: true }))).toBe('undo')
    expect(undoShortcutOf(key({ key: 'z', metaKey: true }))).toBe('undo')
    expect(undoShortcutOf(key({ key: 'Z', ctrlKey: true, shiftKey: true }))).toBe('redo')
    expect(undoShortcutOf(key({ key: 'Z', metaKey: true, shiftKey: true }))).toBe('redo')
    expect(undoShortcutOf(key({ key: 'y', ctrlKey: true }))).toBe('redo')
  })

  it('ignores Cmd+Y, Alt, Shift+Ctrl+Y and plain keys', () => {
    expect(undoShortcutOf(key({ key: 'y', metaKey: true }))).toBeNull()
    expect(undoShortcutOf(key({ key: 'z', ctrlKey: true, altKey: true }))).toBeNull()
    expect(undoShortcutOf(key({ key: 'y', ctrlKey: true, shiftKey: true }))).toBeNull()
    expect(undoShortcutOf(key({ key: 'z' }))).toBeNull()
  })
})

describe('useUndoShortcuts', () => {
  beforeEach(() => {
    useBlockStore.setState({ blocks: [makeEmptyBlock('A')], history: {} })
    useBlockStore.setState(s => ({ activeBlockId: s.blocks[0].id }))
    store().addProduct({ id: 'p1', itemId: 'plate', extraRate: 60 })
  })

  it('undoes on Ctrl+Z and Meta+Z, and redoes on Ctrl+Shift+Z, Meta+Shift+Z and Ctrl+Y', () => {
    renderHook(() => useUndoShortcuts())
    expect(press({ key: 'z', ctrlKey: true }), 'handled').toBe(true)
    expect(products()).toEqual([])
    expect(press({ key: 'z', ctrlKey: true, shiftKey: true })).toBe(true)
    expect(products()).toHaveLength(1)
    press({ key: 'z', metaKey: true })
    expect(products()).toEqual([])
    press({ key: 'z', metaKey: true, shiftKey: true })
    expect(products()).toHaveLength(1)
    press({ key: 'z', ctrlKey: true })
    press({ key: 'y', ctrlKey: true })
    expect(products()).toHaveLength(1)
  })

  it('does not bind Meta+Y', () => {
    renderHook(() => useUndoShortcuts())
    store().undo()
    expect(press({ key: 'y', metaKey: true })).toBe(false)
    expect(products()).toEqual([])
  })

  it('leaves the event alone when there is nothing to do', () => {
    renderHook(() => useUndoShortcuts())
    expect(press({ key: 'z', ctrlKey: true, shiftKey: true }), 'nothing to redo').toBe(false)
    store().undo()
    expect(press({ key: 'z', ctrlKey: true }), 'nothing to undo').toBe(false)
  })

  it('ignores text fields, textareas and contentEditable', () => {
    renderHook(() => useUndoShortcuts())
    for (const tag of ['input', 'textarea']) {
      const el = document.body.appendChild(document.createElement(tag))
      expect(press({ key: 'z', ctrlKey: true, bubbles: true }, el), tag).toBe(false)
      el.remove()
    }
    const div = document.body.appendChild(document.createElement('div'))
    // happy-dom does not derive isContentEditable from the attribute
    Object.defineProperty(div, 'isContentEditable', { value: true })
    expect(press({ key: 'z', ctrlKey: true, bubbles: true }, div)).toBe(false)
    div.remove()
    expect(products()).toHaveLength(1)
  })

  it('ignores an event that was already handled', () => {
    renderHook(() => useUndoShortcuts())
    const take = (e: KeyboardEvent) => e.preventDefault()
    document.body.addEventListener('keydown', take)
    press({ key: 'z', ctrlKey: true, bubbles: true, cancelable: true })
    document.body.removeEventListener('keydown', take)
    expect(products()).toHaveLength(1)
  })

  it('is ignored while an overlay is open', () => {
    renderHook(() => useUndoShortcuts())
    const { unmount } = render(<Overlay />)
    press({ key: 'z', ctrlKey: true })
    expect(products()).toHaveLength(1)
    unmount()
    press({ key: 'z', ctrlKey: true })
    expect(products()).toEqual([])
  })

  it('works inside an undoable modal, not inside a plain one', () => {
    renderHook(() => useUndoShortcuts())
    const plain = render(<Modal onClose={() => {}}>x</Modal>)
    press({ key: 'z', ctrlKey: true })
    expect(products()).toHaveLength(1)
    plain.unmount()
    const undoable = render(<Modal onClose={() => {}} undoable>x</Modal>)
    press({ key: 'z', ctrlKey: true })
    expect(products()).toEqual([])
    undoable.unmount()
  })

  it('is blocked by another overlay opened over an undoable modal', () => {
    renderHook(() => useUndoShortcuts())
    render(<><Modal onClose={() => {}} undoable>x</Modal><Overlay /></>)
    press({ key: 'z', ctrlKey: true })
    expect(products()).toHaveLength(1)
  })

  it('works from a focused checkbox, radio, range, button input or select, not from text fields or a textarea', () => {
    renderHook(() => useUndoShortcuts())
    const handled = (tag: string, type?: string) => {
      const el = document.createElement(tag)
      if (type) (el as HTMLInputElement).type = type
      document.body.appendChild(el)
      const result = press({ key: 'z', ctrlKey: true }, el)
      el.remove()
      if (result) store().redo() // back to one product for the next probe
      return result
    }
    for (const type of ['checkbox', 'radio', 'range', 'button', 'color']) expect(handled('input', type), type).toBe(true)
    expect(handled('select'), 'select').toBe(true)
    for (const type of ['text', 'number', 'search', 'password']) expect(handled('input', type), type).toBe(false)
    expect(handled('input'), 'no type').toBe(false)
    expect(handled('textarea'), 'textarea').toBe(false)
  })

  it('ignores auto-repeat', () => {
    renderHook(() => useUndoShortcuts())
    expect(press({ key: 'z', ctrlKey: true, repeat: true })).toBe(false)
    expect(products()).toHaveLength(1)
  })

  it('is blocked while the connection limit editor is open', () => {
    renderHook(() => useUndoShortcuts())
    const { unmount } = render(<ConnectionLimitEditor x={0} y={0} initial="" rateUnit="min" onCommit={() => {}} onClose={() => {}} />)
    expect(press({ key: 'z', ctrlKey: true })).toBe(false)
    unmount()
    expect(press({ key: 'z', ctrlKey: true })).toBe(true)
  })

  it('removes its listener on unmount', () => {
    const { unmount } = renderHook(() => useUndoShortcuts())
    unmount()
    press({ key: 'z', ctrlKey: true })
    expect(products()).toHaveLength(1)
  })
})
