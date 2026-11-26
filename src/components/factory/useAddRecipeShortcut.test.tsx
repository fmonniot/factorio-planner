import { describe, it, expect, vi } from 'vitest'
import { render, renderHook, fireEvent } from '@testing-library/react'
import { useAddRecipeShortcut } from './useAddRecipeShortcut'
import { Modal } from '../Modal'
import { useOverlayOpen } from './sidePanel/useDismiss'

function Overlay() {
  useOverlayOpen()
  return null
}

/** Fires the key on `target` and returns whether the event was cancelled (handled). */
function press(init: KeyboardEventInit, target: Element = document.body): boolean {
  return !fireEvent.keyDown(target, { bubbles: true, cancelable: true, ...init })
}

function field(tag: string, type?: string): HTMLElement {
  const el = document.body.appendChild(document.createElement(tag))
  if (type) (el as HTMLInputElement).type = type
  return el
}

describe('useAddRecipeShortcut', () => {
  it('calls onAdd once on r and cancels the event, and on R with Caps Lock', () => {
    const onAdd = vi.fn()
    renderHook(() => useAddRecipeShortcut(onAdd, true))
    expect(press({ key: 'r' }), 'handled').toBe(true)
    expect(onAdd).toHaveBeenCalledTimes(1)
    press({ key: 'R' })
    expect(onAdd).toHaveBeenCalledTimes(2)
  })

  it('ignores a modified press and other keys, the add-product key among them', () => {
    const onAdd = vi.fn()
    renderHook(() => useAddRecipeShortcut(onAdd, true))
    for (const mod of ['shiftKey', 'ctrlKey', 'metaKey', 'altKey']) {
      expect(press({ key: 'r', [mod]: true }), mod).toBe(false)
    }
    press({ key: 'a' })
    expect(onAdd).not.toHaveBeenCalled()
  })

  it('ignores text inputs, textareas, number inputs and selects', () => {
    const onAdd = vi.fn()
    renderHook(() => useAddRecipeShortcut(onAdd, true))
    for (const [tag, type] of [['input', 'text'], ['textarea', undefined], ['input', 'number'], ['select', undefined]] as const) {
      const el = field(tag, type)
      expect(press({ key: 'r' }, el), `${tag} ${type ?? ''}`).toBe(false)
      el.remove()
    }
    expect(onAdd).not.toHaveBeenCalled()
  })

  it('ignores repeat and composition', () => {
    const onAdd = vi.fn()
    renderHook(() => useAddRecipeShortcut(onAdd, true))
    press({ key: 'r', repeat: true })
    press({ key: 'r', isComposing: true })
    press({ key: 'r', keyCode: 229 })
    expect(onAdd).not.toHaveBeenCalled()
  })

  it('is ignored while an overlay or a modal is open, and works again after', () => {
    const onAdd = vi.fn()
    renderHook(() => useAddRecipeShortcut(onAdd, true))
    const overlay = render(<Overlay />)
    press({ key: 'r' })
    overlay.unmount()
    const modal = render(<Modal onClose={() => {}}>x</Modal>)
    press({ key: 'r' })
    modal.unmount()
    expect(onAdd).not.toHaveBeenCalled()
    press({ key: 'r' })
    expect(onAdd).toHaveBeenCalledTimes(1)
  })

  it('never calls onAdd when disabled', () => {
    const onAdd = vi.fn()
    renderHook(() => useAddRecipeShortcut(onAdd, false))
    expect(press({ key: 'r' })).toBe(false)
    expect(onAdd).not.toHaveBeenCalled()
  })
})
