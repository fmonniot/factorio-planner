import { useRef, useState, useEffect, useLayoutEffect, useId, type ReactNode } from 'react'

export const ITEM_SELECTOR = '[role^="menuitem"]:not(:disabled)'
export const ITEM_CLASS = 'text-left whitespace-nowrap px-3 py-1 text-gray-200 hover:bg-gray-700 focus:bg-gray-700 outline-none flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed'

interface MenuButtonProps {
  label: ReactNode
  /** Accessible name of the trigger, when it differs from the visible label. */
  ariaLabel?: string
  title: string
  /** Accessible name of the panel. */
  menuLabel: string
  /** Which edge of the trigger the panel lines up with. */
  align: 'left' | 'right'
  disabled?: boolean
  /** Panel content; `close(true)` also returns focus to the trigger. */
  children: (close: (returnFocus: boolean) => void) => ReactNode
}

/** Renders the panel items; a component of its own so `close` (which touches the trigger ref) is not called while MenuButton renders. */
function PanelItems({ render, close }: { render: MenuButtonProps['children']; close: (returnFocus: boolean) => void }) {
  return <>{render(close)}</>
}

/**
 * A top-bar dropdown: a trigger button and a `menu` panel with arrow-key
 * navigation. Items are `role="menuitem*"` elements; checked radio items get
 * the initial focus on a keyboard open.
 */
export function MenuButton({ label, ariaLabel, title, menuLabel, align, disabled, children }: MenuButtonProps) {
  const [open, setOpen] = useState(false)
  const menuId = useId()
  const wrapperRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  // Where focus goes on open: keyboard opens move into the panel, mouse opens
  // leave it on the trigger so only the hovered row looks active.
  const openFocusRef = useRef<'checked' | 'last' | 'none'>('none')

  function close(returnFocus: boolean) {
    setOpen(false)
    if (returnFocus) triggerRef.current?.focus()
  }

  useLayoutEffect(() => {
    if (!open) return
    const panel = panelRef.current
    if (!panel || openFocusRef.current === 'none') return
    const target = openFocusRef.current === 'last'
      ? Array.from(panel.querySelectorAll<HTMLElement>(ITEM_SELECTOR)).pop()
      : panel.querySelector<HTMLElement>('[aria-checked="true"]') ?? panel.querySelector<HTMLElement>(ITEM_SELECTOR)
    target?.focus()
  }, [open])

  useEffect(() => {
    if (!open) return

    // Capture phase + preventDefault so Escape does not also clear the
    // summary pane selection (see RowActionsMenu).
    function onKeyDown(e: KeyboardEvent) {
      // Escape works anywhere; the other keys only when focus is in the menu
      // (or on its trigger), so they do not hijack the rest of the page.
      const active = document.activeElement
      const inMenu = active === triggerRef.current || !!panelRef.current?.contains(active)
      if (e.key !== 'Escape' && !inMenu) return
      const items = Array.from(panelRef.current?.querySelectorAll<HTMLElement>(ITEM_SELECTOR) ?? [])
      const index = items.indexOf(document.activeElement as HTMLElement)
      const focusAt = (i: number) => items[(i + items.length) % items.length]?.focus()
      switch (e.key) {
        case 'Escape':
          e.preventDefault()
          close(true)
          break
        case 'ArrowDown':
          e.preventDefault()
          focusAt(index + 1)
          break
        case 'ArrowUp':
          e.preventDefault()
          focusAt(index < 0 ? -1 : index - 1)
          break
        case 'Home':
          e.preventDefault()
          focusAt(0)
          break
        case 'End':
          e.preventDefault()
          focusAt(-1)
          break
        case 'Tab':
          close(true)
          break
      }
    }

    // Covers trigger and panel, so a trigger click toggles instead of
    // closing and immediately reopening.
    function onPointerDown(e: PointerEvent) {
      if (!wrapperRef.current?.contains(e.target as Node)) close(false)
    }

    document.addEventListener('keydown', onKeyDown, true)
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      document.removeEventListener('pointerdown', onPointerDown, true)
    }
  }, [open])

  return (
    <div ref={wrapperRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={ariaLabel}
        title={title}
        disabled={disabled}
        className="flex items-center gap-1 text-xs bg-gray-800 text-gray-400 hover:text-gray-100 border border-gray-600 rounded px-2 py-1 disabled:opacity-50 disabled:cursor-not-allowed"
        // detail is 0 for clicks synthesised from Enter / Space.
        onClick={e => { openFocusRef.current = e.detail === 0 ? 'checked' : 'none'; setOpen(o => !o) }}
        onKeyDown={e => {
          if (open || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return
          e.preventDefault()
          openFocusRef.current = e.key === 'ArrowUp' ? 'last' : 'checked'
          setOpen(true)
        }}
      >
        {label}<span aria-hidden className="text-[10px] opacity-60">▾</span>
      </button>
      {open && (
        <div
          ref={panelRef}
          id={menuId}
          role="menu"
          aria-label={menuLabel}
          className={`absolute top-full ${align === 'right' ? 'right-0' : 'left-0'} mt-1 z-50 min-w-48 bg-gray-800 border border-gray-600 rounded shadow-lg py-1 flex flex-col text-xs`}
        >
          <PanelItems render={children} close={close} />
        </div>
      )}
    </div>
  )
}
