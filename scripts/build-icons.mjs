#!/usr/bin/env node
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { cpus } from 'node:os'
import sharp from 'sharp'

const ROOT = 'dist/data'
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

async function processOne(pngPath) {
  const original = await readFile(pngPath)
  const [webp, optimized] = await Promise.all([
    sharp(original).webp({ quality: 80, effort: 4 }).toBuffer(),
    sharp(original).png({ palette: true, quality: 80, compressionLevel: 9 }).toBuffer(),
  ])
  await Promise.all([
    writeFile(pngPath.replace(/\.png$/, '.webp'), webp),
    writeFile(pngPath, optimized),
  ])
  return { src: original.length, png: optimized.length, webp: webp.length }
}

async function main() {
  const files = []
  for await (const p of walkPng(ROOT)) files.push(p)
  if (files.length === 0) {
    console.log(`[build-icons] no PNGs under ${ROOT}/ — nothing to do`)
    return
  }
  console.log(`[build-icons] processing ${files.length} icons (concurrency=${CONCURRENCY})…`)

  let srcTotal = 0, pngTotal = 0, webpTotal = 0, failed = 0
  let cursor = 0
  async function worker() {
    while (cursor < files.length) {
      const idx = cursor++
      try {
        const r = await processOne(files[idx])
        srcTotal += r.src; pngTotal += r.png; webpTotal += r.webp
      } catch (err) {
        failed++
        process.stderr.write(`[build-icons] failed ${files[idx]}: ${err.message}\n`)
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker))

  const fmt = b => `${(b / 1e6).toFixed(2)} MB`
  const pct = (a, b) => `${(100 * (1 - b / a)).toFixed(1)}%`
  console.log(`[build-icons] ${files.length - failed}/${files.length} ok${failed ? ` (${failed} failed)` : ''}`)
  console.log(`[build-icons] PNG  ${fmt(srcTotal)} → ${fmt(pngTotal)} (${pct(srcTotal, pngTotal)} smaller)`)
  console.log(`[build-icons] WebP ${fmt(webpTotal)} (${pct(srcTotal, webpTotal)} smaller than source PNG)`)
}

main().catch(err => { console.error(err); process.exit(1) })
