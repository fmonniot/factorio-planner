import { Icon } from './Icon'
import type { GameData, Technology } from '../data/types'

interface TechCostProps {
  cost: Technology['cost']
  items: GameData['items']
  /** Append "· <time>s" after the count. Default true (tech-tree cards). */
  showTime?: boolean
}

export function TechCost({ cost, items, showTime = true }: TechCostProps) {
  if (cost === undefined) return null
  if (cost === null) {
    return <span data-testid="tech-cost" className="block text-[11px] text-gray-400">Trigger</span>
  }
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
