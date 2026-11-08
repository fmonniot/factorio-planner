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
  /** Append "· <time>s" after the count. Default true (tech-tree cards). */
  showTime?: boolean
}

export function TechCost({ cost, lookup, trigger, triggerText = 'short', showTime = true }: TechCostProps) {
  if (cost === undefined) return null
  if (cost === null) {
    const described = describeTrigger(trigger, lookup)
    if (!trigger || !described) {
      return <span data-testid="tech-cost" className="block text-[11px] text-gray-400">Trigger</span>
    }
    return (
      <span
        data-testid="tech-cost"
        data-trigger-type={trigger.type}
        title={described.full}
        className="flex items-center gap-1 min-w-0 text-[11px] text-gray-400"
      >
        {described.iconPath && <Icon iconPath={described.iconPath} alt="" className="w-4 h-4 object-contain shrink-0" draggable={false} />}
        <span className={triggerText === 'short' ? 'truncate' : ''}>{triggerText === 'short' ? described.short : described.full}</span>
      </span>
    )
  }
  const { items } = lookup
  return (
    <span data-testid="tech-cost" className="flex flex-wrap items-center gap-x-1 text-[11px] text-gray-400">
      {cost.ingredients.map(ing => {
        const item = items[ing.itemId]
        const label = `${item?.name ?? ing.itemId} ×${ing.amount}`
        return item?.iconPath ? (
          <Icon key={ing.itemId} iconPath={item.iconPath} alt={label} title={label} draggable={false} className="w-4 h-4 object-contain" />
        ) : (
          <span key={ing.itemId} title={label} className="w-4 h-4 flex items-center justify-center rounded bg-gray-700 text-[9px]">
            {(item?.name ?? ing.itemId).charAt(0)}
          </span>
        )
      })}
      <span>×{cost.count ?? '?'}{showTime ? ` · ${cost.time}s` : ''}</span>
    </span>
  )
}
