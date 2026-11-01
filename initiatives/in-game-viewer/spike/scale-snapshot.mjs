// Throwaway (Phase 0 step 0): scales spike/snapshot-1x.json to ten times the sample and prints sizes.
// Usage: node initiatives/in-game-viewer/spike/scale-snapshot.mjs initiatives/in-game-viewer/spike
// snapshot-1x.json was produced by solving the share-by-url sample (after AppStateSchema.parse) with the Seablock data and projecting the fields listed in plan.md "What is sent".
import { readFileSync, writeFileSync } from 'node:fs'
import { brotliCompressSync, deflateRawSync, gzipSync } from 'node:zlib'
const dir = process.argv[2]
const s = JSON.parse(readFileSync(`${dir}/snapshot-1x.json`, 'utf8'))
for (const b of s.blocks) console.log(b.name.padEnd(22), 'rows', b.rows.length, 'imports', b.imports.length, 'products', b.products.length, 'warn', b.warnings.length, 'conns', b.connections.length)
const scale = (k) => ({ ...s, blocks: Array.from({ length: k }, (_, i) => s.blocks.map(b => ({ ...b, id: `${b.id}${i}`, name: `${b.name} ${i}`, connections: b.connections.map(c => ({ ...c, from: `${c.from}${i}` })) }))).flat() })
const report = (label, o) => {
  const j = JSON.stringify(o)
  const bl = o.blocks
  const maxBlock = Math.max(...bl.map(b => JSON.stringify(b).length))
  console.log(`${label}: ${bl.length} blocks, ${bl.reduce((a, b) => a + b.rows.length, 0)} rows; ${j.length} B JSON, largest block ${maxBlock} B; deflate ${deflateRawSync(j).length} B, brotli ${brotliCompressSync(j).length} B; base64 of JSON ${Buffer.from(j).toString('base64').length} B`)
}
report('1x ', scale(1)); report('10x', scale(10))
writeFileSync(`${dir}/snapshot-10x.json`, JSON.stringify(scale(10)))
