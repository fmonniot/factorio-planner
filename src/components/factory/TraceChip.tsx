import { tipProps } from '../tipProps'
import { lookStyle } from './segmentLooks'
import type { SegmentLook } from './segmentLooks'

interface TraceChipProps {
  rowKey: string
  kind: string
  /** The label the traced segment writes. */
  name: string
  look: SegmentLook
  onClear: () => void
}

/** The overview heading's mark of a traced source: its colour and name, and a button that stops the trace. */
export function TraceChip({ rowKey, kind, name, look, onClear }: TraceChipProps) {
  return (
    <span
      role="group"
      aria-label={`Tracing ${name}`}
      data-testid="summary-trace-chip"
      data-key={rowKey}
      data-kind={kind}
      className="ml-auto inline-flex min-w-0 max-w-[70%] items-center gap-1 h-[18px] rounded border border-teal-700 pl-1.5 pr-0.5 text-[10px] text-teal-300"
    >
      <svg aria-hidden="true" width="10" height="10" viewBox="0 0 10 10" className="shrink-0" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
        <circle cx="4" cy="4" r="2.8" />
        <path d="M6.2 6.2L9 9" />
      </svg>
      <span aria-hidden="true" data-testid="summary-trace-swatch" style={lookStyle(look)} className="h-2.5 w-2.5 shrink-0 rounded-[2px]" />
      <span data-testid="summary-trace-name" className="min-w-0 truncate">{name}</span>
      <button
        type="button"
        data-testid="summary-trace-clear"
        {...tipProps('Stop tracing')}
        onClick={onClear}
        className="shrink-0 inline-flex h-4 w-4 items-center justify-center rounded text-teal-300 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400"
      >
        <svg aria-hidden="true" width="8" height="8" viewBox="0 0 8 8">
          <path d="M1 1l6 6M7 1L1 7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
      </button>
    </span>
  )
}
