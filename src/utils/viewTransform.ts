// Pure pan/zoom maths for a transformed canvas (CSS `translate` then `scale`,
// transform-origin 0 0). Screen point = (x, y) + scale * content point.

export interface ViewTransform { x: number; y: number; scale: number }

export const MIN_SCALE = 0.1
export const MAX_SCALE = 2
export const ZOOM_STEP = 1.25

export function clampScale(s: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, s))
}

/** Scale by `factor` (clamped) keeping the content point under (cx, cy) fixed. */
export function zoomAt(t: ViewTransform, factor: number, cx: number, cy: number): ViewTransform {
  const scale = clampScale(t.scale * factor)
  const k = scale / t.scale
  return { x: cx - (cx - t.x) * k, y: cy - (cy - t.y) * k, scale }
}

export function panBy(t: ViewTransform, dx: number, dy: number): ViewTransform {
  return { x: t.x + dx, y: t.y + dy, scale: t.scale }
}

/** Fit a cw × ch content into a vw × vh viewport, centred, never enlarged above 1. */
export function fitTransform(cw: number, ch: number, vw: number, vh: number, padding = 24): ViewTransform {
  const scale = clampScale(Math.min((vw - 2 * padding) / cw, (vh - 2 * padding) / ch, 1))
  return { x: (vw - cw * scale) / 2, y: (vh - ch * scale) / 2, scale }
}

/** Put the content point (px, py) at the viewport centre. */
export function centerOn(px: number, py: number, vw: number, vh: number, scale: number): ViewTransform {
  return { x: vw / 2 - px * scale, y: vh / 2 - py * scale, scale }
}

export function transformCss(t: ViewTransform): string {
  return `translate(${t.x}px, ${t.y}px) scale(${t.scale})`
}
