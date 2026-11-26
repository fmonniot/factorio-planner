import { describe, it, expect, vi } from 'vitest'
import { render, renderHook, fireEvent } from '@testing-library/react'
import { useKeyShortcut } from './useKeyShortcut'
import { useAddGoalShortcut } from './useAddGoalShortcut'
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

describe('useAddGoalShortcut', () => {
  it('calls onAdd once on a and cancels the event, and on A with Caps Lock', () => {
    const onAdd = vi.fn()
    renderHook(() => useAddGoalShortcut(onAdd, true))
    expect(press({ key: 'a' }), 'handled').toBe(true)
    expect(onAdd).toHaveBeenCalledTimes(1)
    press({ key: 'A' })
    expect(onAdd).toHaveBeenCalledTimes(2)
  })

  it('ignores a modified press and other keys', () => {
    const onAdd = vi.fn()
    renderHook(() => useAddGoalShortcut(onAdd, true))
    for (const mod of ['shiftKey', 'ctrlKey', 'metaKey', 'altKey']) {
      expect(press({ key: 'a', [mod]: true }), mod).toBe(false)
    }
    press({ key: 'b' })
    expect(onAdd).not.toHaveBeenCalled()
  })

  it('ignores text inputs, textareas, number inputs and selects', () => {
    const onAdd = vi.fn()
    renderHook(() => useAddGoalShortcut(onAdd, true))
    for (const [tag, type] of [['input', 'text'], ['textarea', undefined], ['input', 'number'], ['select', undefined]] as const) {
      const el = field(tag, type)
      expect(press({ key: 'a' }, el), `${tag} ${type ?? ''}`).toBe(false)
      el.remove()
    }
    expect(onAdd).not.toHaveBeenCalled()
  })

  it('works from a button and a checkbox', () => {
    const onAdd = vi.fn()
    renderHook(() => useAddGoalShortcut(onAdd, true))
    for (const [tag, type] of [['button', undefined], ['input', 'checkbox']] as const) {
      const el = field(tag, type)
      press({ key: 'a' }, el)
      el.remove()
    }
    expect(onAdd).toHaveBeenCalledTimes(2)
  })

  it('ignores repeat, composition and an event that was already handled', () => {
    const onAdd = vi.fn()
    renderHook(() => useAddGoalShortcut(onAdd, true))
    press({ key: 'a', repeat: true })
    press({ key: 'a', isComposing: true })
    press({ key: 'a', keyCode: 229 })
    const take = (e: Event) => e.preventDefault()
    document.body.addEventListener('keydown', take)
    press({ key: 'a' })
    document.body.removeEventListener('keydown', take)
    expect(onAdd).not.toHaveBeenCalled()
  })

  it('is ignored while an overlay or any modal is open, and works again after', () => {
    const onAdd = vi.fn()
    renderHook(() => useAddGoalShortcut(onAdd, true))
    const overlay = render(<Overlay />)
    press({ key: 'a' })
    overlay.unmount()
    const plain = render(<Modal onClose={() => {}}>x</Modal>)
    press({ key: 'a' })
    plain.unmount()
    const undoable = render(<Modal onClose={() => {}} undoable>x</Modal>)
    press({ key: 'a' })
    undoable.unmount()
    expect(onAdd).not.toHaveBeenCalled()
    press({ key: 'a' })
    expect(onAdd).toHaveBeenCalledTimes(1)
  })

  it('never calls onAdd when disabled', () => {
    const onAdd = vi.fn()
    renderHook(() => useAddGoalShortcut(onAdd, false))
    expect(press({ key: 'a' })).toBe(false)
    expect(onAdd).not.toHaveBeenCalled()
  })

  it('calls the latest callback', () => {
    const first = vi.fn()
    const second = vi.fn()
    const { rerender } = renderHook(({ cb }) => useAddGoalShortcut(cb, true), { initialProps: { cb: first } })
    rerender({ cb: second })
    press({ key: 'a' })
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })
})

describe('useKeyShortcut', () => {
  it('takes the key case-insensitively', () => {
    const onPress = vi.fn()
    renderHook(() => useKeyShortcut('Q', onPress, true))
    press({ key: 'q' })
    press({ key: 'Q' })
    expect(onPress).toHaveBeenCalledTimes(2)
  })
})
