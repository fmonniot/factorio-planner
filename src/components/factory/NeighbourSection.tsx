import { useState } from 'react'
import { useBlockStore } from '../../store/blockStore'
import { NeighbourGrid } from './NeighbourGrid'
import { MAX_SIDE, findRectangle, formatAverage, rectangleAverage } from './neighbourLayout'

const EPSILON = 1e-9
const MAX_NEIGHBOURS = 4

function fmtMultiplier(x: number): string {
  return String(Number(x.toFixed(2)))
}

/** `null` when the text is not a number in 0–4. */
function parseOwn(text: string): number | null {
  if (text.trim() === '') return null
  const v = Number(text)
  return Number.isFinite(v) && v >= 0 && v <= MAX_NEIGHBOURS ? v : null
}

interface Layout {
  cols: number
  rows: number
  /** Text typed in the escape-hatch field; `null` while the drawing is used. */
  own: string | null
}

/** The drawing (or own average) that stands for a stored count. */
function deriveLayout(count: number | undefined): Layout {
  const rect = findRectangle(count ?? 0)
  if (rect) return { ...rect, own: null }
  return { cols: 1, rows: 1, own: String(count) }
}

function clampSide(n: number): number {
  return Math.min(MAX_SIDE, Math.max(1, n))
}

interface NeighbourSectionProps {
  nodeId: string
  neighbourCount: number | undefined
  neighbourBonus: number
}

export function NeighbourSection({ nodeId, neighbourCount, neighbourBonus }: NeighbourSectionProps) {
  const updateNodeNeighbourCount = useBlockStore(s => s.updateNodeNeighbourCount)
  const stored = neighbourCount ?? 0

  const [initial] = useState(() => deriveLayout(neighbourCount))
  const [cols, setCols] = useState(initial.cols)
  const [rows, setRows] = useState(initial.rows)
  const [colsText, setColsText] = useState(String(initial.cols))
  const [rowsText, setRowsText] = useState(String(initial.rows))
  const [own, setOwn] = useState<string | null>(initial.own)

  const drawingAverage = rectangleAverage(cols, rows)
  const ownValue = own === null ? null : parseOwn(own)

  // Re-derive the state when the stored count changes under us (undo/redo, a recipe
  // switch that drops it), unless what is displayed already equals it, so in-progress
  // text such as "2." is not clobbered.
  const [prevCount, setPrevCount] = useState(neighbourCount)
  if (prevCount !== neighbourCount) {
    setPrevCount(neighbourCount)
    const shown = own === null ? drawingAverage : (ownValue ?? Number.NaN)
    if (!(Math.abs(shown - stored) <= EPSILON)) {
      const next = deriveLayout(neighbourCount)
      setCols(next.cols)
      setRows(next.rows)
      setColsText(String(next.cols))
      setRowsText(String(next.rows))
      setOwn(next.own)
    }
  }

  function applyDrawing(nextCols: number, nextRows: number) {
    setCols(nextCols)
    setRows(nextRows)
    setColsText(String(nextCols))
    setRowsText(String(nextRows))
    setOwn(null)
    updateNodeNeighbourCount(nodeId, rectangleAverage(nextCols, nextRows))
  }

  function typeSide(axis: 'cols' | 'rows', text: string) {
    const v = Number(text)
    if (text.trim() !== '' && Number.isInteger(v)) {
      const side = clampSide(v)
      applyDrawing(axis === 'cols' ? side : cols, axis === 'rows' ? side : rows)
    } else if (axis === 'cols') setColsText(text)
    else setRowsText(text)
  }

  function typeOwn(text: string) {
    setOwn(text)
    const v = parseOwn(text)
    if (v !== null) updateNodeNeighbourCount(nodeId, v)
  }

  function blurOwn() {
    if (own === null || ownValue !== null) return
    if (Math.abs(stored - drawingAverage) <= EPSILON) setOwn(null)
    else setOwn(String(stored))
  }

  const ownInvalid = own !== null && own.trim() !== '' && ownValue === null
  const ownInUse = own !== null && ownValue !== null
  const average = own === null ? drawingAverage : (ownValue ?? stored)
  const shownOwn = own ?? formatAverage(drawingAverage)

  const ownBorder = ownInvalid
    ? 'border-amber-400'
    : ownInUse
      ? 'border-[#fb923c]'
      : 'border-gray-700 focus:border-gray-500'

  return (
    <div data-testid="neighbour-section" className="whitespace-normal">
      <label htmlFor="neighbour-cols" className="text-[10px] uppercase tracking-wide text-gray-400 mb-1.5 block">
        Neighbours
      </label>
      <p className="text-xs text-gray-300 mb-3">
        Draw one cluster of reactors that touch each other. The planner uses the average number of neighbours per reactor.
      </p>

      <div className="flex gap-4">
        <div className="w-[148px] shrink-0 flex flex-col gap-3.5">
          <Stepper
            label="Wide"
            id="neighbour-cols"
            value={cols}
            text={colsText}
            onText={t => typeSide('cols', t)}
            onBlur={() => setColsText(String(cols))}
            onStep={d => applyDrawing(clampSide(cols + d), rows)}
            minusName="Fewer columns"
            plusName="More columns"
          />
          <Stepper
            label="Deep"
            id="neighbour-rows"
            value={rows}
            text={rowsText}
            onText={t => typeSide('rows', t)}
            onBlur={() => setRowsText(String(rows))}
            onStep={d => applyDrawing(cols, clampSide(rows + d))}
            minusName="Fewer rows"
            plusName="More rows"
          />
          <p className="text-xs text-gray-400">{cols * rows} reactors in this cluster</p>
        </div>
        <div className="flex-1 min-w-0">
          <NeighbourGrid cols={cols} rows={rows} average={drawingAverage} dimmed={own !== null} />
        </div>
      </div>

      <p className="text-[11px] text-gray-400 mt-2">
        Each number is how many reactors share a side with that one. Diagonals don't count, and only working reactors do.
      </p>

      <div className="border-t border-gray-800 mt-3 pt-3">
        <div className="flex items-center gap-3">
          <label htmlFor="neighbour-count" className="flex-1 text-xs text-gray-300">
            <b className="font-semibold text-gray-200">Not a rectangle?</b> Type the average number of neighbours instead.
          </label>
          <input
            id="neighbour-count"
            data-testid="neighbour-count"
            type="number"
            min="0"
            max={MAX_NEIGHBOURS}
            step="any"
            aria-label="Neighbouring reactors"
            value={shownOwn}
            onChange={e => typeOwn(e.target.value)}
            onBlur={blurOwn}
            className={`w-[72px] h-10 shrink-0 bg-gray-800 border ${ownBorder} text-gray-200 rounded-md px-2 text-sm text-right tabular-nums outline-none`}
          />
        </div>
        {ownInvalid && (
          <p className="text-xs text-amber-400 mt-1.5">A reactor has four sides, so use a number from 0 to 4.</p>
        )}
        {ownInUse && (
          <p className="text-xs text-gray-400 mt-1.5">
            Change the size above to use the drawing again.
            <button
              type="button"
              onClick={() => applyDrawing(cols, rows)}
              className="ml-1.5 text-orange-400 hover:text-orange-300 underline"
            >
              Use the drawing
            </button>
          </p>
        )}
      </div>

      <div className="flex items-stretch bg-gray-800 rounded-md px-3.5 py-2.5 mt-3">
        <Stat label="Average" value={formatAverage(average)} />
        <div className="w-px bg-gray-700 mx-3.5" />
        <Stat label="Each neighbour adds" value={`+${Math.round(neighbourBonus * 100)} %`} />
        <div className="w-px bg-gray-700 mx-3.5" />
        <Stat
          label="Heat per reactor"
          value={`×${fmtMultiplier(1 + neighbourBonus * average)}`}
          testId="neighbour-multiplier"
          valueClass="text-orange-400"
        />
      </div>
    </div>
  )
}

function Stat({ label, value, testId, valueClass = 'text-gray-100' }: {
  label: string
  value: string
  testId?: string
  valueClass?: string
}) {
  return (
    <div className="flex-1 min-w-0">
      <div data-testid={testId} className={`text-xl font-semibold tabular-nums ${valueClass}`}>{value}</div>
      <div className="text-[11px] text-gray-400 whitespace-nowrap">{label}</div>
    </div>
  )
}

interface StepperProps {
  label: string
  id: string
  value: number
  text: string
  onText: (text: string) => void
  onBlur: () => void
  onStep: (delta: number) => void
  minusName: string
  plusName: string
}

function Stepper({ label, id, value, text, onText, onBlur, onStep, minusName, plusName }: StepperProps) {
  const button =
    'w-10 h-10 shrink-0 bg-gray-800 border border-gray-700 rounded-md text-gray-200 text-lg leading-none hover:bg-gray-700 disabled:opacity-40 disabled:hover:bg-gray-800'
  return (
    <div>
      <label htmlFor={id} className="text-xs text-gray-300 block mb-1">{label}</label>
      <div className="flex items-center gap-1">
        <button type="button" aria-label={minusName} disabled={value <= 1} onClick={() => onStep(-1)} className={button}>
          −
        </button>
        <input
          id={id}
          data-testid={id}
          type="number"
          min="1"
          max={MAX_SIDE}
          step="1"
          value={text}
          onChange={e => onText(e.target.value)}
          onBlur={onBlur}
          className="w-12 h-10 bg-gray-800 border border-gray-700 text-gray-200 rounded-md px-1.5 text-sm text-right tabular-nums outline-none focus:border-gray-500"
        />
        <button type="button" aria-label={plusName} disabled={value >= MAX_SIDE} onClick={() => onStep(1)} className={button}>
          +
        </button>
      </div>
    </div>
  )
}
