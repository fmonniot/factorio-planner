import type { PopoverAnchor, ViewportRect } from '../../store/uiStore'

const box = (r: DOMRect): ViewportRect => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom })

/**
 * Where a popover opened from `el` goes: the element's box, and the row side panel's when the element is inside it.
 * The element is kept so that the popover can measure it again when the page scrolls (`liveAnchor`); the boxes are the
 * last measure, for an element that has left the page (a hover list that closed).
 */
export function anchorOf(el: Element): PopoverAnchor {
  const panel = el.closest('[data-testid="side-panel"]')
  return { rect: box(el.getBoundingClientRect()), avoid: panel ? box(panel.getBoundingClientRect()) : null, el }
}

/** `anchor` measured again, when its element is still in the page. */
export function liveAnchor(anchor: PopoverAnchor): PopoverAnchor {
  return anchor.el?.isConnected ? anchorOf(anchor.el) : anchor
}
