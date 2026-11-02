import { foldAxis, formatAverage, tileNeighbours } from './neighbourLayout'

// Fill / border per neighbour count (0–4). The number is always drawn too, so
// colour is never the only signal.
const TILE_COLORS = [
  { fill: '#1f2937', border: '#374151' },
  { fill: '#3b2a1d', border: '#6b4a2e' },
  { fill: '#5c3a1c', border: '#8a5a2a' },
  { fill: '#7f4a16', border: '#b06a22' },
  { fill: '#a8530f', border: '#fb923c' },
]

const TILE = 40
const GAP_TRACK = 20

interface NeighbourGridProps {
  cols: number
  rows: number
  /** Average of the full drawing, for the accessible name. */
  average: number
  /** The player typed their own average; the drawing is not used. */
  dimmed: boolean
}

export function NeighbourGrid({ cols, rows, average, dimmed }: NeighbourGridProps) {
  const colTracks = foldAxis(cols)
  const rowTracks = foldAxis(rows)
  const track = (t: number) => `${t < 0 ? GAP_TRACK : TILE}px`

  return (
    <div className="relative h-[264px] flex items-center justify-center overflow-hidden rounded-md border border-dashed border-gray-700 bg-[#0d1320]">
      <div
        data-testid="neighbour-grid"
        role="img"
        aria-label={`${cols} by ${rows} cluster, ${formatAverage(average)} neighbours on average`}
        className={`grid gap-1 ${dimmed ? 'opacity-30' : ''}`}
        style={{
          gridTemplateColumns: colTracks.map(track).join(' '),
          gridTemplateRows: rowTracks.map(track).join(' '),
        }}
      >
        {rowTracks.flatMap(r =>
          colTracks.map(c => {
            const key = `${r}:${c}`
            if (r < 0 || c < 0) {
              const mark = r < 0 && c < 0 ? '⋱' : c < 0 ? '⋯' : '⋮'
              return (
                <div key={key} aria-hidden="true" className="flex items-center justify-center text-base text-gray-400">
                  {mark}
                </div>
              )
            }
            // Numbers come from the real positions, not the folded ones.
            const n = tileNeighbours(c, r, cols, rows)
            const { fill, border } = TILE_COLORS[n]
            return (
              <div
                key={key}
                data-neighbours={n}
                className="flex items-center justify-center rounded text-[15px] font-bold tabular-nums"
                style={{ background: fill, border: `1px solid ${border}`, color: '#fff7ed' }}
              >
                {n}
              </div>
            )
          }),
        )}
      </div>
      {dimmed && (
        <div className="absolute inset-x-0 bottom-0 border-t border-gray-700 bg-gray-950/90 px-2 py-1.5 text-[11px] text-gray-300">
          Not used: you typed your own average below.
        </div>
      )}
    </div>
  )
}
