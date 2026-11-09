import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { iconColor, addIconColors } from '../icon-color.js'

/** 8x8 PNG whose left half is `left` and right half `right` ([r,g,b,a]). */
function halves(left, right) {
  const px = Buffer.alloc(8 * 8 * 4)
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) Buffer.from(x < 4 ? left : right).copy(px, (y * 8 + x) * 4)
  return sharp(px, { raw: { width: 8, height: 8, channels: 4 } }).png().toBuffer()
}

const parse = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16))

describe('iconColor', () => {
  it('returns the colour of a solid icon', async () => {
    expect(await iconColor(await halves([255, 0, 0, 255], [255, 0, 0, 255]))).toBe('#ff0000')
  })

  it('ignores transparent pixels', async () => {
    expect(await iconColor(await halves([255, 0, 0, 255], [0, 0, 255, 0]))).toBe('#ff0000')
  })

  it('is undefined for a fully transparent icon', async () => {
    expect(await iconColor(await halves([255, 0, 0, 0], [0, 0, 255, 0]))).toBeUndefined()
  })

  it('averages opaque colours', async () => {
    const [r, g, b] = parse(await iconColor(await halves([255, 0, 0, 255], [0, 0, 255, 255])))
    // The resize blurs the seam, so the mean is only roughly even.
    expect(Math.abs(r - 128)).toBeLessThanOrEqual(12)
    expect(g).toBe(0)
    expect(Math.abs(b - 128)).toBeLessThanOrEqual(12)
    expect(r + b).toBeGreaterThanOrEqual(250)
  })
})

describe('addIconColors', () => {
  it('sets iconColor only on items whose icon file exists', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'icon-color-'))
    try {
      writeFileSync(join(dir, 'a.png'), await halves([0, 255, 0, 255], [0, 255, 0, 255]))
      const items = {
        a: { id: 'a', iconPath: '/data/x/icons/a.png' },
        b: { id: 'b', iconPath: '/data/x/icons/b.png' },
        c: { id: 'c', iconPath: '' },
      }
      const counts = await addIconColors(items, dir)
      expect(items.a.iconColor).toBe('#00ff00')
      expect('iconColor' in items.b).toBe(false)
      expect('iconColor' in items.c).toBe(false)
      expect(counts).toEqual({ set: 1, skipped: 2 })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
