// Packs the icons used by an extract-content.mjs output into one sprite sheet (sprite.webp, 56 px cells,
// 16 columns) and a compact data.json, ready to upload as assets of the design artifact.
//   node initiatives/visual-refinement/pack-assets.mjs <content.json> <out-dir>
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const sharp = (await import(repo + '/node_modules/sharp/dist/index.mjs')).default
const [contentPath, outDir] = process.argv.slice(2)
if (!contentPath || !outDir) { console.error('usage: pack-assets.mjs <content.json> <out-dir>'); process.exit(1) }
mkdirSync(outDir, { recursive: true })
const c = JSON.parse(readFileSync(contentPath, 'utf8'))
// only items actually used by a chip
const used = new Set()
const useRow = r => { ['products','byproducts','ingredients'].forEach(k => r[k].forEach(([id]) => used.add(id))); (r.children ?? []).forEach(useRow) }
for (const b of Object.values(c.blocks)) { for (const k of ['p','b','i']) b.panes[k].slots.forEach(sl => used.add(sl.i)); b.rows.forEach(useRow) }
const ids = [...used]; const idx = new Map(ids.map((id, i) => [id, i]))
const COLS = 16, CELL = 56, composites = []
const sprite = {}
for (let i = 0; i < ids.length; i++) {
  const ic = c.items[ids[i]].icon
  if (!ic) continue
  const buf = await sharp(repo + '/public' + ic).resize(CELL, CELL, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer()
  composites.push({ input: buf, left: (i % COLS) * CELL, top: Math.floor(i / COLS) * CELL }); sprite[i] = 1
}
const rows = Math.ceil(ids.length / COLS)
await sharp({ create: { width: COLS * CELL, height: rows * CELL, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite(composites).webp({ quality: 78 }).toFile(outDir + '/sprite.webp')
const r2 = x => +x.toPrecision(4)
const chips = a => a.map(([id, v]) => [idx.get(id), r2(v)])
const out = { cols: COLS, cell: CELL, items: ids.map((id, i) => [c.items[id].name, sprite[i] ? i : -1]), blocks: {} }
const paneOut = pn => ({ slots: pn.slots.map(sl => ({ ...sl, i: idx.get(sl.i), r: r2(sl.r), en: sl.en.map(e => ({ ...e, w: r2(e.w) })) })), ov: pn.ov.map(o => ({ ...o, w: r2(o.w) })) })
for (const [n, b] of Object.entries(c.blocks)) out.blocks[n] = { panes: { p: paneOut(b.panes.p), b: paneOut(b.panes.b), i: paneOut(b.panes.i) }, totals: b.totals,
  rows: b.rows.map(function row(r) { return { k: r.kind, n: r.name, rc: r.recipes, m: r.machines, p: Math.round(r.powerKw * 10) / 10, mod: r.modules ?? 0, pr: chips(r.products), bp: chips(r.byproducts), ig: chips(r.ingredients), ...(r.children ? { ch: r.children.map(row) } : {}) } }) }
writeFileSync(outDir + '/data.json', JSON.stringify(out))
console.log(ids.length, 'items', COLS * CELL + 'x' + rows * CELL)
