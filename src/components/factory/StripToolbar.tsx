import { TipWrap } from '../TipWrap'
import { StripIcon } from './StripIcon'
import type { StripIconName } from './StripIcon'

export interface StripAction {
  /** Stable React key and test handle, for an action whose label changes while it stays open (default: the label). */
  id?: string
  /** The action's name: the button's accessible name (with the badge, see below) and, unless `title` says more, its tooltip. */
  label: string
  icon: StripIconName
  /** Which cluster the button sits in: `left` makes or supplies the item, `right` (after the spacer) informs, then changes the block. Default `right`. */
  side?: 'left' | 'right'
  /** Drawn joined to the previous button of the same cluster: one pair with a shared border (Move earlier, Move later). */
  joined?: boolean
  /** A count drawn as a small chip on the icon's top right corner; the accessible name becomes `${label} · ${badge.count} ${badge.noun}`. */
  badge?: { count: number; noun: string }
  onSelect: (e: React.MouseEvent<HTMLButtonElement>) => void
  danger?: boolean
  disabled?: boolean
  /** `data-testid` of the button, for an action a test already reaches by id (Sources…). */
  testId?: string
  /** `aria-haspopup` of an action that opens a dialog. */
  hasPopup?: 'dialog' | 'menu'
  /** Shown as the instant tooltip (`data-tip`) in place of the name; on a disabled action it says why. */
  title?: string
  /** Dimmed and inert but still focusable and described (`aria-disabled`): a move at the end of its list, an action that says why it cannot run. The tooltip stays (`title`). */
  ariaDisabled?: boolean
  /** `aria-expanded` of an action that opens something in place (the Sources list). It reads lit while open. */
  expanded?: boolean
  /** `aria-controls` of an action that opens something in place. */
  controls?: string
  /** `aria-describedby` of the action: the id of the text that says what it acts on (a line of the Sources list). */
  describedBy?: string
}

const BUTTON = 'relative inline-flex h-[22px] w-6 shrink-0 items-center justify-center border border-gray-700 bg-gray-900 hover:border-gray-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400 disabled:opacity-40 disabled:pointer-events-none disabled:cursor-default disabled:hover:border-gray-700 aria-disabled:opacity-40 aria-disabled:cursor-default aria-disabled:hover:border-gray-700 aria-expanded:border-teal-600 aria-expanded:bg-teal-900/60 aria-expanded:text-teal-200'

function ActionButton({ action, position }: { action: StripAction; position: 'alone' | 'first' | 'middle' | 'last' }) {
  const name = action.badge ? `${action.label} · ${action.badge.count} ${action.badge.noun}` : action.label
  const tip = action.title ?? name
  // A pair shares its inner border: the first loses its right one, and only the outer corners are round.
  const shape = position === 'alone' ? 'rounded' : position === 'first' ? 'rounded-l border-r-0' : position === 'last' ? 'rounded-r' : 'border-r-0'
  const button = (
    <button
      type="button"
      onClick={action.ariaDisabled ? undefined : action.onSelect}
      disabled={action.disabled}
      data-tip={action.disabled ? undefined : tip}
      aria-label={name}
      aria-haspopup={action.hasPopup}
      aria-disabled={action.ariaDisabled}
      aria-expanded={action.expanded}
      aria-controls={action.controls}
      aria-describedby={action.describedBy}
      data-testid={action.testId}
      className={`${BUTTON} ${shape} ${action.danger ? 'text-red-400' : 'text-gray-300'}`}
    >
      <StripIcon name={action.icon} />
      {action.badge && (
        <span aria-hidden="true" data-testid="strip-action-badge" className="absolute -right-[5px] -top-[5px] rounded bg-amber-900 px-[3px] text-[10px] leading-3 text-amber-300">{action.badge.count}</span>
      )}
    </button>
  )
  // A natively disabled button gets no pointer events in Firefox and Safari: the tip sits on a wrapper.
  return action.disabled ? <TipWrap tip={tip}>{button}</TipWrap> : button
}

/** Draws a cluster of icon buttons, joined ones as one group: the toolbar's, and the controls of a line of the Sources list. */
export function Cluster({ actions }: { actions: StripAction[] }) {
  const groups: StripAction[][] = []
  for (const a of actions) {
    if (a.joined && groups.length > 0) groups[groups.length - 1].push(a)
    else groups.push([a])
  }
  return (
    <>
      {groups.map(group => (
        <span key={group[0].id ?? group[0].label} className="inline-flex shrink-0">
          {group.map((a, i) => (
            <ActionButton
              key={a.id ?? a.label}
              action={a}
              position={group.length === 1 ? 'alone' : i === 0 ? 'first' : i === group.length - 1 ? 'last' : 'middle'}
            />
          ))}
        </span>
      ))}
    </>
  )
}

export const Separator = () => <span aria-hidden="true" className="h-4 w-px shrink-0 bg-gray-700" />

/**
 * The one row of icon buttons under a selected strip: 22 px high, 24 × 22 px buttons 4 px apart, no text, never
 * wrapping. The left cluster makes or supplies the item; after the spacer come information, then changes to the block.
 * `middle` is a group between the two (the Ingredients rule group), set off by a separator.
 */
export function StripToolbar({ actions, middle }: { actions: StripAction[]; middle?: React.ReactNode }) {
  const left = actions.filter(a => a.side === 'left')
  const right = actions.filter(a => a.side !== 'left')
  return (
    <div data-testid="strip-toolbar" className="flex items-center gap-1 shrink-0 h-[22px]">
      <Cluster actions={left} />
      {middle && (
        <>
          {left.length > 0 && <Separator />}
          {middle}
        </>
      )}
      <span className="flex-1 min-w-0" />
      <Cluster actions={right} />
    </div>
  )
}
