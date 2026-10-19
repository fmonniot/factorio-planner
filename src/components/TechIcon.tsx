import { Icon } from './Icon'
import type { Technology } from '../data/types'

interface TechIconProps {
  tech: Pick<Technology, 'name' | 'iconPath'>
  /** Size and text classes, e.g. "w-10 h-10 text-sm". */
  className: string
}

/** A technology's icon, or a letter placeholder when it has none. */
export function TechIcon({ tech, className }: TechIconProps) {
  if (tech.iconPath) {
    return <Icon iconPath={tech.iconPath} alt="" draggable={false} className={`${className} object-contain shrink-0`} />
  }
  return (
    <span
      data-testid="tech-icon-placeholder"
      className={`${className} shrink-0 flex items-center justify-center rounded bg-gray-700 text-gray-300`}
    >{tech.name.charAt(0)}</span>
  )
}
