import { useEffect, useRef, type ReactNode } from 'react'
import { useUiStore, type PanelHighlightSection } from '../../../store/uiStore'

/** How long a chip shortcut's highlight of a section lasts. */
export const HIGHLIGHT_MS = 1600

/** A titled section of the side panel. */
export function PanelSection({ title, testId, children, className = '', highlightKey }: {
  title: string
  testId?: string
  children: ReactNode
  className?: string
  /** The section a chip shortcut can highlight: it scrolls into view and shows a ring (`data-highlighted`) for a moment. */
  highlightKey?: PanelHighlightSection
}) {
  const ref = useRef<HTMLElement>(null)
  const highlight = useUiStore(s => s.panelHighlight)
  const clearHighlight = useUiStore(s => s.clearPanelHighlight)
  const seq = highlightKey !== undefined && highlight?.section === highlightKey ? highlight.seq : undefined
  useEffect(() => {
    if (seq === undefined) return
    ref.current?.scrollIntoView?.({ block: 'nearest' })
    const timer = setTimeout(() => clearHighlight(seq), HIGHLIGHT_MS)
    return () => clearTimeout(timer)
  }, [seq, clearHighlight])
  return (
    <section
      ref={ref}
      data-testid={testId}
      data-highlighted={seq !== undefined ? 'true' : undefined}
      aria-label={title}
      className={`px-4 py-3 border-b border-gray-800 ${seq !== undefined ? 'ring-2 ring-inset ring-teal-500 bg-teal-950/30' : ''} ${className}`}
    >
      <h3 className="text-[10px] uppercase tracking-wide text-gray-500 mb-2">{title}</h3>
      {children}
    </section>
  )
}

/** The panel's top line: an icon, a title, a subtitle and the close button. */
export function PanelHeader({ icon, title, subtitle, marker, onClose }: {
  icon: ReactNode
  title: string
  subtitle?: string
  /** A small marker after the title (the "Area" tag). */
  marker?: ReactNode
  onClose: () => void
}) {
  return (
    <header className="flex items-center gap-2.5 px-4 py-3 border-b border-gray-700">
      <span className="shrink-0">{icon}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <h2 data-testid="panel-title" className="text-sm font-semibold text-gray-100 truncate" title={title}>{title}</h2>
          {marker}
        </div>
        {subtitle && <div className="text-[11px] text-gray-500 truncate">{subtitle}</div>}
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close panel"
        title="Close panel"
        className="shrink-0 text-gray-500 hover:text-gray-200 text-lg leading-none px-1"
      >
        ✕
      </button>
    </header>
  )
}

/** The amber "Beyond research horizon" tag. */
export function BeyondTag({ className = '' }: { className?: string }) {
  return <span data-testid="beyond-horizon" className={`text-[10px] text-amber-400 ${className}`}>Beyond research horizon</span>
}

/** Chevron of a picker button. */
export function Chevron() {
  return (
    <svg width="9" height="9" viewBox="0 0 10 10" aria-hidden="true" className="text-gray-400">
      <path d="M1 3l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}
