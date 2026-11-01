#!/usr/bin/env node
// Regenerates the in-game viewer's contract files from the Zod schema and the bundled
// Seablock export: contract/snapshot.schema.json, contract/fixtures/*.json and the wire
// protocol's contract/datagrams/*.json.
// Run it after changing src/snapshot/ or the solver; the unit tests fail when the checked-in
// files differ from a fresh generation. The TypeScript sources are loaded through Vite, so
// no extra tooling is needed.
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const contractDir = join(root, 'contract')
const fixturesDir = join(contractDir, 'fixtures')
const datagramsDir = join(contractDir, 'datagrams')

const server = await createServer({
  root,
  configFile: false,
  appType: 'custom',
  logLevel: 'error',
  server: { middlewareMode: true, hmr: false, watch: null },
})
try {
  const mod = await server.ssrLoadModule('/src/test/snapshotFixtures.ts')
  const wire = await server.ssrLoadModule('/src/test/datagramFixtures.ts')

  // Build everything before touching contract/, so a failure leaves the checked-in files intact.
  const snapshots = mod.buildSnapshotFixtures()
  const files = [
    ['snapshot.schema.json', mod.toFileText(mod.buildSnapshotJsonSchema())],
    ...Object.entries(snapshots).map(([name, snapshot]) => [`fixtures/${name}.json`, mod.toFileText(snapshot)]),
    ...Object.entries(wire.buildDatagramFixtures(snapshots)).map(([name, file]) => [`datagrams/${name}.json`, mod.toFileText(file)]),
  ]

  for (const dir of [fixturesDir, datagramsDir]) {
    mkdirSync(dir, { recursive: true })
    for (const f of readdirSync(dir)) if (f.endsWith('.json')) rmSync(join(dir, f))
  }
  for (const [path, text] of files) {
    writeFileSync(join(contractDir, path), text)
    console.log(`contract/${path}`)
  }
} finally {
  await server.close()
}
