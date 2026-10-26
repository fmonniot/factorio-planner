#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { cpus } from 'node:os'
import sharp from 'sharp'

const ROOT = 'dist/data'
// Optimised icons are kept here by source-content hash, so an unchanged icon
// is copied instead of re-encoded. CI persists this directory between runs.
const CACHE_DIR = process.env.ICON_CACHE_DIR ?? '.cache/icons'
// Part of every cache key: change it with the encoder settings below.
const SETTINGS = 'webp q80 e4; png palette q80 c9'
const CONCURRENCY = Math.max(2, cpus().length)

async function* walkPng(dir) {
  let entries
  try { entries = await readdir(dir, { withFileTypes: true }) } catch { return }
  for (const e of entries) {
    const p = join(dir, e.name)
    if (e.isDirectory()) yield* walkPng(p)
    else if (e.isFile() && p.endsWith('.png')) yield p
  }
}

async function readIfPresent(path) {
  try { return await readFile(path) } catch { return null }
}

// Rename into place so a concurrent worker never reads a half-written entry
// (two source icons can have identical bytes, hence the same cache key).
async function writeAtomic(path, buf) {
  const tmp = `${path}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`
  await writeFile(tmp, buf)
  await rename(tmp, path)
}

async function encode(original) {
  const [webp, optimized] = await Promise.all([
    sharp(original).webp({ quality: 80, effort: 4 }).toBuffer(),
    sharp(original).png({ palette: true, quality: 80, compressionLevel: 9 }).toBuffer(),
  ])
  return { webp, optimized }
}

async function processOne(pngPath) {
  const original = await readFile(pngPath)
  const key = createHash('sha1').update(SETTINGS).update(original).digest('hex')
  const cachedPng = join(CACHE_DIR, `${key}.png`)
  const cachedWebp = join(CACHE_DIR, `${key}.webp`)
  let [optimized, webp] = await Promise.all([readIfPresent(cachedPng), readIfPresent(cachedWebp)])
  const hit = optimized !== null && webp !== null
  if (!hit) {
    ;({ webp, optimized } = await encode(original))
    // Write the PNG last: a cache entry counts only when both files exist.
    await writeAtomic(cachedWebp, webp)
    await writeAtomic(cachedPng, optimized)
  }
  await Promise.all([
    writeFile(pngPath.replace(/\.png$/, '.webp'), webp),
    writeFile(pngPath, optimized),
  ])
  return { src: original.length, png: optimized.length, webp: webp.length, hit, key }
}

async function main() {
  const files = []
  for await (const p of walkPng(ROOT)) files.push(p)
  if (files.length === 0) {
    console.log(`[build-icons] no PNGs under ${ROOT}/ — nothing to do`)
    return
  }
  console.log(`[build-icons] processing ${files.length} icons (concurrency=${CONCURRENCY})…`)
  await mkdir(CACHE_DIR, { recursive: true })

  let srcTotal = 0, pngTotal = 0, webpTotal = 0, failed = 0, hits = 0
  const usedKeys = new Set()
  let cursor = 0
  async function worker() {
    while (cursor < files.length) {
      const idx = cursor++
      try {
        const r = await processOne(files[idx])
        srcTotal += r.src; pngTotal += r.png; webpTotal += r.webp
        if (r.hit) hits++
        usedKeys.add(r.key)
      } catch (err) {
        failed++
        process.stderr.write(`[build-icons] failed ${files[idx]}: ${err.message}\n`)
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker))

  // Drop entries no icon maps to any more, so the cache does not grow forever.
  // Skipped after a failure: the failed icons' keys are unknown.
  if (failed === 0) {
    for (const name of await readdir(CACHE_DIR)) {
      if (!usedKeys.has(name.replace(/\.(png|webp)$/, ''))) await rm(join(CACHE_DIR, name), { force: true })
    }
  }

  const fmt = b => `${(b / 1e6).toFixed(2)} MB`
  const pct = (a, b) => `${(100 * (1 - b / a)).toFixed(1)}%`
  console.log(`[build-icons] ${files.length - failed}/${files.length} ok${failed ? ` (${failed} failed)` : ''}, ${hits} from cache`)
  console.log(`[build-icons] PNG  ${fmt(srcTotal)} → ${fmt(pngTotal)} (${pct(srcTotal, pngTotal)} smaller)`)
  console.log(`[build-icons] WebP ${fmt(webpTotal)} (${pct(srcTotal, webpTotal)} smaller than source PNG)`)
}

main().catch(err => { console.error(err); process.exit(1) })
