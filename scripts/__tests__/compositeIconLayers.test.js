import { describe, it, expect, vi, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { compositeIconLayers, addLightLayer, normalizeColor } from '../icon-compositor.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a solid-colour 64×64 RGBA PNG buffer. */
async function solidPng(r, g, b, a = 255, size = 64) {
  return sharp({
    create: { width: size, height: size, channels: 4, background: { r, g, b, alpha: a / 255 } },
  })
    .png()
    .toBuffer()
}

/** Read pixel at (x, y) from a PNG buffer. Returns { r, g, b, a } in 0–255. */
async function pixel(buf, x = 32, y = 32) {
  const { data } = await sharp(buf).raw().toBuffer({ resolveWithObject: true })
  const { width, channels } = await sharp(buf).metadata()
  const idx = (y * width + x) * channels
  return { r: data[idx], g: data[idx + 1], b: data[idx + 2], a: data[idx + 3] }
}

/** Build a mock resolver map for a single mod. */
function mockResolver(modName, fileMap) {
  return {
    [modName]: {
      readFile: (path) => fileMap[path] ?? null,
    },
  }
}

// ---------------------------------------------------------------------------
// normalizeColor
// ---------------------------------------------------------------------------

describe('normalizeColor', () => {
  it('returns identity for null', () => {
    expect(normalizeColor(null)).toEqual({ r: 1, g: 1, b: 1, a: 1 })
  })

  it('passes through 0–1 float values unchanged', () => {
    expect(normalizeColor({ r: 0.5, g: 0.25, b: 0.75, a: 0.8 })).toEqual({ r: 0.5, g: 0.25, b: 0.75, a: 0.8 })
  })

  it('normalizes 0–255 integer values', () => {
    const c = normalizeColor({ r: 128, g: 64, b: 192, a: 255 })
    expect(c.r).toBeCloseTo(128 / 255)
    expect(c.g).toBeCloseTo(64 / 255)
    expect(c.b).toBeCloseTo(192 / 255)
    expect(c.a).toBeCloseTo(1)
  })

  it('handles array form [r, g, b]', () => {
    expect(normalizeColor([0.5, 0.5, 0.5])).toEqual({ r: 0.5, g: 0.5, b: 0.5, a: 1 })
  })

  it('handles array form [r, g, b, a]', () => {
    expect(normalizeColor([1, 0, 0, 0.5])).toEqual({ r: 1, g: 0, b: 0, a: 0.5 })
  })

  it('defaults missing a to 1 for object form', () => {
    expect(normalizeColor({ r: 1, g: 1, b: 1 }).a).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// compositeIconLayers
// ---------------------------------------------------------------------------

describe('compositeIconLayers', () => {
  it('returns null when no layers can be resolved', async () => {
    const resolvers = mockResolver('base', {})
    const layers = [{ icon: '__base__/missing.png', icon_size: 64 }]
    const result = await compositeIconLayers(layers, resolvers)
    expect(result).toBeNull()
  })

  it('single layer, identity — output contains source pixels', async () => {
    const src = await solidPng(200, 100, 50)
    const resolvers = mockResolver('base', { 'graphics/red.png': src })
    const layers = [{ icon: '__base__/graphics/red.png', icon_size: 64 }]

    const out = await compositeIconLayers(layers, resolvers, 64)
    expect(out).toBeInstanceOf(Buffer)

    const p = await pixel(out)
    // Allow ±2 for PNG encoding rounding
    expect(p.r).toBeCloseTo(200, -1)
    expect(p.g).toBeCloseTo(100, -1)
    expect(p.b).toBeCloseTo(50, -1)
    expect(p.a).toBe(255)
  })

  it('single layer with red tint — output is tinted', async () => {
    const src = await solidPng(255, 255, 255) // white source
    const resolvers = mockResolver('base', { 'graphics/white.png': src })
    const layers = [{
      icon: '__base__/graphics/white.png',
      icon_size: 64,
      tint: { r: 1, g: 0, b: 0, a: 1 },
    }]

    const out = await compositeIconLayers(layers, resolvers, 64)
    const p = await pixel(out)
    // White tinted red → high R, low G and B
    expect(p.r).toBeGreaterThan(150)
    expect(p.g).toBeLessThan(100)
    expect(p.b).toBeLessThan(100)
  })

  it('two layers — top layer composites over bottom', async () => {
    const bottom = await solidPng(0, 0, 255)    // blue
    const top    = await solidPng(255, 0, 0)    // opaque red
    const resolvers = mockResolver('base', {
      'graphics/blue.png': bottom,
      'graphics/red.png':  top,
    })
    const layers = [
      { icon: '__base__/graphics/blue.png', icon_size: 64 },
      { icon: '__base__/graphics/red.png',  icon_size: 64 },
    ]

    const out = await compositeIconLayers(layers, resolvers, 64)
    const p = await pixel(out)
    // Top (red) should dominate since it's opaque
    expect(p.r).toBeGreaterThan(150)
    expect(p.b).toBeLessThan(100)
  })

  it('scale < 1 — scaled layer is smaller than canvas', async () => {
    const src = await solidPng(255, 0, 0)
    const resolvers = mockResolver('base', { 'graphics/icon.png': src })
    const layers = [{
      icon: '__base__/graphics/icon.png',
      icon_size: 64,
      scale: 0.25, // 16×16 in a 64×64 canvas
    }]

    const out = await compositeIconLayers(layers, resolvers, 64)
    // Center pixel should be red
    const center = await pixel(out, 32, 32)
    expect(center.r).toBeGreaterThan(150)

    // Corner pixel (0,0) should be transparent (outside the scaled layer)
    const corner = await pixel(out, 0, 0)
    expect(corner.a).toBe(0)
  })

  it('shift offset — layer is displaced from center', async () => {
    const src = await solidPng(255, 0, 0) // red, fills whole canvas at scale 1
    const resolvers = mockResolver('base', { 'graphics/icon.png': src })
    const layers = [{
      icon: '__base__/graphics/icon.png',
      icon_size: 64,
      scale: 0.5,   // 32×32 layer
      shift: [16, 0], // shifted 16 px right
    }]

    const out = await compositeIconLayers(layers, resolvers, 64)
    // The 32×32 layer centred at (32,32) + shift(16,0) occupies x=[32..64]
    // So (40, 32) should be inside (red), and (8, 32) should be outside (transparent)
    const inside  = await pixel(out, 40, 32)
    const outside = await pixel(out, 8, 32)
    expect(inside.r).toBeGreaterThan(150)
    expect(outside.a).toBe(0)
  })

  it('skips missing layers and composites the rest', async () => {
    const src = await solidPng(0, 200, 0) // green
    const resolvers = mockResolver('base', { 'graphics/green.png': src })
    const layers = [
      { icon: '__base__/graphics/missing.png', icon_size: 64 },
      { icon: '__base__/graphics/green.png',   icon_size: 64 },
    ]

    const out = await compositeIconLayers(layers, resolvers, 64)
    expect(out).toBeInstanceOf(Buffer)
    const p = await pixel(out)
    expect(p.g).toBeGreaterThan(150)
  })
})

// ---------------------------------------------------------------------------
// Light layers (tint alpha 0)
// ---------------------------------------------------------------------------

describe('light layers (tint alpha 0)', () => {
  const LIGHT = { r: 1, g: 1, b: 1, a: 0 }

  /** Composite a base PNG and a light PNG (both 64×64) with the given light tint. */
  async function withLight(base, light, tint = LIGHT, extra = []) {
    const resolvers = mockResolver('t', { 'base.png': base, 'light.png': light })
    const layers = [
      { icon: '__t__/base.png', icon_size: 64 },
      { icon: '__t__/light.png', icon_size: 64, tint },
      ...extra,
    ]
    return compositeIconLayers(layers, resolvers, 64)
  }

  function expectPixel(p, r, g, b, a) {
    expect(Math.abs(p.r - r)).toBeLessThanOrEqual(1)
    expect(Math.abs(p.g - g)).toBeLessThanOrEqual(1)
    expect(Math.abs(p.b - b)).toBeLessThanOrEqual(1)
    expect(p.a).toBe(a)
  }

  it('adds the light colour to an opaque base', async () => {
    const out = await withLight(await solidPng(40, 40, 40), await solidPng(100, 150, 200))
    const p = await pixel(out)
    expectPixel(p, 140, 190, 240, 255)
    expect(Math.min(p.r, p.g, p.b)).toBeGreaterThanOrEqual(40)
  })

  it('opaque black light leaves the base unchanged (no black square)', async () => {
    const out = await withLight(await solidPng(200, 100, 50), await solidPng(0, 0, 0), [1, 1, 1, 0])
    expectPixel(await pixel(out), 200, 100, 50, 255)
  })

  it('accepts a 0–255 tint', async () => {
    const out = await withLight(
      await solidPng(40, 40, 40), await solidPng(100, 150, 200), { r: 255, g: 255, b: 255, a: 0 },
    )
    expectPixel(await pixel(out), 140, 190, 240, 255)
  })

  it('multiplies the light by the tint colour', async () => {
    const out = await withLight(
      await solidPng(40, 40, 40), await solidPng(255, 255, 255), { r: 0.5, g: 0, b: 0, a: 0 },
    )
    expectPixel(await pixel(out), 168, 40, 40, 255)
  })

  it('weights a semi-transparent light pixel by its alpha', async () => {
    const out = await withLight(await solidPng(0, 0, 0), await solidPng(200, 200, 200, 128))
    expectPixel(await pixel(out), 100, 100, 100, 255)
  })

  it('keeps the alpha of a semi-transparent canvas', async () => {
    const out = await withLight(await solidPng(40, 40, 40, 128), await solidPng(50, 50, 50))
    // Premultiplied: 40*0.5 + 50 = 70, back to straight alpha: 70 / 0.5 = 140.
    expectPixel(await pixel(out), 140, 140, 140, 128)
  })

  it('clamps at 255', async () => {
    const out = await withLight(await solidPng(200, 200, 200), await solidPng(200, 200, 200))
    expectPixel(await pixel(out), 255, 255, 255, 255)
  })

  it('drops light that falls on transparent pixels', async () => {
    const red = await solidPng(255, 0, 0)
    const white = await solidPng(255, 255, 255)
    const resolvers = mockResolver('t', { 'red.png': red, 'white.png': white })
    const layers = [
      { icon: '__t__/red.png', icon_size: 64, scale: 0.5 },
      { icon: '__t__/white.png', icon_size: 64, scale: 1, tint: LIGHT },
    ]
    const out = await compositeIconLayers(layers, resolvers, 64)
    expect((await pixel(out, 0, 0)).a).toBe(0)
    const centre = await pixel(out, 32, 32)
    expect(centre.a).toBe(255)
    expect(centre.g).toBeGreaterThan(250)
  })

  it('returns null for a lone light layer', async () => {
    const resolvers = mockResolver('t', { 'white.png': await solidPng(255, 255, 255) })
    const out = await compositeIconLayers([{ icon: '__t__/white.png', icon_size: 64, tint: LIGHT }], resolvers, 64)
    expect(out).toBeNull()
  })

  it('applies layers in order: a layer above the light covers it', async () => {
    const resolvers = mockResolver('t', {
      'blue.png': await solidPng(0, 0, 255),
      'white.png': await solidPng(255, 255, 255),
      'red.png': await solidPng(255, 0, 0),
    })
    const layers = [
      { icon: '__t__/blue.png', icon_size: 64, scale: 1 },
      { icon: '__t__/white.png', icon_size: 64, scale: 1, tint: LIGHT },
      { icon: '__t__/red.png', icon_size: 64, scale: 0.5 },
    ]
    const out = await compositeIconLayers(layers, resolvers, 64)
    expectPixel(await pixel(out, 32, 32), 255, 0, 0, 255)
    expectPixel(await pixel(out, 4, 4), 255, 255, 255, 255)
  })

  it('handles a grey+alpha light source', async () => {
    const grey = await sharp(await solidPng(100, 100, 100)).toColourspace('b-w').png().toBuffer()
    const out = await withLight(await solidPng(40, 40, 40), grey)
    const p = await pixel(out)
    expect(p.r).toBeGreaterThan(100)
    expect(p.a).toBe(255)
  })
})

describe('addLightLayer', () => {
  const rgba = (size, r, g, b, a) => {
    const buf = Buffer.alloc(size * size * 4)
    for (let i = 0; i < buf.length; i += 4) buf.set([r, g, b, a], i)
    return buf
  }
  const at = (buf, size, x, y) => Array.from(buf.subarray((y * size + x) * 4, (y * size + x) * 4 + 4))

  it('touches only the overlap for negative offsets', () => {
    const canvas = rgba(4, 10, 10, 10, 255)
    addLightLayer(canvas, 4, rgba(4, 50, 50, 50, 255), 4, -2, -2)
    expect(at(canvas, 4, 0, 0)).toEqual([60, 60, 60, 255])
    expect(at(canvas, 4, 1, 1)).toEqual([60, 60, 60, 255])
    expect(at(canvas, 4, 2, 2)).toEqual([10, 10, 10, 255])
    expect(at(canvas, 4, 3, 0)).toEqual([10, 10, 10, 255])
  })

  it('touches only the overlap when the layer overflows the canvas', () => {
    const canvas = rgba(4, 10, 10, 10, 255)
    addLightLayer(canvas, 4, rgba(4, 50, 50, 50, 255), 4, 3, 3)
    expect(at(canvas, 4, 3, 3)).toEqual([60, 60, 60, 255])
    expect(at(canvas, 4, 2, 3)).toEqual([10, 10, 10, 255])
    expect(at(canvas, 4, 3, 2)).toEqual([10, 10, 10, 255])
  })

  it('does not throw when the layer is entirely outside', () => {
    const canvas = rgba(4, 10, 10, 10, 255)
    expect(() => addLightLayer(canvas, 4, rgba(2, 50, 50, 50, 255), 2, 10, -10)).not.toThrow()
    expect(at(canvas, 4, 0, 0)).toEqual([10, 10, 10, 255])
  })
})

// ---------------------------------------------------------------------------
// Golden image tests
// ---------------------------------------------------------------------------

/**
 * Build a resolver from a fixture directory.
 * layers.json references icons as `__fixture__/layer-N.png`; this resolver
 * reads them from the same directory on disk.
 */
function fixtureResolver(fixtureDir) {
  return {
    fixture: {
      readFile: (path) => {
        try { return readFileSync(join(fixtureDir, path)) } catch { return null }
      },
    },
  }
}

/**
 * Max absolute per-channel difference between two same-size RGBA PNG buffers.
 * Returns 0 when the images are pixel-identical.
 */
async function maxPixelDiff(bufA, bufB) {
  const [a, b] = await Promise.all([
    sharp(bufA).raw().toBuffer({ resolveWithObject: true }),
    sharp(bufB).raw().toBuffer({ resolveWithObject: true }),
  ])
  let max = 0
  for (let i = 0; i < a.data.length; i++) {
    max = Math.max(max, Math.abs(a.data[i] - b.data[i]))
  }
  return max
}

describe('golden images', () => {
  it('nullius-ethylene matches expected', async () => {
    const dir = join(__dirname, 'golden/nullius-ethylene')
    const layers = JSON.parse(readFileSync(join(dir, 'layers.json'), 'utf8'))
    const expected = readFileSync(join(dir, 'expected.png'))

    const out = await compositeIconLayers(layers, fixtureResolver(dir), 64)
    expect(out).toBeInstanceOf(Buffer)

    const diff = await maxPixelDiff(out, expected)
    expect(diff).toBeLessThanOrEqual(2)
  })

  it('nullius-box-chemical-pack matches expected', async () => {
    const dir = join(__dirname, 'golden/nullius-box-chemical-pack')
    const layers = JSON.parse(readFileSync(join(dir, 'layers.json'), 'utf8'))
    const expected = readFileSync(join(dir, 'expected.png'))

    const out = await compositeIconLayers(layers, fixtureResolver(dir), 64)
    expect(out).toBeInstanceOf(Buffer)

    const diff = await maxPixelDiff(out, expected)
    expect(diff).toBeLessThanOrEqual(2)
  })

  // Two light layers (tint alpha 0): a regression lock, expected.png is not ground truth.
  it('seablock-advanced-material-processing-2 matches expected', async () => {
    const dir = join(__dirname, 'golden/seablock-advanced-material-processing-2')
    const layers = JSON.parse(readFileSync(join(dir, 'layers.json'), 'utf8'))
    const expected = readFileSync(join(dir, 'expected.png'))

    const out = await compositeIconLayers(layers, fixtureResolver(dir), 256, 256)
    expect(out).toBeInstanceOf(Buffer)

    const diff = await maxPixelDiff(out, expected)
    expect(diff).toBeLessThanOrEqual(2)
  })
})

describe('compositeIconLayers expectedSize', () => {
  it('draws unscaled layers at half the expected size, not half the canvas', async () => {
    const red = await solidPng(255, 0, 0, 255, 64)
    const resolvers = mockResolver('test', { 'a.png': red })
    const layers = [{ icon: '__test__/a.png', icon_size: 64 }]
    // Canvas 128, expected 64: the layer is 32 px, so (4, 4) is empty and (64, 64) is filled.
    const buf = await compositeIconLayers(layers, resolvers, 128, 64)
    expect((await pixel(buf, 4, 4)).a).toBe(0)
    expect((await pixel(buf, 64, 64)).a).toBe(255)
    // Default expectedSize = canvas: the layer is 64 px, so (40, 40) is filled.
    const buf2 = await compositeIconLayers(layers, resolvers, 128)
    expect((await pixel(buf2, 40, 40)).a).toBe(255)
  })
})
