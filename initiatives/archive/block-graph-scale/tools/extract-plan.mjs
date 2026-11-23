#!/usr/bin/env node
// Step 1 of the prototype's data pipeline: solve an exported plan with the app's own solver and layout code and write
//   <out>/data.json     blocks, every connection flow (rate, status, request/take) and today's layout (nodes, edges, paths)
//   <out>/fixture.json  the layout-only fixture: blocks with their input connections (real ids), no rows
// Usage: node initiatives/archive/block-graph-scale/tools/extract-plan.mjs <plan.json> <out-dir>
// The data set is read from the plan's stamp (public/data/<id>/game-data.json), as scripts/inspect-plan.mjs does.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')
const [planPath, outDir] = process.argv.slice(2)
if (!planPath || !outDir) {
  console.error('Usage: node extract-plan.mjs <plan.json> <out-dir>')
  process.exit(1)
}
mkdirSync(outDir, { recursive: true })
const planJson = readFileSync(planPath, 'utf8')

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
  const { inspectPlan } = await server.ssrLoadModule('/src/solver/inspect.ts')
  const { layoutBlockGraph, edgePath } = await server.ssrLoadModule('/src/utils/blockGraphLayout.ts')
  const state = loadAppStateFromJson(planJson)
  const stamp = JSON.parse(planJson).dataSet
  const gameData = loadGameDataFromJson(readFileSync(join(root, 'public/data', stamp.id, 'game-data.json'), 'utf8'))

  const out = { blocks: state.blocks.map(b => ({ id: b.id, name: b.name, color: b.color })), flows: [], layout: null, names: {} }
  for (const b of state.blocks) {
    // inspectPlan solves the whole plan; keep the flows that end in this block, so each flow is taken once.
    const report = inspectPlan(state, gameData, b.name, {})
    for (const f of report.flows) {
      if (f.toBlockId !== b.id) continue
      out.flows.push({ from: f.fromBlockId, to: f.toBlockId, item: f.itemId, rate: f.rate, available: f.available, status: f.status, kind: f.kind, maxRate: f.maxRate })
      const item = gameData.items?.[f.itemId] ?? gameData.items?.find?.(i => i.id === f.itemId)
      out.names[f.itemId] = item?.name ?? f.itemId
    }
  }
  const layout = layoutBlockGraph(state.blocks)
  out.layout = { nodes: layout.nodes, width: layout.width, height: layout.height, edges: layout.edges.map(e => ({ ...e, path: edgePath(e) })) }
  writeFileSync(join(outDir, 'data.json'), JSON.stringify(out))

  const fixture = {
    blocks: state.blocks.map(b => ({
      id: b.id, name: b.name, color: b.color,
      connections: b.inputConnections.map(c => ({ id: c.id, itemId: c.itemId, fromBlockId: c.fromBlockId })),
    })),
  }
  writeFileSync(join(outDir, 'fixture.json'), JSON.stringify(fixture, null, 1) + '\n')
  console.error(`blocks ${out.blocks.length}, flows ${out.flows.length}, today's layout ${layout.width} × ${layout.height}`)
} finally {
  await server.close()
}
