import { useRef, useState } from 'react'
import { useDismiss, useOverlayOpen } from './sidePanel/useDismiss'
import { focusFirstSlot } from '../gridNav'
import { moveListFocus } from '../listNav'

export interface BlockPickerOption {
  id: string
  label: string
  /** The block's colour; an option with none (All blocks) shows no dot. */
  color?: string
  /** What comes after the name, e.g. "3 areas". */
  meta: string
}

const STEP = 'h-7 w-7 shrink-0 flex items-center justify-center rounded-md bg-gray-950 border border-gray-700 text-gray-300 hover:text-white outline-none focus-visible:ring-1 focus-visible:ring-teal-400'

/**
 * Picks one block out of many: a button with the chosen block's colour, name and meta, previous / next buttons around it, and
 * a list with a search field under it. It replaces a row of one pill per block, which stops fitting once many blocks have
 * areas. `extra` is an option that is not a block (All blocks): listed first and skipped by the previous / next buttons.
 */
export function BlockPicker({ label, options, extra, value, onChange }: {
  label: string
  options: BlockPickerOption[]
  extra?: BlockPickerOption
  value: string
  onChange: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  useOverlayOpen(open)
  // Esc closes the list and nothing else (the modal under it keeps its own Esc); the focus goes back to the button.
  useDismiss([panelRef, triggerRef], open, () => {
    setOpen(false)
    triggerRef.current?.focus()
  })

  const all = extra ? [extra, ...options] : options
  const current = all.find(o => o.id === value)
  const q = query.trim().toLowerCase()
  const shown = q === '' ? all : all.filter(o => o.label.toLowerCase().includes(q))

  function pick(id: string) {
    onChange(id)
    setOpen(false)
    setQuery('')
    triggerRef.current?.focus()
  }
  function step(delta: 1 | -1) {
    if (options.length === 0) return
    const at = options.findIndex(o => o.id === value)
    const next = at === -1 ? (delta > 0 ? 0 : options.length - 1) : (at + delta + options.length) % options.length
    onChange(options[next].id)
  }

  return (
    <div role="group" aria-label={label} className="relative flex items-center gap-1.5">
      <button type="button" aria-label="Previous block" onClick={() => step(-1)} className={STEP}>
        <span aria-hidden>{'‹'}</span>
      </button>
      <button
        ref={triggerRef}
        type="button"
        data-testid="block-picker"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => { setOpen(o => !o); setQuery('') }}
        className="h-7 w-[17.5rem] px-2.5 flex items-center justify-between gap-2 rounded-md bg-gray-950 border border-gray-700 text-[13px] text-gray-100 outline-none focus-visible:ring-1 focus-visible:ring-teal-400"
      >
        <span className="flex items-center gap-2 min-w-0">
          {current?.color && <span aria-hidden className="w-2 h-2 rounded-full shrink-0" style={{ background: current.color }} />}
          <span className="truncate">{current?.label ?? 'Choose a block'}</span>
          {current && <span className="text-xs text-gray-400 shrink-0">{current.meta}</span>}
        </span>
        <span aria-hidden className="text-gray-400 text-xs">{'▾'}</span>
      </button>
      <button type="button" aria-label="Next block" onClick={() => step(1)} className={STEP}>
        <span aria-hidden>{'›'}</span>
      </button>

      {open && (
        <div
          ref={panelRef}
          data-testid="block-picker-panel"
          className="absolute left-9 top-full z-50 mt-1 w-80 rounded-lg bg-gray-900 border border-gray-700 shadow-2xl p-2"
        >
          <input
            ref={searchRef}
            type="text"
            autoFocus
            aria-label="Find a block"
            placeholder="Find a block"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'ArrowDown' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
                e.preventDefault()
                focusFirstSlot(panelRef.current, '[role="option"]')
              } else if (e.key === 'Enter' && shown.length > 0) {
                e.preventDefault()
                pick(shown[0].id)
              }
            }}
            className="w-full h-7 box-border rounded-md bg-gray-950 border border-gray-700 text-gray-100 text-[13px] px-2.5 placeholder:text-gray-400"
          />
          <ul
            role="listbox"
            aria-label={label}
            onKeyDown={e => moveListFocus(e, '[role="option"]', { onTopEdge: () => searchRef.current?.focus() })}
            className="mt-2 max-h-80 overflow-y-auto"
          >
            {shown.map(o => (
              <li key={o.id} role="presentation">
                <button
                  type="button"
                  role="option"
                  aria-selected={o.id === value}
                  onClick={() => pick(o.id)}
                  className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-left text-[13px] text-gray-100 hover:bg-gray-800 outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-teal-400 ${o.id === value ? 'bg-gray-800' : ''}`}
                >
                  {o.color ? <span aria-hidden className="w-2 h-2 rounded-full shrink-0" style={{ background: o.color }} /> : <span aria-hidden className="w-2 shrink-0" />}
                  <span className="flex-1 truncate">{o.label}</span>
                  <span className="text-xs text-gray-400 shrink-0">{o.meta}</span>
                </button>
              </li>
            ))}
            {shown.length === 0 && <li role="presentation" className="px-2 py-1.5 text-xs text-gray-400">No block matches.</li>}
          </ul>
        </div>
      )}
    </div>
  )
}
