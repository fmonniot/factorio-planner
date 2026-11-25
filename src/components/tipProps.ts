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

/** A visible label that carries a tooltip: the help cursor and a dotted underline. No outline on focus (subtitles truncate). */
export const TIPPED_LABEL_CLASS = 'cursor-help border-b border-dotted border-gray-600 focus-visible:outline-none focus-visible:text-gray-100 focus-visible:border-gray-300'

/** A label that keeps its text and explains it in a tooltip: described, and a tab stop so the keyboard shows the tip. */
export function tippedLabel(text: string) {
  return { ...describedTip(text), tabIndex: 0 as const }
}
