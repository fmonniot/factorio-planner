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

const CONCURRENCY = 16

/**
 * Set `iconColor` on every item whose icon file exists in `iconsDir`
 * (`<iconsDir>/<basename of iconPath>`), decoding up to CONCURRENCY icons at a
 * time. When `iconsDir` exists, an item whose icon is missing or has no opaque
 * pixel loses a stale `iconColor`; when it does not exist nothing is touched.
 * Returns how many were set, how many skipped and how many items changed
 * (set to a new value or cleared).
 */
export async function addIconColors(items, iconsDir) {
  const haveDir = existsSync(iconsDir)
  const list = Object.values(items)
  let set = 0, skipped = 0, changed = 0
  let next = 0
  const worker = async () => {
    while (next < list.length) {
      const item = list[next++]
      const file = item.iconPath ? join(iconsDir, basename(item.iconPath)) : undefined
      const color = file && existsSync(file) ? await iconColor(file) : undefined
      if (color === undefined) {
        skipped++
        if (haveDir && item.iconColor !== undefined) { delete item.iconColor; changed++ }
        continue
      }
      if (item.iconColor !== color) changed++
      item.iconColor = color
      set++
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, list.length) }, worker))
  return { set, skipped, changed }
}
