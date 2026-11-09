import { existsSync } from 'node:fs'
import { basename, join } from 'node:path'
import sharp from 'sharp'

const SIZE = 16
const OPAQUE = 128

/**
 * Mean colour of an icon's opaque pixels (alpha >= 128) on a 16x16 downscale,
 * as `#rrggbb`; undefined when no pixel is opaque.
 */
export async function iconColor(buffer) {
  const data = await sharp(buffer).resize(SIZE, SIZE, { fit: 'fill' }).ensureAlpha().raw().toBuffer()
  let r = 0, g = 0, b = 0, w = 0
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < OPAQUE) continue
    const a = data[i + 3]
    r += data[i] * a
    g += data[i + 1] * a
    b += data[i + 2] * a
    w += a
  }
  if (w === 0) return undefined
  const hex = v => Math.round(v / w).toString(16).padStart(2, '0')
  return `#${hex(r)}${hex(g)}${hex(b)}`
}

/**
 * Set `iconColor` on every item whose icon file exists in `iconsDir`
 * (`<iconsDir>/<basename of iconPath>`). Items without an icon are skipped.
 * Returns how many were set and how many skipped.
 */
export async function addIconColors(items, iconsDir) {
  let set = 0, skipped = 0
  for (const item of Object.values(items)) {
    const file = item.iconPath ? join(iconsDir, basename(item.iconPath)) : undefined
    const color = file && existsSync(file) ? await iconColor(file) : undefined
    if (color === undefined) { skipped++; continue }
    item.iconColor = color
    set++
  }
  return { set, skipped }
}
