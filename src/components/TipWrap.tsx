import type { ReactNode } from 'react'

/**
 * Carries the instant tooltip (`data-tip`) of a natively disabled control. Firefox and Safari deliver no pointer events to a
 * disabled button, so the tip sits on this wrapping span and the button gets `disabled:pointer-events-none`.
 */
export function TipWrap({ tip, className = 'inline-flex', children }: { tip?: string; className?: string; children: ReactNode }) {
  return <span data-tip={tip} className={className}>{children}</span>
}
