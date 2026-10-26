import sharp from 'sharp'

const MOD_PATH_RE = /^__([^_]+(?:_[^_]+)*)__\/(.+)$/

/**
 * Read a single icon layer's source buffer from the mod resolvers.
 * Returns null and logs a warning if the path can't be resolved.
 */
export function readIconBuffer(iconPath, resolvers) {
  const m = iconPath.match(MOD_PATH_RE)
  if (!m) {
    process.stderr.write(`[warn] Cannot parse icon path: ${iconPath}\n`)
    return null
  }
  const [, modName, relPath] = m
  const resolver = resolvers[modName]
  if (!resolver) {
    process.stderr.write(`[warn] No resolver for mod "${modName}" (icon: ${iconPath})\n`)
    return null
  }
  const buf = resolver.readFile(relPath)
  if (!buf) {
    process.stderr.write(`[warn] Icon not found: ${iconPath}\n`)
    return null
  }
  return buf
}

/**
 * Normalize a Factorio Color value to { r, g, b, a } with components in [0, 1].
 * Factorio allows both 0–1 floats and 0–255 integers; if any component > 1 the
 * whole value is in the 0–255 range.
 */
export function normalizeColor(c) {
  if (!c) return { r: 1, g: 1, b: 1, a: 1 }
  let r, g, b, a
  if (Array.isArray(c)) {
    ;[r = 0, g = 0, b = 0, a = 1] = c
  } else {
    r = c.r ?? 0; g = c.g ?? 0; b = c.b ?? 0; a = c.a ?? 1
  }
  if (r > 1 || g > 1 || b > 1 || a > 1) {
    r /= 255; g /= 255; b /= 255; a /= 255
  }
  return { r, g, b, a }
}

/**
 * Canvas size for a prototype's icon. Layers are authored for an expected icon
 * size (64 for items, 256 for technologies); the canvas grows only when a layer
 * with an explicit `scale` is larger than that. Layers without `scale` are drawn at
 * half the expected size, so they never force growth.
 *
 * @returns {{ outputSize: number, expectedSize: number }}
 */
export function iconCanvasSize(proto) {
  if (proto.icon_size) return { outputSize: proto.icon_size, expectedSize: proto.icon_size }
  const expectedSize = proto.type === 'technology' ? 256 : 64
  const layers = Array.isArray(proto.icons) ? proto.icons : []
  const outputSize = Math.max(
    expectedSize,
    ...layers.map(l => (l.scale == null ? 0 : Math.round((l.icon_size ?? 0) * l.scale))),
  )
  return { outputSize, expectedSize }
}

/**
 * Add a light layer (tint alpha 0) onto a straight-alpha RGBA canvas, in place.
 * Factorio adds the layer's colour to what is below it and keeps the alpha below,
 * so the canvas alpha is unchanged and light that lands on a fully transparent
 * canvas pixel is dropped (a straight-alpha PNG cannot hold additive light over an
 * unknown background). Both buffers are raw 4-channel RGBA, square.
 */
export function addLightLayer(canvas, canvasSize, layer, layerSize, left, top) {
  const y0 = Math.max(0, -top)
  const y1 = Math.min(layerSize, canvasSize - top)
  const x0 = Math.max(0, -left)
  const x1 = Math.min(layerSize, canvasSize - left)
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const ci = ((y + top) * canvasSize + x + left) * 4
      const li = (y * layerSize + x) * 4
      const da = canvas[ci + 3]
      if (da === 0) continue
      // Premultiplied add, converted back to straight alpha: C' = C + L * la / da.
      const k = layer[li + 3] / da
      for (let c = 0; c < 3; c++) {
        canvas[ci + c] = Math.min(255, Math.round(canvas[ci + c] + layer[li + c] * k))
      }
    }
  }
}

/**
 * Composite an array of Factorio IconData layers into a single PNG Buffer.
 * Layers are drawn in order with normal alpha; a layer whose tint alpha is 0 is a
 * light layer and is added to the layers below instead (see addLightLayer).
 *
 * @param {Array}  layers     - Array of IconData objects from proto.icons
 * @param {object} resolvers  - Mod name → resolver map
 * @param {number} outputSize - Output canvas size in pixels (default 64)
 * @param {number} expectedSize - Icon size the layers are authored for (64 for items,
 *                                256 for technologies); layers without `scale` are
 *                                drawn at half of it. Defaults to outputSize.
 * @returns {Promise<Buffer|null>} PNG buffer, or null if no layers could be rendered
 */
export async function compositeIconLayers(layers, resolvers, outputSize = 64, expectedSize = outputSize) {
  const steps = []

  for (const layer of layers) {
    const buf = readIconBuffer(layer.icon, resolvers)
    if (!buf) continue

    const iconSize   = layer.icon_size ?? outputSize
    const scale      = layer.scale ?? (expectedSize / 2) / iconSize
    const scaledSize = Math.max(1, Math.round(iconSize * scale))

    let img = sharp(buf)
      .extract({ left: 0, top: 0, width: iconSize, height: iconSize })
      .resize(scaledSize, scaledSize, { fit: 'fill' })

    const tint = normalizeColor(layer.tint)
    const isIdentityTint = tint.r === 1 && tint.g === 1 && tint.b === 1
    if (!isIdentityTint) {
      // Factorio draws layers with premultiplied alpha and multiplies the tint into the
      // colour: output = source * tint (per channel). sharp.recomb() applies a 3×3 matrix
      // to RGB — a diagonal of [r, g, b] does the per-channel multiply, alpha untouched.
      img = img.recomb([
        [tint.r, 0, 0],
        [0, tint.g, 0],
        [0, 0, tint.b],
      ])
    }

    const shiftX = layer.shift?.[0] ?? 0
    const shiftY = layer.shift?.[1] ?? 0
    const left = Math.round((outputSize - scaledSize) / 2 + shiftX)
    const top  = Math.round((outputSize - scaledSize) / 2 + shiftY)

    if (tint.a === 0) {
      // toColourspace guarantees 4 channels for grey+alpha sources.
      const light = await img.toColourspace('srgb').ensureAlpha().raw().toBuffer()
      steps.push({ light, size: scaledSize, left, top })
    } else {
      const input = await img.ensureAlpha().png().toBuffer()
      steps.push({ over: { input, blend: 'over', left, top } })
    }
  }

  if (steps.length === 0) return null

  const raw = { width: outputSize, height: outputSize, channels: 4 }
  let canvas = await sharp({
    create: { ...raw, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  }).raw().toBuffer()

  // Consecutive normal layers go through one libvips composite; a light layer needs
  // the pixels below it, so it flushes them first.
  let pending = []
  const flush = async () => {
    if (pending.length === 0) return
    canvas = await sharp(canvas, { raw }).composite(pending).raw().toBuffer()
    pending = []
  }
  for (const step of steps) {
    if (step.over) {
      pending.push(step.over)
    } else {
      await flush()
      addLightLayer(canvas, outputSize, step.light, step.size, step.left, step.top)
    }
  }
  await flush()

  return sharp(canvas, { raw }).png().toBuffer()
}

/**
 * Trim transparent borders, resize to fill the inner area, and re-add uniform
 * padding so every icon has consistent 10% margins on all sides.
 *
 * Call this after compositeIconLayers in the build pipeline.
 */
export async function normalizeIcon(buf, outputSize, paddingPct = 0.1) {
  const paddingPx = Math.round(outputSize * paddingPct)
  const innerSize = outputSize - 2 * paddingPx

  return sharp(buf)
    .trim({ threshold: 0 })
    .resize(innerSize, innerSize, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .extend({
      top: paddingPx, bottom: paddingPx,
      left: paddingPx, right: paddingPx,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer()
}
