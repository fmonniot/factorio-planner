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
 * Composite an array of Factorio IconData layers into a single PNG Buffer.
 *
 * @param {Array}  layers     - Array of IconData objects from proto.icons
 * @param {object} resolvers  - Mod name → resolver map
 * @param {number} outputSize - Output canvas size in pixels (default 64)
 * @returns {Promise<Buffer|null>} PNG buffer, or null if no layers could be rendered
 */
export async function compositeIconLayers(layers, resolvers, outputSize = 64) {
  const compositeInputs = []

  for (const layer of layers) {
    const buf = readIconBuffer(layer.icon, resolvers)
    if (!buf) continue

    const iconSize   = layer.icon_size ?? outputSize
    const scale      = layer.scale ?? (outputSize / 2) / iconSize
    const scaledSize = Math.max(1, Math.round(iconSize * scale))

    let img = sharp(buf)
      .extract({ left: 0, top: 0, width: iconSize, height: iconSize })
      .resize(scaledSize, scaledSize, { fit: 'fill' })

    const tint = normalizeColor(layer.tint)
    const isIdentityTint = tint.r === 1 && tint.g === 1 && tint.b === 1
    if (!isIdentityTint) {
      // Factorio tinting is multiplicative: output = source * tint (per channel).
      // sharp.recomb() applies a 3×3 matrix to RGB — a diagonal of [r, g, b] achieves
      // the per-channel multiply without touching the alpha channel.
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

    const layerBuf = await img.ensureAlpha().png().toBuffer()
    compositeInputs.push({ input: layerBuf, blend: 'over', left, top })
  }

  if (compositeInputs.length === 0) return null

  return sharp({
    create: { width: outputSize, height: outputSize, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite(compositeInputs)
    .png()
    .toBuffer()
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
