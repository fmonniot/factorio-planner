import { createPortal } from 'react-dom'
import type { GameData, SolvedArea } from '../../data/types'
import type { RateUnit } from '../../store/uiStore'
import { useHoverPopup } from '../useHoverPopup'
import { FlowChip } from './AreasPane'

// ---------------------------------------------------------------------------
// AreaChipsMore — the "+N" of a collapsed area row: a button that opens a popup
// listing the flows the row has no room for. Rendered in a portal: the
// production table scrolls and would clip it.
// ---------------------------------------------------------------------------

interface AreaChipsMoreProps {
  /** The hidden flows only. */
  flows: SolvedArea['receives']
  direction: 'receives' | 'sends'
  items: GameData['items']
  rateUnit: RateUnit
}

export function AreaChipsMore({ flows, direction, items, rateUnit }: AreaChipsMoreProps) {
  const { open, triggerProps, popupProps } = useHoverPopup<HTMLButtonElement>()
  if (flows.length === 0) return null
  const received = direction === 'receives'
  return (
    <>
      <button
        type="button"
        data-testid="area-chips-more"
        aria-label={`${flows.length} more ${received ? 'received' : 'sent'} items`}
        className="text-[10px] text-gray-500 hover:text-gray-300"
        {...triggerProps}
      >
        +{flows.length}
      </button>
      {open && createPortal(
        <div
          {...popupProps}
          data-testid="area-chips-popup"
          data-direction={direction}
          className="z-[60] w-max max-w-xs max-h-[60vh] overflow-y-auto p-2 text-xs bg-gray-900 border border-gray-700 rounded-lg shadow-2xl"
        >
          <div className="mb-1 text-gray-400">{received ? 'Also receives' : 'Also sends'}</div>
          <ul className="flex flex-col gap-1">
            {flows.map(f => (
              <li key={f.itemId} className="flex items-center gap-2">
                <FlowChip {...f} direction={direction} items={items} rateUnit={rateUnit} />
                <span className="truncate text-gray-200">{items[f.itemId]?.name ?? f.itemId}</span>
              </li>
            ))}
          </ul>
        </div>,
        document.body,
      )}
    </>
  )
}
