import type { SourceRule, SubPlan } from '../../data/types'
import { ruleLabel } from './itemSourcing'
import { ruleIconsOf } from './inputsModel'
import { StripIcon } from './StripIcon'

/**
 * The icons that say an item's rule is not the default (its preset, then Import off), each an image named by its rule
 * ("Receive it first", "Import off", "Line L: Receive it first" for an area's). Nothing for the default rule. The side panel's
 * inputs and the Ingredients strip's toolbar draw them; `testId` and `iconTestId` are theirs.
 */
export function RuleIcons({ rule, areaId, rootPlan, testId, iconTestId, className = 'gap-1' }: {
  rule: SourceRule | undefined
  areaId?: string
  rootPlan: SubPlan
  testId: string
  iconTestId: string
  className?: string
}) {
  const icons = ruleIconsOf(rule)
  if (icons.length === 0) return null
  return (
    <span data-testid={testId} className={`inline-flex shrink-0 text-teal-300 ${className}`}>
      {icons.map(i => {
        const name = ruleLabel({ kind: i.kind, areaId }, rootPlan)
        return (
          <span key={i.kind} data-testid={iconTestId} data-rule={i.kind} role="img" aria-label={name} data-tip={name}>
            <StripIcon name={i.icon} />
          </span>
        )
      })}
    </span>
  )
}
