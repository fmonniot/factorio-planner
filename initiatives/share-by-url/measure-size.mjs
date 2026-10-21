// Measures how long a share-by-URL link would be for an exported plan.
// Usage: node initiatives/share-by-url/measure-size.mjs [plan.json]
// Defaults to the bundled sample plan. See plan.md for the findings.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { brotliCompressSync, constants, deflateRawSync } from 'node:zlib'

const here = dirname(fileURLToPath(import.meta.url))
const path = process.argv[2] ?? join(here, 'sample-plan-middle-ring.json')

const raw = readFileSync(path)
const json = JSON.parse(raw)
const minified = JSON.stringify(json)

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g
const uuids = minified.match(UUID) ?? []
const shortIds = new Map()
const renumbered = minified.replace(UUID, (u) => {
  if (!shortIds.has(u)) shortIds.set(u, shortIds.size.toString(36))
  return shortIds.get(u)
})

// base64url length of the compressed bytes = the length of the link fragment.
const linkChars = (bytes) => bytes.toString('base64url').length
const deflate = (s) => deflateRawSync(s, { level: 9 })
const brotli = (s) =>
  brotliCompressSync(s, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } })

console.log(`file ${raw.length} B, minified ${minified.length} B`)
console.log(`uuids: ${uuids.length} occurrences, ${shortIds.size} distinct`)
console.log('\nLink length (base64url chars):')
console.log(`  deflate-raw, as exported      ${linkChars(deflate(minified))}`)
console.log(`  brotli,      as exported      ${linkChars(brotli(minified))}`)
console.log(`  deflate-raw, ids renumbered   ${linkChars(deflate(renumbered))}`)
console.log(`  brotli,      ids renumbered   ${linkChars(brotli(renumbered))}`)

console.log('\nSize per top-level key (minified JSON B):')
for (const [key, value] of Object.entries(json)) {
  console.log(`  ${key.padEnd(24)}${JSON.stringify(value).length}`)
}
