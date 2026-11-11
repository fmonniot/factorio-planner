/**
 * The keydown handler of a popover that is outside the page's tab order: Tab wraps inside it. The tabbable controls are
 * its buttons that are enabled and not taken out of the tab order (a radio group keeps one tab stop for the group).
 */
export function keepTabInside(e: React.KeyboardEvent<HTMLElement>): void {
  if (e.key !== 'Tab') return
  const controls = [...e.currentTarget.querySelectorAll<HTMLElement>('button:not([tabindex="-1"]):not(:disabled)')]
  const first = controls[0]
  const last = controls[controls.length - 1]
  if (!first || !last) return
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault()
    last.focus()
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault()
    first.focus()
  }
}
