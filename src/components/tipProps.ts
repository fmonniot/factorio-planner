/**
 * Props for the instant tooltip (`TooltipLayer`) with its accessible counterpart.
 * `tipProps(name, detail?)`: an element that has no visible text of its own (an icon): `name` is the accessible name and the tooltip
 * text; with a `detail` the tooltip shows the detail and `aria-description` carries it for assistive technology.
 */
export function tipProps(name: string, detail?: string) {
  return { 'aria-label': name, 'data-tip': detail ?? '', 'aria-description': detail }
}

/**
 * An element that keeps its own name or text: the tooltip says more than the name, so its text is also the accessible description.
 * Empty or missing text gives no props (no tooltip, no description).
 */
export function describedTip(text?: string): { 'data-tip'?: string; 'aria-description'?: string } {
  return text ? { 'data-tip': text, 'aria-description': text } : {}
}
