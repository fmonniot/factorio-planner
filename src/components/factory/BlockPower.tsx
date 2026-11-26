import { useMemo, useState } from 'react'
import { Icon } from '../Icon'
import { Segmented, Segment } from '../SegmentedControl'
import { fmtPower } from './ItemTile'
import {
  barPercent, flattenPowerRows, gaugeGeometry, initialExpanded, sharePercentText,
} from './powerOverview'
import type { PowerLine, PowerListRow, PowerOverview } from './powerOverview'

// ---------------------------------------------------------------------------
// Power view — the third view of the Block graph modal: what each block draws, against what the power plant makes.
// ---------------------------------------------------------------------------

const text = (kw: number): string => {
  const p = fmtPower(kw)
  return p.value + p.unit
}

const GRID = 'grid grid-cols-[minmax(260px,1.5fr)_80px_minmax(120px,1fr)_90px_60px] items-center gap-2 px-3'

/** Demand, generation and what is left, in the modal's header. */
export function PowerFigures({ model }: { model: PowerOverview }) {
  return (
    <div data-testid="power-figures" className="ml-auto flex gap-4 text-xs font-mono text-gray-400">
      <span>Demand <b className="text-gray-100" data-testid="power-demand">{text(model.demandKw)}</b></span>
      <span>Generation <b className="text-gray-100" data-testid="power-generation">{text(model.generationKw)}</b></span>
      <span data-testid="power-balance" data-status={model.status}>
        {model.status === 'short' && <b className="text-amber-400">{text(-model.balanceKw)} short</b>}
        {model.status === 'spare' && <b className="text-teal-400">+{text(model.balanceKw)} spare</b>}
        {model.status === 'balanced' && <b className="text-teal-400">Balanced</b>}
      </span>
    </div>
  )
}

function PowerCell({ kw }: { kw: number }) {
  if (kw <= 0) return <span className="text-right font-mono text-xs text-gray-400">–</span>
  const p = fmtPower(kw)
  return (
    <span className="text-right font-mono text-xs text-cyan-300 tabular-nums">
      {p.value}<span className="opacity-60">{p.unit}</span>
    </span>
  )
}

function Dot({ color }: { color: string }) {
  return <span aria-hidden className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: color }} />
}

function RecipeIcon({ iconPath, name }: { iconPath?: string; name: string }) {
  return iconPath ? (
    <Icon iconPath={iconPath} alt="" className="w-[22px] h-[22px] object-contain shrink-0" />
  ) : (
    <span aria-hidden className="w-[22px] h-[22px] shrink-0 rounded bg-gray-800 text-[9px] text-gray-400 flex items-center justify-center leading-none select-none">
      {name.substring(0, 2).toUpperCase()}
    </span>
  )
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg aria-hidden width="10" height="10" viewBox="0 0 10 10" className={`transition-transform ${open ? 'rotate-90' : ''}`}>
      <path d="M3 1.5 6.5 5 3 8.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  )
}

function Cells({ machines, kw, maxKw, demandKw, color, faded }: {
  machines: number; kw: number; maxKw: number; demandKw: number; color: string; faded: boolean
}) {
  return (
    <>
      <span className="text-right font-mono text-xs text-gray-300 tabular-nums">{machines > 0 ? machines : '–'}</span>
      <span className="h-2 rounded bg-gray-800">
        <span
          className={`block h-full rounded ${faded ? 'opacity-55' : ''}`}
          style={{ width: `${barPercent(kw, maxKw)}%`, background: color }}
        />
      </span>
      <PowerCell kw={kw} />
      <span className="text-right font-mono text-xs text-gray-400">{sharePercentText(kw, demandKw)}</span>
    </>
  )
}

function BlockRows({ row, maxKw, demandKw, onToggle }: {
  row: PowerListRow; maxKw: number; demandKw: number; onToggle: (key: string) => void
}) {
  const { entry } = row
  const isBlock = entry.kind === 'block'
  return (
    <div
      role="row"
      data-testid="power-row"
      data-kind={entry.kind}
      data-key={entry.key}
      data-block-id={row.blockId}
      data-power-kw={entry.powerKw}
      data-expanded={row.expandable ? String(row.expanded) : undefined}
      className={`${GRID} h-[34px] border-b border-gray-800 text-[13px] ${isBlock ? 'bg-gray-800/40' : ''} ${isBlock && entry.powerKw <= 0 ? 'opacity-60' : ''}`}
    >
      <div role="cell" className="flex items-center gap-2 min-w-0" style={{ paddingLeft: row.depth * 18 }}>
        {row.expandable ? (
          <button
            type="button"
            aria-expanded={row.expanded}
            aria-label={`${row.expanded ? 'Collapse' : 'Expand'} ${entry.name}`}
            onClick={() => onToggle(entry.key)}
            className="group flex items-center gap-2 min-w-0 text-left"
          >
            <span className="w-4 h-4 shrink-0 flex items-center justify-center text-gray-400"><Chevron open={row.expanded} /></span>
            <RowName row={row} />
          </button>
        ) : (
          <>
            <span className="w-4 shrink-0" />
            <RowName row={row} />
          </>
        )}
        {entry.kind === 'block' && entry.unreliable && (
          <span
            data-testid="power-unreliable"
            data-tip="This block's solve is not reliable: its figures may be off"
            className="text-amber-400 font-bold shrink-0"
          >
            !
          </span>
        )}
      </div>
      <Cells
        machines={entry.machines}
        kw={entry.powerKw}
        maxKw={maxKw}
        demandKw={demandKw}
        color={row.color}
        faded={!isBlock}
      />
    </div>
  )
}

function RowName({ row }: { row: PowerListRow }) {
  const { entry } = row
  if (entry.kind === 'block') {
    return (
      <>
        <Dot color={entry.color} />
        {entry.iconPath && <Icon iconPath={entry.iconPath} alt="" className="w-[22px] h-[22px] object-contain shrink-0" />}
        <span className="font-semibold truncate group-hover:underline">{entry.name}</span>
      </>
    )
  }
  if (entry.kind === 'recipe') {
    return (
      <>
        <RecipeIcon iconPath={entry.iconPath} name={entry.name} />
        <span className="truncate">{entry.name}</span>
      </>
    )
  }
  return <span className="truncate group-hover:underline">{entry.name}</span>
}

function LineRow({ line, maxKw, demandKw }: { line: PowerLine; maxKw: number; demandKw: number }) {
  return (
    <div
      role="row"
      data-testid="power-row"
      data-kind="recipe"
      data-key={line.key}
      data-block-id={line.blockId}
      data-power-kw={line.powerKw}
      className={`${GRID} h-[34px] border-b border-gray-800 text-[13px]`}
    >
      <div role="cell" className="flex items-center gap-2 min-w-0">
        <span className="w-4 shrink-0" />
        <RecipeIcon iconPath={line.iconPath} name={line.name} />
        <span className="truncate">{line.name}</span>
        <span className="inline-flex items-center gap-1.5 text-xs text-gray-300 min-w-0">
          <Dot color={line.blockColor} />
          <span className="truncate">{line.blockName}</span>
        </span>
      </div>
      <Cells machines={line.machines} kw={line.powerKw} maxKw={maxKw} demandKw={demandKw} color={line.blockColor} faded={false} />
    </div>
  )
}

function Gauge({ model }: { model: PowerOverview }) {
  const g = useMemo(() => gaugeGeometry(model), [model])
  const pct = (f: number) => `${f * 100}%`
  const generationColor = model.status === 'short' ? 'text-amber-400' : model.status === 'spare' ? 'text-teal-400' : 'text-gray-200'
  return (
    <div
      data-testid="power-gauge"
      role="img"
      aria-label={`Demand ${text(model.demandKw)}, generation ${text(model.generationKw)}`}
      className="relative w-[190px] shrink-0 flex flex-col max-md:w-full max-md:h-56"
    >
      <div className="relative flex-1 min-h-[16rem] max-md:min-h-0">
        <div className="absolute bottom-0 top-0 left-0 w-16 flex flex-col-reverse">
          {g.segments.map(s => (
            <div
              key={s.blockId}
              data-testid="power-gauge-segment"
              data-block-id={s.blockId}
              data-tip={`${s.name} ${text(s.powerKw)}`}
              className="border-t border-gray-900"
              style={{ height: pct(s.height), background: s.color }}
            />
          ))}
        </div>
        <div
          data-testid="power-gauge-generation"
          className="absolute bottom-0 left-[126px] w-16 bg-yellow-400"
          style={{ height: pct(g.generation) }}
        />
        {g.short && (
          <div
            data-testid="power-gauge-short"
            className="absolute left-[126px] w-16 rounded-sm border border-amber-400"
            style={{
              bottom: pct(g.short.bottom),
              height: pct(g.short.height),
              backgroundImage: 'repeating-linear-gradient(135deg, rgba(251,191,36,.9) 0 5px, rgba(251,191,36,.25) 5px 10px)',
            }}
          />
        )}
        {g.spare && (
          <div
            data-testid="power-gauge-spare"
            className="absolute left-[126px] w-16 rounded-sm border-[1.5px] border-dashed border-teal-400 bg-teal-400/10"
            style={{ bottom: pct(g.spare.bottom), height: pct(g.spare.height) }}
          />
        )}
        <div
          data-testid="power-gauge-line"
          className="absolute inset-x-0 border-t-[1.5px] border-dashed border-gray-200"
          style={{ bottom: pct(g.demand) }}
        >
          <span className="absolute left-[68px] translate-y-1/2 bottom-0 bg-gray-900 px-1 text-[11.5px] font-mono text-gray-200 whitespace-nowrap">
            {text(model.demandKw)}
          </span>
        </div>
        <span
          className={`absolute left-[113px] w-[90px] text-center text-xs font-mono ${generationColor}`}
          style={{ bottom: `calc(${g.generationLabelBottom * 100}% + 4px)` }}
        >
          {text(model.generationKw)}
        </span>
      </div>
      <div className="relative h-[34px]">
        <span className="absolute bottom-2 left-[-13px] w-[90px] text-center text-xs text-gray-300">Demand</span>
        <span className="absolute bottom-2 left-[113px] w-[90px] text-center text-xs text-gray-300">Generation</span>
      </div>
    </div>
  )
}

type Mode = 'block' | 'recipe'

export function BlockPower({ model }: { model: PowerOverview }) {
  const [mode, setMode] = useState<Mode>('block')
  const [query, setQuery] = useState('')
  // Until a row is toggled the open rows follow the model (the first block opens once its solve arrives).
  const [chosen, setChosen] = useState<Set<string> | undefined>(undefined)
  const expanded = useMemo(() => chosen ?? initialExpanded(model), [chosen, model])

  const rows = useMemo(() => flattenPowerRows(model.blocks, expanded), [model.blocks, expanded])
  const q = query.trim().toLowerCase()
  const lines = useMemo(
    () => (q === '' ? model.lines : model.lines.filter(l => l.name.toLowerCase().includes(q) || l.blockName.toLowerCase().includes(q))),
    [model.lines, q],
  )

  function toggle(key: string) {
    const next = new Set(expanded)
    if (!next.delete(key)) next.add(key)
    setChosen(next)
  }

  const maxKw = mode === 'block' ? (model.blocks[0]?.powerKw ?? 0) : (model.lines[0]?.powerKw ?? 0)
  const emptyText = model.lines.length === 0 && q === '' ? 'No recipe draws power yet.' : 'No recipe or block matches what you typed.'

  return (
    <div data-testid="power-view" className="flex flex-1 min-h-0 gap-6 px-5 py-3.5 max-md:flex-col max-md:overflow-auto">
      <div className="flex-1 min-w-0 flex flex-col min-h-0">
        <div className="flex items-center gap-3 mb-2.5">
          <Segmented label="List" size="sm">
            <Segment pressed={mode === 'block'} onClick={() => setMode('block')}>By block</Segment>
            <Segment pressed={mode === 'recipe'} onClick={() => setMode('recipe')}>By recipe</Segment>
          </Segmented>
          <span className="text-xs text-gray-400">
            {mode === 'block'
              ? 'Sorted by power. Expand a block to see its groups and recipes.'
              : 'Every recipe that draws power, biggest first.'}
          </span>
          {mode === 'recipe' && (
            <label className="ml-auto">
              <span className="sr-only">Filter by recipe or block</span>
              <input
                type="search"
                data-testid="power-filter"
                placeholder="Filter by recipe or block"
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Escape' && query !== '') {
                    e.preventDefault()
                    e.stopPropagation()
                    setQuery('')
                  }
                }}
                className="w-[230px] h-[26px] box-border rounded-md bg-gray-950 border border-gray-700 text-gray-100 text-xs px-2.5 placeholder:text-gray-400 [&::-webkit-search-cancel-button]:appearance-none"
              />
            </label>
          )}
        </div>

        {model.skipped.length > 0 && (
          <p data-testid="power-skipped" className="text-xs text-gray-400 mb-2">
            Not counted (no solve result): {model.skipped.map(s => s.name + (s.reason === 'error' ? ' (solve failed)' : '')).join(', ')}
          </p>
        )}

        <div className="flex-1 min-h-0 overflow-auto rounded-lg border border-gray-800">
          <div role="table" aria-label={mode === 'block' ? 'Power by block' : 'Power by recipe'}>
            <div
              role="row"
              className={`${GRID} h-[30px] sticky top-0 z-10 bg-gray-950 border-b border-gray-800 text-[11.5px] text-gray-400`}
            >
              <span role="columnheader">{mode === 'block' ? 'Block' : 'Recipe'}</span>
              <span role="columnheader" className="text-right">Machines</span>
              <span role="columnheader">Weight</span>
              <span role="columnheader" className="text-right">Power</span>
              <span role="columnheader" className="text-right">Share</span>
            </div>
            {mode === 'block'
              ? rows.map(r => <BlockRows key={r.entry.key} row={r} maxKw={maxKw} demandKw={model.demandKw} onToggle={toggle} />)
              : lines.map(l => <LineRow key={l.key} line={l} maxKw={maxKw} demandKw={model.demandKw} />)}
            {mode === 'recipe' && lines.length === 0 && (
              <div role="row" className="px-3 py-4 text-[13px] text-gray-400">
                <span role="cell">{emptyText}</span>
              </div>
            )}
          </div>
        </div>
      </div>
      <Gauge model={model} />
    </div>
  )
}
