#!/usr/bin/env node
// Solves an exported plan (the JSON from the workspace menu's "Export plan") with the app's own
// solver and prints what one block came out as: rows, left-over items, imports, warnings and
// connection flows. Optional what-if edits (pin, drop, sourcing, no-area) answer "what would it
// do if...?" without touching the file. The logic is src/solver/inspect.ts; this file only reads
// the files and loads that module through Vite so TypeScript needs no build step.
// Usage: node scripts/inspect-plan.mjs --help
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { createServer } from 'vite'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const HELP = `Usage: node scripts/inspect-plan.mjs <plan.json> [options]

  --block <name|id>        block to describe (default: the plan's active block)
  --list                   list the blocks of the plan and exit
  --data <id|path>         game data: a folder name in public/data/ or a game-data.json path
                           (default: from the plan's data set stamp)
  --pin <recipe=rate>      pin every row of a recipe to executions/min (repeatable)
  --drop <recipe>          remove every row of a recipe (repeatable)
  --sourcing <item=mode>   byproducts-first | connections-first for an item (repeatable)
  --no-area                clear the area flag of the block's sub-factories
  --all-rows               also list rows that solved to zero
  --all-items              also list balanced items and idle connections
  --json                   print the report as JSON
  --help
`

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    block: { type: 'string' },
    list: { type: 'boolean' },
    data: { type: 'string' },
    pin: { type: 'string', multiple: true },
    drop: { type: 'string', multiple: true },
    sourcing: { type: 'string', multiple: true },
    'no-area': { type: 'boolean' },
    'all-rows': { type: 'boolean' },
    'all-items': { type: 'boolean' },
    json: { type: 'boolean' },
    help: { type: 'boolean' },
  },
})

if (values.help || positionals.length !== 1) {
  console.log(HELP)
  process.exit(values.help ? 0 : 1)
}

function fail(message) {
  console.error(message)
  process.exit(1)
}

function pairs(list, what) {
  return Object.fromEntries(
    (list ?? []).map(entry => {
      const at = entry.lastIndexOf('=')
      if (at <= 0) fail(`${what} expects name=value, got "${entry}"`)
      return [entry.slice(0, at), entry.slice(at + 1)]
    }),
  )
}

const planJson = readFileSync(positionals[0], 'utf8')
const stampId = JSON.parse(planJson).dataSet?.id

function dataPath() {
  const data = values.data ?? stampId
  if (!data) fail('The plan has no data set stamp; pass --data <id|path>')
  if (existsSync(data) && !existsSync(join(root, 'public/data', data))) return resolve(data)
  const folders = readdirSync(join(root, 'public/data'))
  const folder = folders.find(f => f === data) ?? folders.find(f => data.includes(f) || f.includes(data))
  if (!folder) fail(`No game data "${data}" in public/data/ (${folders.join(', ')}); pass --data <path>`)
  return join(root, 'public/data', folder, 'game-data.json')
}

const server = await createServer({
  root,
  configFile: false,
  logLevel: 'error',
  appType: 'custom',
  server: { middlewareMode: true, hmr: false, ws: false },
  optimizeDeps: { noDiscovery: true },
})
try {
  const { loadAppStateFromJson, loadGameDataFromJson } = await server.ssrLoadModule('/src/data/loader.ts')
  const { inspectPlan, formatReport, findBlock } = await server.ssrLoadModule('/src/solver/inspect.ts')
  const appState = loadAppStateFromJson(planJson)

  if (values.list) {
    for (const b of appState.blocks) console.log(`${b.id}  ${b.name}`)
    process.exit(0)
  }

  const gameData = loadGameDataFromJson(readFileSync(dataPath(), 'utf8'))
  const block = values.block ?? findBlock(appState, appState.activeBlockId).name
  const pins = Object.fromEntries(Object.entries(pairs(values.pin, '--pin')).map(([k, v]) => [k, Number(v)]))
  if (Object.values(pins).some(v => !(v > 0))) fail('--pin rates must be positive numbers')
  const report = inspectPlan(appState, gameData, block, {
    pins,
    drop: values.drop,
    sourcing: pairs(values.sourcing, '--sourcing'),
    noArea: values['no-area'],
  })
  console.log(
    values.json ? JSON.stringify(report, null, 2) : formatReport(report, { allRows: values['all-rows'], allItems: values['all-items'] }),
  )
} catch (e) {
  fail(e instanceof Error ? e.message : String(e))
} finally {
  await server.close()
}
