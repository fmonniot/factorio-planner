import { lookOfLine } from './segmentLooks'
import type { LineMark, SourceLine } from './sourcesModel'

// ---------------------------------------------------------------------------
// SourcesLine — the presentation of one line of the Sources list: a 26px row (marker on the rail, icon, name and status mark,
// consumed rate, then a chevron or the line's switch), and the detail that opens under it. The list owns the state and the handlers.
// ---------------------------------------------------------------------------

const AMBER_TEXT = 'text-amber-300'

/** The dashed square of the lines that stand for rows of this block in another area. */
export function DashedSquareIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2 1.6" strokeLinecap="round" aria-hidden="true">
      <rect x="1.25" y="1.25" width="9.5" height="9.5" rx="1.6" />
    </svg>
  )
}

const MARKS: Record<Exclude<LineMark, undefined>, { text: string; tip: string }> = {
  limited: { text: '!', tip: 'Limited' },
  missing: { text: '▼', tip: 'Missing' },
  idle: { text: '', tip: 'Idle' },
}

function StatusMark({ mark }: { mark: Exclude<LineMark, undefined> }) {
  const { text, tip } = MARKS[mark]
  return (
    <span
      role="img"
      aria-label={tip}
      data-testid="sources-status-mark"
      data-status={mark}
      data-tip={tip}
      className={`inline-flex size-3 shrink-0 items-center justify-center text-[10px] font-bold leading-none ${mark === 'idle' ? 'rounded-full border border-dashed border-gray-500' : AMBER_TEXT}`}
    >
      {text}
    </span>
  )
}

const GRIP = (
  <svg width="8" height="10" viewBox="0 0 8 10" aria-hidden="true" fill="currentColor">
    {[1.5, 6.5].flatMap(x => [1.5, 5, 8.5].map(y => <circle key={`${x}-${y}`} cx={x} cy={y} r=".9" />))}
  </svg>
)

export function SourcesLine({
  line, dataLine, open, onToggle, detailId, icon, tag, rateText, rateTestId, frame, dropSide, draggable, switchNode, detail, onNameKeyDown,
}: {
  line: SourceLine
  /** The `data-line` value: 'block', 'make-here', 'other-area', … */
  dataLine: string
  open: boolean
  onToggle: () => void
  detailId: string
  /** The 14px icon of the line. */
  icon: React.ReactNode
  /** The block line's tag chip, after the name. */
  tag?: React.ReactNode
  /** What the rate column reads ("—" for no rate). */
  rateText: string
  rateTestId: 'sources-rate' | 'sources-block-rate'
  /** Extra attributes and handlers of the frame (drag and drop). */
  frame?: React.HTMLAttributes<HTMLLIElement> & { draggable?: boolean }
  /** The drop line drawn on one edge of this line. */
  dropSide?: 'before' | 'after' | null
  draggable: boolean
  /** The line's switch, in the 30px column at the end (the other lines have a chevron there). */
  switchNode?: React.ReactNode
  /** The content of the detail, drawn while the line is open. */
  detail: React.ReactNode
  onNameKeyDown: (e: React.KeyboardEvent<HTMLButtonElement>) => void
}) {
  const look = lookOfLine(line.look)
  return (
    <li
      data-testid="sources-line"
      data-line={dataLine}
      data-connection-id={line.connectionId}
      data-area-id={line.areaId}
      data-off={line.off || undefined}
      data-draggable={draggable || undefined}
      {...frame}
      className={`group relative rounded ${line.off ? 'text-gray-500' : 'text-gray-200'}`}
    >
      {dropSide && (
        <span
          aria-hidden="true"
          data-testid="sources-drop-line"
          data-side={dropSide}
          className={`absolute left-0 right-0 h-0.5 bg-blue-500 pointer-events-none ${dropSide === 'before' ? '-top-px' : '-bottom-px'}`}
        />
      )}
      <div className={`flex h-[26px] items-center ${line.dim ? 'opacity-55' : ''}`}>
        <span aria-hidden="true" className="relative z-10 flex w-4 shrink-0 items-center justify-center">
          <span
            data-testid="sources-marker"
            data-supplies={line.supplies || undefined}
            className={`size-2 rounded-full border ${draggable ? 'group-hover:hidden' : ''}`}
            style={line.supplies ? { background: look.mini, borderColor: look.border } : { background: '#111827', borderColor: look.border }}
          />
          {draggable && <span className="hidden text-gray-500 group-hover:block">{GRIP}</span>}
        </span>
        <span aria-hidden="true" className="flex w-3.5 shrink-0 items-center justify-center text-gray-300">{icon}</span>
        <button
          type="button"
          data-testid="sources-line-toggle"
          aria-expanded={open}
          aria-controls={open ? detailId : undefined}
          onClick={onToggle}
          onKeyDown={onNameKeyDown}
          className="ml-1.5 flex h-full min-w-0 flex-1 items-center gap-1.5 rounded text-left text-[11px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-teal-400"
        >
          {line.kind === 'block'
            ? <span data-testid="sources-block-name" className="min-w-0 truncate">{line.label}</span>
            : <span className="min-w-0 truncate">{line.label}</span>}
          {tag}
          {line.mark && <StatusMark mark={line.mark} />}
          <span
            data-testid={rateTestId}
            className="ml-auto w-11 shrink-0 text-right font-mono text-[11px] tabular-nums text-gray-300"
          >
            {rateText}
          </span>
          {!switchNode && (
            <span aria-hidden="true" className="flex w-[30px] shrink-0 justify-center text-gray-500">
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                <path d={open ? 'M2 6.5L5 3.5l3 3' : 'M2 3.5L5 6.5l3-3'} />
              </svg>
            </span>
          )}
        </button>
        {switchNode && <span className="flex w-[30px] shrink-0 items-center justify-center">{switchNode}</span>}
      </div>
      {open && (
        <div
          id={detailId}
          data-testid="sources-detail"
          className="mb-1 ml-[22px] mt-0.5 flex flex-col gap-1.5 rounded border border-gray-700/70 bg-gray-950/40 p-1.5 text-[11px] leading-snug text-gray-400"
        >
          {detail}
        </div>
      )}
    </li>
  )
}

/** The status sentence of a detail: amber for a limited or missing line, grey otherwise. */
export function DetailStatus({ children, tone, testId = 'sources-detail-status', status }: {
  children: React.ReactNode
  tone: 'amber' | 'grey'
  testId?: string
  status?: string
}) {
  return <p data-testid={testId} data-status={status} className={tone === 'amber' ? AMBER_TEXT : 'text-gray-400'}>{children}</p>
}
