import { useEffect } from 'react'
import { useBlockStore, selectCanUndo, selectCanRedo } from '../../store/blockStore'
import { isUndoBlockedByOverlay } from './sidePanel/useDismiss'

/** Whether the platform uses Cmd (not Ctrl) as its shortcut key. */
function isApplePlatform(): boolean {
  if (typeof navigator === 'undefined') return false
  const platform = navigator.platform || navigator.userAgent
  return /Mac|iPhone|iPad/.test(platform)
}

/** The shortcut shown for undo: Ctrl+Z, or Cmd+Z on Apple platforms. */
export function undoHint(): string {
  return isApplePlatform() ? 'Cmd+Z' : 'Ctrl+Z'
}

/** The shortcut shown for redo: Ctrl+Y, or Cmd+Shift+Z on Apple platforms. */
export function redoHint(): string {
  return isApplePlatform() ? 'Cmd+Shift+Z' : 'Ctrl+Y'
}

/** `Undo (Ctrl+Z)`, or `Undo in Gears (Ctrl+Z)` when the entry belongs to a block that is not the active one. */
export function undoLabel(verb: 'Undo' | 'Redo', blockName: string | undefined, hint: string): string {
  return blockName === undefined ? `${verb} (${hint})` : `${verb} in ${blockName} (${hint})`
}

/** Which action a key press asks for: Ctrl/Cmd+Z undo; Ctrl/Cmd+Shift+Z and Ctrl+Y redo. Cmd+Y is not bound. */
export function undoShortcutOf(e: KeyboardEvent): 'undo' | 'redo' | null {
  if (e.altKey) return null
  const mod = e.ctrlKey || e.metaKey
  const key = e.key.toLowerCase()
  if (mod && key === 'z') return e.shiftKey ? 'redo' : 'undo'
  if (e.ctrlKey && !e.metaKey && key === 'y' && !e.shiftKey) return 'redo'
  return null
}

function isTextTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable
}

/** Binds the undo and redo shortcuts on the document; call once, at the top of the shell. */
export function useUndoShortcuts(): void {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.defaultPrevented || e.isComposing) return
      if (isTextTarget(e.target)) return
      if (isUndoBlockedByOverlay()) return
      const action = undoShortcutOf(e)
      if (!action) return
      const state = useBlockStore.getState()
      if (!(action === 'undo' ? selectCanUndo(state) : selectCanRedo(state))) return
      e.preventDefault()
      state[action]()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])
}
