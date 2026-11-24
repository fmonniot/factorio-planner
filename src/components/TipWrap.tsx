import type { ReactNode } from 'react'

/**
 * Carries the instant tooltip (`data-tip`) of a natively disabled control. Firefox and Safari deliver no pointer events to a
 * disabled button, so the tip sits on this wrapping span and the button gets `disabled:pointer-events-none`.
 * With `when={false}` the children are rendered as they are, without the span.
 */
export function TipWrap({ tip, className = 'inline-flex', when = true, children }: { tip?: string; className?: string; when?: boolean; children: ReactNode }) {
  if (!when) return <>{children}</>
  return <span data-tip={tip} className={className}>{children}</span>
}
