import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Ref } from 'react'
import { createPortal } from 'react-dom'
import type { GameData } from '../../data/types'
import type { RateUnit } from '../../store/uiStore'
import { Icon } from '../Icon'
import { useHoverPopup } from '../useHoverPopup'
import { IconChip } from './IconChip'
import type { ChipTone } from './IconChip'
import { fmtChipQuantity, fmtItemRateText } from './ItemTile'
import { lineChipFit, lineRate } from './lineChipFit'
import type { SlotModel, SummaryPaneKind } from './summarySegments'

// ---------------------------------------------------------------------------
// SummaryLine — the collapsed summary: one line per pane with its item count, as many
// item chips (the table's) as fit and a "+N" that lists every item with its rate. A Products
// chip shows the product's goal, with the actual in its tooltip. Informational:
// nothing here selects an item. From `md` the three lines share one row with the Expand
// button; below it they stack and the handle row under the strip expands.
// ---------------------------------------------------------------------------

export interface SummaryLinePane {
  pane: SummaryPaneKind
  label: string
  slots: SlotModel[]
}

interface SummaryLineProps {
  panes: SummaryLinePane[]
  items: GameData['items']
  rateUnit: RateUnit
  onExpand: () => void
  /** The Expand button, so the owner can move focus to it after a collapse. */
  expandRef?: Ref<HTMLButtonElement>
}

/** Colour of an item's rate in the list, as in the table's product, byproduct and ingredient chips. */
const RATE_TONE: Record<SummaryPaneKind, string> = {
  products: 'text-gray-200',
  byproducts: 'text-red-300',
  ingredients: 'text-green-300',
}

/** The width of an element's content box, kept current. 0 until measured (and where there is no layout). */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    if (ref.current) setWidth(ref.current.clientWidth)
  }, [])
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => setWidth(el.clientWidth))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  return { ref, width }
}

const CHIP_TONE: Record<SummaryPaneKind, Exclude<ChipTone, 'neutral'>> = {
  products: 'product',
  byproducts: 'byproduct',
  ingredients: 'ingredient',
}

function LineChip({ pane, slot, items, rateUnit }: { pane: SummaryPaneKind; slot: SlotModel; items: GameData['items']; rateUnit: RateUnit }) {
  const item = items[slot.itemId]
  const name = item?.name ?? slot.itemId
  const { shown, actual, short, hasGoal } = lineRate(pane, slot)
  const text = (perMin: number) => fmtItemRateText(slot.itemId, perMin / 60, rateUnit)
  const title = slot.empty
    ? `${name} — nothing requested yet`
    : actual !== undefined
      ? `${name} — goal ${text(shown)}${text(actual) === text(shown) ? '' : `, making ${text(actual)}`}${short ? `, short by ${text(shown - actual)}` : ''}`
      : hasGoal
        ? `${name} — goal ${text(shown)}`
        : `${name} — ${text(shown)}`
  return (
    <IconChip
      iconPath={item?.iconPath || undefined}
      alt={name}
      fallback={name}
      quantity={slot.empty ? '—' : fmtChipQuantity(slot.itemId, shown / 60, rateUnit)}
      quantityTestId="summary-line-quantity"
      tone={CHIP_TONE[pane]}
      warn={short}
      title={title}
      role="img"
      aria-label={title}
      badges={short ? <span aria-hidden className="text-[9px] leading-none text-amber-400" style={{ textShadow: '0 0 2px #000, 0 0 2px #000' }}>▼</span> : undefined}
      className={`mr-1.5${slot.dimmed ? ' opacity-55' : ''}`}
      data-testid="summary-line-chip"
      data-item-id={slot.itemId}
      data-status={short ? 'short' : undefined}
    />
  )
}

/** The "+N": hover, focus or click opens the list of every item of the pane with its rate. Informational. */
function LineMore({ pane, label, slots, hiddenCount, items, rateUnit }: {
  pane: SummaryPaneKind
  label: string
  slots: SlotModel[]
  hiddenCount: number
  items: GameData['items']
  rateUnit: RateUnit
}) {
  const { open, triggerProps, popupProps } = useHoverPopup<HTMLButtonElement>()
  const noun = label.toLowerCase()
  return (
    <>
      <button
        type="button"
        data-testid="summary-line-more"
        aria-label={`Show all ${slots.length} ${noun}`}
        className="shrink-0 p-1 text-[11px] leading-none text-gray-400 hover:text-gray-200"
        {...triggerProps}
      >
        +{hiddenCount}
      </button>
      {open && createPortal(
        <div
          {...popupProps}
          data-testid="summary-line-popup"
          aria-label={`All ${slots.length} ${noun}`}
          onContextMenu={e => e.stopPropagation()}
          className="z-[60] w-[300px] max-h-[270px] overflow-y-auto px-2.5 py-2 bg-gray-900 border border-gray-700 rounded-lg shadow-2xl"
        >
          <div className="mb-1.5 text-[11px] text-gray-400">{`All ${slots.length} ${noun}`}</div>
          <ul>
            {slots.map(slot => {
              const item = items[slot.itemId]
              const name = item?.name ?? slot.itemId
              const { shown, actual, short } = lineRate(pane, slot)
              const text = (perMin: number) => fmtItemRateText(slot.itemId, perMin / 60, rateUnit)
              return (
                <li key={slot.id} data-item-id={slot.itemId} className="flex items-center gap-2 h-7 text-xs text-gray-300">
                  <span className="relative w-6 h-6 shrink-0">
                    {item?.iconPath && <Icon iconPath={item.iconPath} alt="" className="w-6 h-6 object-contain" />}
                  </span>
                  <span className="flex-1 min-w-0 truncate">{name}</span>
                  <span className={`font-mono tabular-nums text-[11px] ${RATE_TONE[pane]}`}>
                    {slot.empty ? '—' : text(shown)}
                    {actual !== undefined && (
                      <>
                        <span className="text-gray-400"> → </span>
                        <span data-testid="summary-line-popup-actual" className={short ? 'text-amber-400' : 'text-teal-400'}>
                          {short && '▼ '}{text(actual)}
                        </span>
                      </>
                    )}
                  </span>
                </li>
              )
            })}
          </ul>
        </div>,
        document.body,
      )}
    </>
  )
}

function LinePane({ pane, label, slots, items, rateUnit }: SummaryLinePane & { items: GameData['items']; rateUnit: RateUnit }) {
  const { ref, width } = useWidth<HTMLDivElement>()
  const shown = lineChipFit(width, slots.length)
  return (
    <section
      aria-label={label}
      data-testid="summary-line-pane"
      data-pane={pane}
      className="flex items-center gap-2 min-w-0 px-2 overflow-hidden h-[38px] shrink-0 max-md:border-b max-md:border-gray-800 max-md:last:border-b-0 md:flex-1 md:h-10"
    >
      <span className="text-[10px] uppercase tracking-[0.06em] text-gray-400 whitespace-nowrap">{label}</span>
      <span data-testid="summary-line-count" className="text-xs font-semibold text-gray-200 tabular-nums">{slots.length}</span>
      <div ref={ref} className="flex flex-1 min-w-0 items-center py-0.5">
        {slots.slice(0, shown).map(slot => <LineChip key={slot.id} pane={pane} slot={slot} items={items} rateUnit={rateUnit} />)}
        {shown < slots.length && (
          <LineMore pane={pane} label={label} slots={slots} hiddenCount={slots.length - shown} items={items} rateUnit={rateUnit} />
        )}
      </div>
    </section>
  )
}

export function SummaryLine({ panes, items, rateUnit, onExpand, expandRef }: SummaryLineProps) {
  return (
    <div
      data-testid="summary-line"
      className="flex max-md:flex-col md:items-start md:gap-2 box-border px-3 max-md:py-1 md:py-[9px] max-md:h-[123px] md:h-[58px] max-md:overflow-hidden border-b border-gray-700"
    >
      {panes.map(p => <LinePane key={p.pane} {...p} items={items} rateUnit={rateUnit} />)}
      {/* Below md the handle row under the strip expands instead. */}
      <button
        ref={expandRef}
        type="button"
        aria-label="Expand summary"
        onClick={onExpand}
        className="max-md:hidden shrink-0 self-center ml-auto w-[68px] min-h-[30px] py-1 text-xs text-gray-300 bg-gray-900 border border-gray-700 hover:border-gray-600 rounded-lg"
      >
        Expand
      </button>
    </div>
  )
}
