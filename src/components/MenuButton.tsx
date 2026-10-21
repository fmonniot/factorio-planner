import { useRef, useState, useEffect, useLayoutEffect, useId, type ReactNode } from 'react'
import { ChevronDownIcon } from './icons'

export const ITEM_SELECTOR = '[role^="menuitem"]:not(:disabled)'
export const ITEM_CLASS = 'text-left whitespace-nowrap px-3 py-1 text-gray-200 hover:bg-gray-700 focus:bg-gray-700 outline-none flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed'

/** The innermost `menu` element holding `active`, or the panel when focus is elsewhere. */
function currentMenu(panel: HTMLElement, active: Element | null): HTMLElement {
  if (active && panel.contains(active)) {
    const menu = active.closest('[role="menu"]')
    if (menu instanceof HTMLElement) return menu
  }
  return panel
}

/** The enabled items that belong to `menu` itself, not to a menu nested in it. */
function menuItems(menu: HTMLElement): HTMLElement[] {
  return Array.from(menu.querySelectorAll(ITEM_SELECTOR)).filter(
    (el): el is HTMLElement => el instanceof HTMLElement && el.closest('[role="menu"]') === menu,
  )
}

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
  /** Replaces the default trigger classes. */
  triggerClassName?: string
  /** Replaces the default `▾` after the label. */
  caret?: ReactNode
  /** Appended to the panel classes (e.g. a width). */
  panelClassName?: string
  /** Opens the menu (without moving focus) each time it changes to a non-zero value. */
  openSignal?: number
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
 * the initial focus on a keyboard open. A `SubmenuItem` adds a nested flyout
 * menu: arrows move within the menu that holds focus, ArrowRight opens a
 * flyout, Escape / ArrowLeft close it.
 */
export function MenuButton({ label, ariaLabel, title, menuLabel, align, disabled, triggerClassName, caret, panelClassName = '', openSignal, children }: MenuButtonProps) {
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

  // Skipped on mount: only a change opens the menu.
  const seenSignalRef = useRef(openSignal)
  useEffect(() => {
    if (openSignal === seenSignalRef.current) return
    seenSignalRef.current = openSignal
    if (!openSignal) return
    openFocusRef.current = 'none'
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reacting to an external request
    setOpen(true)
  }, [openSignal])

  useLayoutEffect(() => {
    if (!open) return
    const panel = panelRef.current
    if (!panel || openFocusRef.current === 'none') return
    const items = menuItems(panel)
    const target = openFocusRef.current === 'last'
      ? items[items.length - 1]
      : items.find(el => el.getAttribute('aria-checked') === 'true') ?? items[0]
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
      const panel = panelRef.current
      const menu = panel ? currentMenu(panel, active) : null
      const nested = !!panel && !!menu && menu !== panel
      const items = menu ? menuItems(menu) : []
      const index = items.findIndex(el => el === active)
      const focusAt = (i: number) => items[(i + items.length) % items.length]?.focus()
      // Back to the item that opened the flyout; that item's onFocus closes the flyout.
      const leaveFlyout = () => {
        const owner = Array.from(panel?.querySelectorAll('[aria-controls]') ?? []).find(
          el => el.getAttribute('aria-controls') === menu?.id,
        )
        if (owner instanceof HTMLElement) owner.focus()
      }
      switch (e.key) {
        case 'Escape':
          e.preventDefault()
          if (nested) leaveFlyout()
          else close(true)
          break
        case 'ArrowLeft':
          if (!nested) break
          e.preventDefault()
          leaveFlyout()
          break
        case 'ArrowRight':
          if (nested || !(active instanceof HTMLElement) || active.getAttribute('aria-haspopup') !== 'menu') break
          if (!panel?.contains(active)) break
          e.preventDefault()
          active.click() // detail is 0, which opens the flyout with focus
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
        className={triggerClassName ?? 'flex items-center gap-1 text-xs bg-gray-800 text-gray-400 hover:text-gray-100 border border-gray-600 rounded px-2 py-1 disabled:opacity-50 disabled:cursor-not-allowed'}
        // detail is 0 for clicks synthesised from Enter / Space.
        onClick={e => { openFocusRef.current = e.detail === 0 ? 'checked' : 'none'; setOpen(o => !o) }}
        onKeyDown={e => {
          if (open || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return
          e.preventDefault()
          openFocusRef.current = e.key === 'ArrowUp' ? 'last' : 'checked'
          setOpen(true)
        }}
      >
        {label}{caret ?? <span aria-hidden className="text-[10px] opacity-60">▾</span>}
      </button>
      {open && (
        <div
          ref={panelRef}
          id={menuId}
          role="menu"
          aria-label={menuLabel}
          className={`absolute top-full ${align === 'right' ? 'right-0' : 'left-0'} mt-1 z-50 min-w-48 bg-gray-800 border border-gray-600 rounded shadow-lg py-1 flex flex-col text-xs ${panelClassName}`}
        >
          <PanelItems render={children} close={close} />
        </div>
      )}
    </div>
  )
}

interface SubmenuItemProps {
  label: ReactNode
  /** Accessible name of the flyout. */
  menuLabel: string
  /** Appended to the flyout classes (e.g. a width). */
  panelClassName?: string
  /** Mount with the flyout open and focus inside it. */
  defaultOpen?: boolean
  /** Focus target on keyboard / `defaultOpen` opens; falls back to the first checked item, then the first item. */
  initialFocus?: (flyout: HTMLElement) => HTMLElement | null
  children: ReactNode
}

const FLYOUT_CLOSE_DELAY_MS = 200

/**
 * A `MenuButton` item that opens a flyout menu to its left. Hover opens it without
 * moving focus, a keyboard or `defaultOpen` open focuses into it.
 */
export function SubmenuItem({ label, menuLabel, panelClassName = '', defaultOpen = false, initialFocus, children }: SubmenuItemProps) {
  const [open, setOpen] = useState(defaultOpen)
  const flyoutId = useId()
  const wrapperRef = useRef<HTMLDivElement>(null)
  const flyoutRef = useRef<HTMLDivElement>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const ownerRef = useRef<HTMLButtonElement>(null)
  // Set while focus in the flyout comes from a pointer interaction rather than the keyboard.
  const pointerFocusRef = useRef(false)
  // Set when the next open should move focus into the flyout.
  const focusOnOpenRef = useRef(defaultOpen)

  function focusFlyout() {
    const flyout = flyoutRef.current
    if (!flyout) return
    const items = menuItems(flyout)
    const target = initialFocus?.(flyout) ?? items.find(el => el.getAttribute('aria-checked') === 'true') ?? items[0]
    target?.focus()
  }

  useLayoutEffect(() => {
    if (!open || !focusOnOpenRef.current) return
    focusOnOpenRef.current = false
    focusFlyout()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => () => clearTimeout(timerRef.current), [])

  function isHovered(): boolean {
    try {
      return wrapperRef.current?.matches(':hover') ?? false
    } catch {
      return false
    }
  }

  return (
    <div
      ref={wrapperRef}
      onMouseEnter={() => {
        clearTimeout(timerRef.current)
        setOpen(true)
      }}
      onMouseLeave={() => {
        clearTimeout(timerRef.current)
        timerRef.current = setTimeout(() => {
          const active = document.activeElement
          if (flyoutRef.current?.contains(active)) {
            // Keyboard focus keeps the flyout open; focus left by a click does not.
            if (!pointerFocusRef.current) return
            ownerRef.current?.focus() // keeps the top-level menu's keyboard model consistent
          }
          setOpen(false)
        }, FLYOUT_CLOSE_DELAY_MS)
      }}
      onPointerDown={e => { pointerFocusRef.current = !!flyoutRef.current?.contains(e.target as Node) }}
      onKeyDown={() => { pointerFocusRef.current = false }}
      onBlur={e => {
        const next = e.relatedTarget
        if (next instanceof Node && wrapperRef.current?.contains(next)) return
        if (!isHovered()) setOpen(false)
      }}
    >
      <button
        ref={ownerRef}
        type="button"
        role="menuitem"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? flyoutId : undefined}
        tabIndex={-1}
        className={`${ITEM_CLASS} w-full`}
        // detail is 0 for clicks synthesised from Enter / Space / ArrowRight.
        onClick={e => {
          if (e.detail !== 0) {
            setOpen(true)
          } else if (open) {
            focusFlyout()
          } else {
            focusOnOpenRef.current = true
            setOpen(true)
          }
        }}
        onFocus={e => {
          if (e.relatedTarget instanceof Node && flyoutRef.current?.contains(e.relatedTarget)) setOpen(false)
        }}
      >
        {label}
        <ChevronDownIcon className="w-3 h-3 -rotate-90 ml-auto" />
      </button>
      {open && (
        <div
          ref={flyoutRef}
          id={flyoutId}
          role="menu"
          aria-label={menuLabel}
          className={`absolute right-full top-0 mr-1 z-50 bg-gray-800 border border-gray-600 rounded shadow-lg py-1 flex flex-col text-xs max-h-[calc(100vh-4rem)] overflow-y-auto ${panelClassName}`}
        >
          {children}
        </div>
      )}
    </div>
  )
}
