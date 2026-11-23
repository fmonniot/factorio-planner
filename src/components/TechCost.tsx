import { Icon } from './Icon'
import { describeTrigger, type TriggerLookup } from '../data/researchTrigger'
import type { Technology } from '../data/types'

interface TechCostProps {
  cost: Technology['cost']
  /** Names and icons for ingredients and trigger subjects. */
  lookup: TriggerLookup
  /** The research trigger, shown when `cost` is null. */
  trigger?: Technology['trigger']
  /** Trigger wording: the one-line condition (default) or the sentence form. */
  triggerText?: 'short' | 'full'
  /** Instant tooltip (`TooltipLayer`) with the full sentence on the trigger line; for lists with no hover popup. Default false. */
  tooltip?: boolean
  /** Append "· <time>s" after the count. Default true (tech-tree cards). */
  showTime?: boolean
  /** Append "×<count>" after the pack icons. Default true; false lists the pack types only. */
  showCount?: boolean
}

export function TechCost({ cost, lookup, trigger, triggerText = 'short', tooltip = false, showTime = true, showCount = true }: TechCostProps) {
  if (cost === undefined) return null
  if (cost === null) {
    const described = describeTrigger(trigger, lookup)
    if (!described) {
      return <span data-testid="tech-cost" className="block text-[11px] text-gray-400">Trigger</span>
    }
    return (
      <span
        data-testid="tech-cost"
        data-trigger-type={trigger?.type}
        data-tip={tooltip ? described.full : undefined}
        className="flex items-center gap-1 min-w-0 text-[11px] text-gray-400"
      >
        {described.iconPath && <Icon iconPath={described.iconPath} alt="" className="w-4 h-4 object-contain shrink-0" draggable={false} />}
        {triggerText === 'short'
          ? <span className="truncate">{described.short}</span>
          : <span>{described.full}</span>}
      </span>
    )
  }
  const { items } = lookup
  const text = [showCount && `×${cost.count ?? '?'}`, showTime && `${cost.time}s`].filter(Boolean).join(' · ')
  return (
    <span data-testid="tech-cost" className="flex flex-wrap items-center gap-x-1 text-[11px] text-gray-400">
      {cost.ingredients.map(ing => {
        const item = items[ing.itemId]
        const label = `${item?.name ?? ing.itemId} ×${ing.amount}`
        return item?.iconPath ? (
          <Icon key={ing.itemId} iconPath={item.iconPath} alt={label} data-tip={label} draggable={false} className="w-4 h-4 object-contain" />
        ) : (
          <span key={ing.itemId} role="img" aria-label={label} data-tip="" className="w-4 h-4 flex items-center justify-center rounded bg-gray-700 text-[9px]">
            {(item?.name ?? ing.itemId).charAt(0)}
          </span>
        )
      })}
      {text && <span>{text}</span>}
    </span>
  )
}
