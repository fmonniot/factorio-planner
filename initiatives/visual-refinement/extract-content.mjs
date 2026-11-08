// Solves an exported plan with the app's own solver and writes, per block, the rows the production
// table shows (products, byproducts, ingredients, rates) as JSON for the design artifact.
//   node initiatives/visual-refinement/extract-content.mjs <plan.json> <out.json> "Hub,Metals,Ores,Extra Sulfur"
// Uses Vite's ssrLoadModule like scripts/inspect-plan.mjs. Each group or area row carries its child rows in `children`
// (recursively), so the artifact can expand it; a row's own chips are the net of everything below it.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const { createServer } = await import(repo + '/node_modules/vite/dist/node/index.js')
const [planPath, out, blockList] = process.argv.slice(2)
const names = (blockList ?? '').split(',').map(n => n.trim()).filter(Boolean)
if (!planPath || !out || !names.length) { console.error('usage: extract-content.mjs <plan.json> <out.json> "Block A,Block B"'); process.exit(1) }
const server = await createServer({ root: repo, configFile: false, logLevel: 'error', appType: 'custom',
  server: { middlewareMode: true, hmr: false, ws: false }, optimizeDeps: { noDiscovery: true } })
try {
  const { loadAppStateFromJson, loadGameDataFromJson } = await server.ssrLoadModule('/src/data/loader.ts')
  const solver = await server.ssrLoadModule('/src/solver/index.ts')
  const { solveAll } = solver
  const seg = await server.ssrLoadModule('/src/components/factory/summarySegments.ts')
  const sumRows = await server.ssrLoadModule('/src/components/factory/summaryRows.ts')
  const looks = await server.ssrLoadModule('/src/components/factory/segmentLooks.ts')
  const tile = await server.ssrLoadModule('/src/components/factory/ItemTile.tsx')
  const { isEnergyItem } = await server.ssrLoadModule('/src/data/electricity.ts')
  const json = readFileSync(planPath, 'utf8')
  const state = loadAppStateFromJson(json)
  const stamp = JSON.parse(json).dataSet?.id ?? ''
  const folder = readdirSync(repo + '/public/data').find(f => stamp.includes(f) || f.includes(stamp)) ?? 'kompetenz-seablock'
  const gd = loadGameDataFromJson(readFileSync(repo + `/public/data/${folder}/game-data.json`, 'utf8'))
  const solved = solveAll(state.blocks, gd)
  const items = {}, machines = {}
  const item = id => { const i = gd.items.find?.(x => x.id === id) ?? gd.items[id]; items[id] = { name: i?.name ?? id, icon: i?.iconPath ?? null }; return id }
  const rec = id => (gd.recipes.find?.(x => x.id === id) ?? gd.recipes[id])
  const result = { blocks: {}, items, machines }
  for (const name of names) {
    const block = state.blocks.find(b => b.name === name)
    const res = solved.results[block.id]
    const byNode = new Map(res.nodes.map(n => [n.recipeNodeId, n]))
    const sum = (plan) => { const o = {}, i = {}; let m = 0, p = 0, r = 0
      const walk = pl => { for (const n of pl.nodes) { const s = byNode.get(n.id); if (!s) continue; r++; m += s.machineCountCeil; p += s.powerKw
        for (const [k, v] of Object.entries(s.outputRates)) o[k] = (o[k] ?? 0) + v
        for (const [k, v] of Object.entries(s.inputRates)) i[k] = (i[k] ?? 0) + v }
        for (const sp of pl.subPlans) walk(sp) }
      walk(plan); return { o, i, m, p, r } }
    const chips = (obj, min) => Object.entries(obj).filter(([, v]) => v > min).sort((a, b) => b[1] - a[1]).map(([k, v]) => [item(k), v])
    const build = (plan, depth) => {
      const rows = []
      const subById = Object.fromEntries(plan.subPlans.map(s => [s.id, s]))
      for (const n of plan.nodes) {
        if (n.kind === 'subplan') {
          const sp = subById[n.subPlanId]; if (!sp) continue
          const t = sum(sp), net = {}
          for (const [k, v] of Object.entries(t.o)) net[k] = (net[k] ?? 0) + v
          for (const [k, v] of Object.entries(t.i)) net[k] = (net[k] ?? 0) - v
          const pos = Object.fromEntries(Object.entries(net).filter(([, v]) => v > 1e-6))
          const neg = Object.fromEntries(Object.entries(net).filter(([, v]) => v < -1e-6).map(([k, v]) => [k, -v]))
          rows.push({ kind: sp.area ? 'area' : 'group', name: sp.name, depth, recipes: t.r, machines: t.m, powerKw: t.p, products: chips(pos, 0), byproducts: [], ingredients: chips(neg, 0),
            children: build(sp, depth + 1) })
        } else {
          const s = byNode.get(n.id); const r = rec(n.recipeId); if (!s) continue
          const main = r?.mainProduct
          const outs = chips(s.outputRates, 0)
          const prods = main ? outs.filter(([k]) => k === main) : outs
          const byp = main ? outs.filter(([k]) => k !== main) : []
          if (n.machineId) machines[n.machineId] = true
          rows.push({ kind: 'recipe', name: r?.name ?? n.recipeId, recipeId: n.recipeId, depth, machineId: n.machineId ?? null, machines: s.machineCountCeil, powerKw: s.powerKw,
            modules: (n.modules ?? []).length, products: prods, byproducts: byp, ingredients: chips(s.inputRates, 0) })
        }
      }
      return rows
    }
    const rows = build(block.rootPlan, 0)
    const net = {}
    for (const n of res.nodes) { for (const [k, v] of Object.entries(n.outputRates)) net[k] = (net[k] ?? 0) + v; for (const [k, v] of Object.entries(n.inputRates)) net[k] = (net[k] ?? 0) - v }
    // The summary panes, computed the way FactorySummary.tsx does (same functions, rate unit "min").
    const blockById = Object.fromEntries(state.blocks.map(b => [b.id, b]))
    const nameOf = id => blockById[id]?.name
    const colorOf = id => (id !== undefined ? blockById[id]?.color : undefined)
    const allFlows = solved.flows
    const net2 = solver.netBalance(res.nodes), gross = solver.grossFlow(res.nodes)
    const inputFlows = new Map(allFlows.filter(f => f.toBlockId === block.id).map(f => [f.connectionId, f]))
    const outputFlows = allFlows.filter(f => f.fromBlockId === block.id && f.rate > solver.FLOW_TOLERANCE)
    const exportedPerMin = new Map()
    for (const f of outputFlows) exportedPerMin.set(f.itemId, (exportedPerMin.get(f.itemId) ?? 0) + f.rate)
    const requestsByItem = new Map()
    for (const f of allFlows) { if (f.fromBlockId !== block.id || f.kind !== 'request') continue; const l = requestsByItem.get(f.itemId); if (l) l.push(f); else requestsByItem.set(f.itemId, [f]) }
    const productItemIds = new Set(block.products.map(p => p.itemId))
    const byItems = [...net2].filter(([id]) => !productItemIds.has(id)).map(([id, n]) => ({ itemId: id, ratePerMin: n - (exportedPerMin.get(id) ?? 0) }))
      .filter(({ itemId, ratePerMin }) => sumRows.isLeftover(ratePerMin, gross.get(itemId) ?? 0))
    const byRows = sumRows.byproductRows(byItems, [...exportedPerMin.keys()].filter(id => !productItemIds.has(id)))
    const ingRows = sumRows.ingredientRows(block.inputConnections ?? [], (res.unsatisfied ?? []).filter(u => u.rate > 0), block.noImportItems ?? [])
    const exportsOf = id => outputFlows.filter(f => f.itemId === id)
    const blockIds = new Set(state.blocks.map(b => b.id))
    const requested = new Set(productItemIds)
    const slotsOf = {
      p: block.products.map(p => seg.productSlot(p, net2.get(p.itemId) ?? 0, exportsOf(p.itemId), 'min', requested.delete(p.itemId) ? (requestsByItem.get(p.itemId) ?? []) : [])),
      b: byRows.map(r => seg.byproductSlot(r, exportsOf(r.itemId))),
      i: ingRows.map(r => seg.ingredientSlot(r, inputFlows, blockIds)),
    }
    const lookOut = l => ({ bg: l.bg, bd: l.border, bs: l.borderStyle === 'dashed' ? 'dashed' : 'solid', lg: l.legend })
    const slotOut = slot => {
      const fmt = pm => isEnergyItem(slot.itemId) ? tile.fmtItemRateText(slot.itemId, pm / 60, 'min') : tile.fmtRate(pm / 60, 'min')
      const entries = [...slot.segments, ...slot.overlays].map(e => {
        const bn = e.blockId !== undefined ? nameOf(e.blockId) : undefined
        const t = seg.keyEntryText(e, { blockName: bn, product: slot.product, fmt, nameOf })
        return { k: e.key, l: t.label, a: t.amount, n: t.note, w: 'amount' in e && slot.scale > 0 ? Math.min(1, e.amount / slot.scale) : 0, ...lookOut(looks.segmentLook(e.kind, colorOf(e.blockId), 'limited' in e && !!e.limited)) }
      })
      return { i: item(slot.itemId), r: slot.rate, st: slot.status, em: slot.empty ? 1 : 0, dm: slot.dimmed ? 1 : 0, en: entries }
    }
    const overviewOut = slots => {
      const rows = seg.overviewRows(slots)
      const maxTotal = Math.max(...rows.map(r => r.total), 0), maxPower = Math.max(...rows.map(r => r.power), 0)
      return rows.map(r => {
        const bn = r.blockId !== undefined ? nameOf(r.blockId) : undefined
        const total = r.kind === 'unused' ? 'unused' : r.total > 0 ? tile.fmtRate(r.total / 60, 'min') : r.power > 0 ? tile.fmtEnergyText(r.power / 60) : '\u2014'
        const share = r.total > 0 ? (maxTotal > 0 ? r.total / maxTotal : 0) : r.power > 0 ? (maxPower > 0 ? r.power / maxPower : 0) : 0
        return { k: r.key, l: seg.segmentLabel(r, bn), t: total, c: r.count, w: share, lim: r.limited ? 1 : 0, ...lookOut(looks.segmentLook(r.kind, colorOf(r.blockId), r.limited)) }
      })
    }
    const pane = k => ({ slots: slotsOf[k].map(slotOut), ov: overviewOut(slotsOf[k]) })
    const prodIds = new Set(block.products.map(p => p.itemId))
    result.blocks[name] = {
      panes: { p: pane('p'), b: pane('b'), i: pane('i') },
      totals: { recipes: res.nodes.length, machines: res.nodes.reduce((a, n) => a + n.machineCountCeil, 0), powerKw: res.nodes.reduce((a, n) => a + n.powerKw, 0) },
      rows,
    }
  }
  for (const id of Object.keys(machines)) { const m = gd.machines?.find?.(x => x.id === id) ?? gd.machines?.[id]; machines[id] = { name: m?.name ?? id, icon: m?.iconPath ?? null } }
  writeFileSync(out, JSON.stringify(result))
  const count = rs => rs.reduce((a, r) => a + 1 + count(r.children ?? []), 0)
  for (const [n, b] of Object.entries(result.blocks)) console.log(n, 'rows', b.rows.length, 'with children', count(b.rows), 'slots', b.panes.p.slots.length, b.panes.b.slots.length, b.panes.i.slots.length, 'overview rows', b.panes.p.ov.length, b.panes.b.ov.length, b.panes.i.ov.length, b.totals)
} finally { await server.close() }
