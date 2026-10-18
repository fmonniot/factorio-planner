// Pure pan/zoom maths for a transformed canvas (CSS `translate` then `scale`,
// transform-origin 0 0). Screen point = (x, y) + scale * content point.

export interface ViewTransform { x: number; y: number; scale: number }

export const MIN_SCALE = 0.1
/** Floor for Fit only, so the whole tree fits even in a small window. */
export const FIT_MIN_SCALE = 0.02
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

/** Fit a cw × ch content into a vw × vh viewport, centred, never enlarged above 1 or shrunk below FIT_MIN_SCALE. */
export function fitTransform(cw: number, ch: number, vw: number, vh: number, padding = 24): ViewTransform {
  const scale = Math.min(1, Math.max(FIT_MIN_SCALE, Math.min((vw - 2 * padding) / cw, (vh - 2 * padding) / ch)))
  return { x: (vw - cw * scale) / 2, y: (vh - ch * scale) / 2, scale }
}

/** Put the content point (px, py) at the viewport centre. */
export function centerOn(px: number, py: number, vw: number, vh: number, scale: number): ViewTransform {
  return { x: vw / 2 - px * scale, y: vh / 2 - py * scale, scale }
}

export function transformCss(t: ViewTransform): string {
  return `translate(${t.x}px, ${t.y}px) scale(${t.scale})`
}

/**
 * Zoom factor for a wheel event. `deltaY` is normalised to pixels by `deltaMode`
 * (0 pixel, 1 line = 16 px, 2 page = 400 px) and clamped to ±200 px per event.
 */
export function wheelZoomFactor(deltaY: number, deltaMode = 0): number {
  const px = deltaY * (deltaMode === 1 ? 16 : deltaMode === 2 ? 400 : 1)
  return Math.exp(-Math.max(-200, Math.min(200, px)) * 0.0015)
}
