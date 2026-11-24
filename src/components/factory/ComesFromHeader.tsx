import { Icon } from '../Icon'
import { fmtItemRate } from './ItemTile'
import type { RateUnit } from '../../store/uiStore'

// ---------------------------------------------------------------------------
// ComesFromHeader — the head of the Comes from control in its popover and in the Source rules list. The popover's has the item (icon
// and name), its scope control or subtitle, the item's need and Close; the embedded one (the Source rules
// row, which already names the item) has only the scope control or subtitle and the need.
// ---------------------------------------------------------------------------

export function ComesFromHeader({ titleId, item, subtitle, scope, need, itemId, unit, onClose }: {
  /** Id of the name, which the dialog is labelled by. */
  titleId?: string
  /** The item the popover is for; without it the header is the embedded one. */
  item?: { name: string; iconPath?: string }
  /** What the control applies to, drawn under the name (or on the left of the embedded header) when there is no scope control. */
  subtitle?: string
  /** The scope control, with its tooltip. */
  scope?: React.ReactNode
  /** items/min the rows use of the item; undefined before the first solve. */
  need: number | undefined
  itemId: string
  unit: RateUnit
  onClose?: () => void
}) {
  const rate = need !== undefined ? fmtItemRate(itemId, need / 60, unit) : undefined
  const left = scope ?? (subtitle !== undefined ? <div className="text-[11px] text-gray-400">{subtitle}</div> : null)
  return (
    <div data-testid="comes-from-header" className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        {item?.iconPath && <Icon iconPath={item.iconPath} alt="" className="w-6 h-6 object-contain shrink-0" />}
        <div className="min-w-0 flex-1 leading-tight">
          {item && <div id={titleId} className="text-[13px] font-semibold text-gray-100 truncate">{item.name}</div>}
          {!item && left}
          {item && scope === undefined && left}
        </div>
        {rate && (
          <span data-testid="comes-from-need" className="shrink-0 text-xs text-gray-300">
            need <span className="font-mono tabular-nums">{rate.value}</span>
            <span className="text-gray-400 text-[10px]">{rate.unit}</span>
          </span>
        )}
        {onClose && (
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="shrink-0 inline-flex text-gray-400 hover:text-gray-100 pl-1 outline-none focus-visible:ring-2 focus-visible:ring-teal-400 rounded"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
              <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        )}
      </div>
      {item && scope !== undefined && <div className="ml-8 min-w-0 overflow-x-auto">{scope}</div>}
    </div>
  )
}
