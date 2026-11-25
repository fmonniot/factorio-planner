#!/usr/bin/env node
// Times the inputs of the Sources model (src/components/factory/useSourcesModel.ts) on an exported plan (the JSON from the
// workspace menu's "Export plan"), at block scope and at area scope, for the case where every item a table row could mark reads
// its model ("all") and for the items whose rule shows a marker ("marked"). It prints counts and milliseconds only, never a name.
// buildSourcesModel itself is left out: it is a pure walk over lines that are already built, a few microseconds.
// The list of inputs below is the hook's own (the hook is React and cannot run here): keep the two in step.
// Usage: node scripts/time-sources-model.mjs --help
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { createServer } from 'vite'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** A pass over every pair of the heaviest block above this reads as too slow (ms). */
const PASS_MS = 50
/** A single pair above this costs more than a frame (ms). */
const ROW_MS = 16

const HELP = `Usage: node scripts/time-sources-model.mjs <plan.json> [options]

  --data <id|path>         game data: a folder name in public/data/ or a game-data.json path
                           (default: from the plan's data set stamp)
  --reps <n>               timed passes after one untimed warm-up pass (default 5)
  --synthetic-areas <n>    for a plan with no areas: split the block with most rows that has none into n areas
                           (round-robin), re-solve, and time that; the output says the plan is synthetic
  --help

Prints, per block, its rows, areas, items and pairs (an item, or an item of an area), then the cost of the
inputs of the Sources model (itemMakers, buildBlockRows, areaMissingOf; at area scope supplierLines, itemMakers,
areaLPItemsOf, the kept areaLPItems), the cost of a pass over every pair ("all") and over the pairs with a rule ("marked"), and a verdict
against ${PASS_MS} ms per pass and ${ROW_MS} ms per pair. Medians of the timed passes. No name from the plan is printed.
`

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    data: { type: 'string' },
    reps: { type: 'string' },
    'synthetic-areas': { type: 'string' },
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

const reps = values.reps === undefined ? 5 : Number(values.reps)
if (!Number.isInteger(reps) || reps < 1) fail('--reps must be a positive integer')
const syntheticAreas = values['synthetic-areas'] === undefined ? undefined : Number(values['synthetic-areas'])
if (syntheticAreas !== undefined && (!Number.isInteger(syntheticAreas) || syntheticAreas < 2)) fail('--synthetic-areas must be an integer of 2 or more')

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

const median = xs => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length === 0 ? 0 : s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2
}
const sum = xs => xs.reduce((t, x) => t + x, 0)
const ms = x => (x >= 100 ? x.toFixed(0) : x >= 10 ? x.toFixed(1) : x.toFixed(2))

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
  const { solveAll } = await server.ssrLoadModule('/src/solver/index.ts')
  const { blockAreas } = await server.ssrLoadModule('/src/solver/areas.ts')
  const { areaLPItemsOf, supplierLines } = await server.ssrLoadModule('/src/components/factory/areaSources.ts')
  const { itemMakers } = await server.ssrLoadModule('/src/components/factory/sourcesMakers.ts')
  const { buildBlockRows } = await server.ssrLoadModule('/src/components/factory/sourcesRows.ts')
  const { areaMissingOf } = await server.ssrLoadModule('/src/components/factory/summaryRows.ts')
  const { rowRuleItems } = await server.ssrLoadModule('/src/components/factory/sourceRules.ts')
  const { storedAreaRule } = await server.ssrLoadModule('/src/data/subPlanTree.ts')

  const state = loadAppStateFromJson(planJson)
  const gameData = loadGameDataFromJson(readFileSync(dataPath(), 'utf8'))

  const gameNodes = plan => [...plan.nodes.filter(n => n.kind === 'game-recipe'), ...plan.subPlans.flatMap(gameNodes)]

  if (syntheticAreas !== undefined) {
    const candidates = state.blocks.filter(b => blockAreas(b.rootPlan) === undefined)
    if (candidates.length === 0) fail('Every block has areas already; nothing to split')
    const block = candidates.reduce((a, b) => (gameNodes(b.rootPlan).length > gameNodes(a.rootPlan).length ? b : a))
    const nodes = gameNodes(block.rootPlan)
    if (nodes.length < syntheticAreas) fail(`The largest block with no area has ${nodes.length} rows, fewer than --synthetic-areas ${syntheticAreas}: some areas would be empty`)
    const now = new Date().toISOString()
    const chunks = Array.from({ length: syntheticAreas }, (_, i) => ({
      id: `syn-${i}`, name: `Area ${i}`, nodes: nodes.filter((_, k) => k % syntheticAreas === i), subPlans: [], area: true, createdAt: now, updatedAt: now,
    }))
    // Built here and not with the block store, which pulls in persistence (localStorage).
    block.rootPlan = { ...block.rootPlan, nodes: [], subPlans: chunks }
    console.log(`SYNTHETIC plan: the largest block with no area (${nodes.length} rows) is split round-robin into ${syntheticAreas} areas.`)
  }

  const t0 = performance.now()
  const solved = solveAll(state.blocks, gameData)
  console.log(`solveAll: ${ms(performance.now() - t0)} ms for ${state.blocks.length} blocks, ${solved.flows.length} connection flows`)

  // The pairs: an item of a block (block scope), an item of an area of a block (area scope).
  const ingredientsOf = nodes => {
    const items = new Set()
    for (const n of nodes) for (const i of gameData.recipes[n.recipeId]?.ingredients ?? []) items.add(i.itemId)
    return [...items]
  }
  const blockInfos = []
  for (const block of state.blocks) {
    const result = solved.results[block.id]
    if (!result) continue
    const nodes = gameNodes(block.rootPlan)
    const areas = blockAreas(block.rootPlan)
    const nodeById = new Map(nodes.map(n => [n.id, n]))
    const ruleItems = rowRuleItems(block, gameData, state.blocks, undefined)
    const pairs = ingredientsOf(nodes).map(item => ({ scope: 'block', item, marked: ruleItems.has(item) }))
    for (const area of areas ?? []) {
      for (const item of ingredientsOf(area.nodeIds.map(id => nodeById.get(id)).filter(Boolean))) {
        pairs.push({ scope: 'area', item, areaId: area.id, marked: storedAreaRule(block.rootPlan, area.id, item) !== undefined })
      }
    }
    blockInfos.push({ block, result, rows: nodes.length, areas: areas?.length ?? 0, items: pairs.filter(p => p.scope === 'block').length, pairs })
  }
  if (blockInfos.length === 0) fail('No block solved')

  const rate = perMin => String(perMin)
  // One pass: every pair once, each input timed on its own. Returns, per block, per pair, the ms of each input.
  const pass = () =>
    blockInfos.map(({ block, result, pairs }) => {
      // A new block object per pass, as the store makes one per edit: the first pair of the block pays for areaLPItemsOf, the others read it.
      const edited = { ...block }
      const time = (bucket, fn) => { const s = performance.now(); fn(); return [bucket, performance.now() - s] }
      return pairs.map(p => {
        const costs = {}
        const add = ([bucket, t]) => { costs[bucket] = (costs[bucket] ?? 0) + t }
        if (p.scope === 'block') {
          add(time('itemMakers', () => itemMakers(block, gameData, result, p.item)))
          add(time('buildBlockRows', () => buildBlockRows({ block, blocks: state.blocks, flows: solved.flows, itemId: p.item, itemName: p.item, rate })))
          if (result.areaRoutes) {
            add(time('areaMissingOf', () => {
              const missingOf = areaMissingOf(block.sourceRules, block.rootPlan, result.areaRoutes)
              for (const u of result.unsatisfied.filter(u => u.itemId === p.item)) missingOf(p.item, u.rate, u.temp)
            }))
          }
        } else {
          add(time('supplierLines', () => supplierLines(block, gameData, result, p.item, p.areaId, {})))
          add(time('itemMakers (area)', () => itemMakers(block, gameData, result, p.item, p.areaId)))
          add(time('areaLPItemsOf', () => areaLPItemsOf(edited, gameData).has(p.item)))
        }
        return costs
      })
    })

  pass() // warm-up, untimed
  const runs = Array.from({ length: reps }, pass)

  // Per pair: the median over the passes of its cost (sum of its inputs).
  const pairCost = (b, k) => median(runs.map(r => sum(Object.values(r[b][k]))))
  const bucketsOf = ['itemMakers', 'buildBlockRows', 'areaMissingOf', 'supplierLines', 'itemMakers (area)', 'areaLPItemsOf']
  const passCost = (b, keep, scope) => median(runs.map(r => sum(r[b].flatMap((c, k) => (keep(blockInfos[b].pairs[k]) && (!scope || blockInfos[b].pairs[k].scope === scope) ? Object.values(c) : [])))))

  console.log(`\n${blockInfos.length} blocks solved; ${reps} timed passes after one warm-up; medians (ms)\n`)
  console.log('block  rows  areas  items  pairs   all-pass  marked-pass  marked')
  const all = () => true
  const marked = p => p.marked
  blockInfos.forEach((info, b) => {
    const nMarked = info.pairs.filter(marked).length
    console.log(
      `${String(b + 1).padStart(5)}  ${String(info.rows).padStart(4)}  ${String(info.areas).padStart(5)}  ${String(info.items).padStart(5)}  ${String(info.pairs.length).padStart(5)}  ` +
        `${ms(passCost(b, all)).padStart(8)}  ${ms(passCost(b, marked)).padStart(11)}  ${String(nMarked).padStart(6)}`,
    )
  })

  // Totals per input over every block, for the median pass.
  const calls = Object.fromEntries(bucketsOf.map(k => [k, 0]))
  for (const info of blockInfos) for (const p of info.pairs) {
    if (p.scope === 'block') { calls.itemMakers++; calls.buildBlockRows++; if (info.result.areaRoutes) calls.areaMissingOf++ }
    else { calls.supplierLines++; calls['itemMakers (area)']++; calls.areaLPItemsOf++ }
  }
  const total = k => median(runs.map(r => sum(r.flatMap(b => b.map(c => c[k] ?? 0)))))
  console.log('\nscope  input               calls   total ms   ms/call')
  for (const k of bucketsOf) {
    const scope = ['supplierLines', 'itemMakers (area)', 'areaLPItemsOf'].includes(k) ? 'area ' : 'block'
    console.log(`${scope}  ${k.padEnd(18)}  ${String(calls[k]).padStart(5)}  ${ms(total(k)).padStart(9)}  ${calls[k] ? ms(total(k) / calls[k]).padStart(8) : '       -'}`)
  }

  const heavy = (keep) => blockInfos.map((_, b) => passCost(b, keep)).reduce((m, x) => Math.max(m, x), 0)
  const maxPair = (keep, scope) => Math.max(0, ...blockInfos.flatMap((info, b) => info.pairs.map((p, k) => (keep(p) && (!scope || p.scope === scope) ? pairCost(b, k) : 0))))
  const heavyAll = heavy(all)
  const heavyMarked = heavy(marked)
  const maxAll = maxPair(all)
  console.log(`\nheaviest block, pass over every pair ("all"):    ${ms(heavyAll)} ms (block scope ${ms(Math.max(...blockInfos.map((_, b) => passCost(b, all, 'block'))))}, area scope ${ms(Math.max(...blockInfos.map((_, b) => passCost(b, all, 'area'))))})`)
  console.log(`heaviest block, pass over the marked pairs:      ${ms(heavyMarked)} ms`)
  console.log(`max single pair, block scope: ${ms(maxPair(all, 'block'))} ms; area scope: ${ms(maxPair(all, 'area'))} ms; marked: ${ms(maxPair(marked))} ms`)
  const slow = heavyAll > PASS_MS || maxAll > ROW_MS
  console.log(`\nverdict: ${slow ? 'TOO SLOW' : 'OK'} (all-pass ${ms(heavyAll)} ms against ${PASS_MS}, max pair ${ms(maxAll)} ms against ${ROW_MS})`)
} catch (e) {
  fail(e instanceof Error ? (e.stack ?? e.message) : String(e))
} finally {
  await server.close()
}
