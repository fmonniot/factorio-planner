#!/usr/bin/env node
// Step 2 of the prototype's data pipeline, and the reference implementation of option A's layout.
// Reads <dir>/data.json (from extract-plan.mjs) and writes
//   <dir>/scenes.json     the intermediate result (tidy layout, plus the hub-rail layouts the owner dropped)
//   <dir>/graph-data.js   the compact `window.BG` data file the artifact loads (artifact/project/graph-data.js)
// Usage: node initiatives/block-graph-scale/tools/layout-prototype.mjs <dir>
// What it does, in order: group flows into (source, consumer) edges; order the blocks with the Eades-Lin-Smyth
// heuristic then local moves to minimise back edges; layer by longest path over the forward edges; add a dummy
// vertex per skipped column; order each layer with 24 barycenter sweeps plus a transposition pass; place rows by
// barycenter relaxation with minimum gaps; emit each forward edge as a polyline through its dummies.
// A throwaway prototype: ticket 1 of plan.md ports the idea into src/utils/blockGraphLayout.ts with tests.
import { join } from 'node:path'
const DIR = process.argv[2]
if (!DIR) { console.error('Usage: node layout-prototype.mjs <dir>'); process.exit(1) }
import { readFileSync, writeFileSync } from 'node:fs'
const D = JSON.parse(readFileSync(join(DIR, 'data.json'), 'utf8'))
const ids = D.blocks.map(b => b.id)
const short = Object.fromEntries(D.blocks.map((b, i) => [b.id, 'b' + i]))
const name = Object.fromEntries(D.blocks.map(b => [b.id, b.name]))
// edges grouped by pair
const pairMap = new Map()
for (const f of D.flows) {
  const k = f.from + '>' + f.to
  if (!pairMap.has(k)) pairMap.set(k, { from: f.from, to: f.to, items: [] })
  pairMap.get(k).items.push({ n: D.names[f.item] ?? f.item, r: +f.rate.toFixed(2), s: f.status, k: f.kind })
}
const pairs = [...pairMap.values()]

// Eades-Lin-Smyth ordering -> minimal-ish feedback arc set
function els(nodes, edges) {
  const out = new Map(nodes.map(n => [n, new Set()])), inn = new Map(nodes.map(n => [n, new Set()]))
  for (const e of edges) { out.get(e.from).add(e.to); inn.get(e.to).add(e.from) }
  const left = [], right = []; const rem = new Set(nodes)
  const del = n => { rem.delete(n); for (const m of out.get(n)) inn.get(m).delete(n); for (const m of inn.get(n)) out.get(m).delete(n) }
  while (rem.size) {
    let moved = true
    while (moved) { moved = false
      for (const n of [...rem]) if (out.get(n).size === 0) { right.unshift(n); del(n); moved = true }
      for (const n of [...rem]) if (rem.has(n) && inn.get(n).size === 0) { left.push(n); del(n); moved = true } }
    if (rem.size) { let best = null, bv = -1e9
      for (const n of rem) { const v = out.get(n).size - inn.get(n).size; if (v > bv) { bv = v; best = n } }
      left.push(best); del(best) }
  }
  return [...left, ...right]
}
function buildScene(hideSet, opts = {}) {
  const nodes = ids.filter(i => !hideSet.has(i))
  const edges = pairs.filter(p => !hideSet.has(p.from) && !hideSet.has(p.to))
  const connected = new Set(); edges.forEach(e => { connected.add(e.from); connected.add(e.to) })
  const act = nodes.filter(n => connected.has(n)), iso = nodes.filter(n => !connected.has(n))
  // refine ELS order by local search: minimise back weight (count of edges), tiebreak plan order
  let order = els(act, edges)
  const pos = () => Object.fromEntries(order.map((n, i) => [n, i]))
  const backCount = () => { const p = pos(); return edges.filter(e => p[e.from] > p[e.to]).length }
  let improved = true
  while (improved) { improved = false
    for (let i = 0; i < order.length; i++) for (let j = 0; j < order.length; j++) { if (i === j) continue
      const o2 = order.slice(); const [x] = o2.splice(i, 1); o2.splice(j, 0, x)
      const cur = backCount(); const save = order; order = o2; if (backCount() < cur) { improved = true } else order = save } }
  const p = pos()
  const isBack = e => p[e.from] > p[e.to]
  // layering: longest path over forward edges
  const layer = Object.fromEntries(act.map(n => [n, 0]))
  for (let it = 0; it < act.length + 2; it++) for (const e of edges) if (!isBack(e)) layer[e.to] = Math.max(layer[e.to], layer[e.from] + 1)
  const L = Math.max(0, ...Object.values(layer)) + 1
  // dummy chains for forward edges spanning >1 layer
  const V = {} // id -> {layer, dummy}
  act.forEach(n => V[n] = { id: n, layer: layer[n], dummy: false })
  const segs = [] // {a,b}
  const eInfo = []
  edges.forEach((e, ei) => {
    if (isBack(e)) { eInfo.push({ e, ei, back: true, chain: [e.from, e.to] }); return }
    let prev = e.from; const chain = [e.from]
    for (let l = layer[e.from] + 1; l < layer[e.to]; l++) { const id = `d${ei}_${l}`; V[id] = { id, layer: l, dummy: true }; segs.push([prev, id]); prev = id; chain.push(id) }
    segs.push([prev, e.to]); chain.push(e.to); eInfo.push({ e, ei, back: false, chain })
  })
  // order within layers with barycenter sweeps
  const layers = Array.from({ length: L }, () => [])
  Object.values(V).forEach(v => layers[v.layer].push(v.id))
  layers.forEach(l => l.sort((a, b) => (p[a] ?? 99) - (p[b] ?? 99) || a.localeCompare(b)))
  const adjUp = {}, adjDn = {}; Object.keys(V).forEach(k => { adjUp[k] = []; adjDn[k] = [] })
  segs.forEach(([a, b]) => { adjDn[a].push(b); adjUp[b].push(a) })
  // also pull back edges' endpoints toward each other slightly (soft)
  const rowOf = () => { const r = {}; layers.forEach(l => l.forEach((id, i) => r[id] = i)); return r }
  const crossings = () => { let c = 0; const r = rowOf()
    for (let l = 0; l + 1 < L; l++) { const ss = segs.filter(([a, b]) => V[a].layer === l && V[b].layer === l + 1)
      for (let i = 0; i < ss.length; i++) for (let j = i + 1; j < ss.length; j++) { const [a, b] = ss[i], [c2, d] = ss[j]; if ((r[a] - r[c2]) * (r[b] - r[d]) < 0) c++ } } return c }
  let best = layers.map(l => l.slice()), bestC = crossings()
  for (let sweep = 0; sweep < 24; sweep++) {
    const down = sweep % 2 === 0
    const r = rowOf()
    const idxs = down ? [...Array(L).keys()].slice(1) : [...Array(L).keys()].reverse().slice(1)
    for (const l of idxs) { const nb = down ? adjUp : adjDn
      const bc = {}; layers[l].forEach((id, i) => { const ns = nb[id]; bc[id] = ns.length ? ns.reduce((s, x) => s + r[x], 0) / ns.length : i })
      layers[l].sort((a, b) => bc[a] - bc[b]); layers[l].forEach((id, i) => r[id] = i) }
    const c = crossings(); if (c < bestC) { bestC = c; best = layers.map(l => l.slice()) }
  }
  // transposition refinement
  let cur = best.map(l => l.slice()); layers.forEach((_, i) => layers[i] = cur[i].slice()); let curC = crossings()
  for (let pass = 0; pass < 6; pass++) { let ch = false
    for (let l = 0; l < L; l++) for (let i = 0; i + 1 < layers[l].length; i++) { const t = layers[l][i]; layers[l][i] = layers[l][i + 1]; layers[l][i + 1] = t
      const c = crossings(); if (c < curC) { curC = c; ch = true } else { layers[l][i + 1] = layers[l][i]; layers[l][i] = t } }
    if (!ch) break }
  const NW = opts.nodeW ?? 168, NH = opts.nodeH ?? 56, CG = opts.colGap ?? 150, RG = opts.rowGap ?? 28, DH = opts.dummyH ?? 14
  // y positions: stack each layer, then align by iterative barycenter relaxation (keeping order and min gap)
  const hOf = id => V[id].dummy ? DH : NH
  const gapOf = (a, b) => (V[a].dummy || V[b].dummy) ? 6 : RG
  const y = {}
  layers.forEach(l => { let yy = 0; l.forEach((id, i) => { if (i) yy += gapOf(l[i - 1], id); y[id] = yy + hOf(id) / 2; yy += hOf(id) }) })
  for (let it = 0; it < 12; it++) {
    const dir = it % 2 ? 1 : -1; const ls = dir === 1 ? [...Array(L).keys()] : [...Array(L).keys()].reverse()
    for (const l of ls) { const nb = id => (adjUp[id].concat(adjDn[id]))
      const want = layers[l].map(id => { const ns = nb(id); return ns.length ? ns.reduce((s, x) => s + y[x], 0) / ns.length : y[id] })
      // place maintaining order & gaps: forward pass then backward pass minimal displacement
      const ids2 = layers[l]; const tgt = want.slice()
      for (let i = 0; i < ids2.length; i++) { const minY = i === 0 ? -1e9 : y[ids2[i - 1]] + hOf(ids2[i - 1]) / 2 + gapOf(ids2[i - 1], ids2[i]) + hOf(ids2[i]) / 2; y[ids2[i]] = Math.max(tgt[i], minY) }
      for (let i = ids2.length - 2; i >= 0; i--) { const maxY = y[ids2[i + 1]] - hOf(ids2[i + 1]) / 2 - gapOf(ids2[i], ids2[i + 1]) - hOf(ids2[i]) / 2; if (y[ids2[i]] > maxY) y[ids2[i]] = maxY }
    }
  }
  const minTop = Math.min(...Object.keys(V).map(id => y[id] - hOf(id) / 2))
  Object.keys(V).forEach(id => y[id] -= minTop)
  const cx = l => l * (NW + CG)
  const nodesOut = act.map(n => ({ id: short[n], name: name[n], color: D.blocks.find(b => b.id === n).color, x: cx(V[n].layer), y: Math.round(y[n] - NH / 2), col: V[n].layer }))
  let maxY = Math.max(...nodesOut.map(n => n.y + NH))
  // isolated blocks go in a strip under the graph
  iso.forEach((n, i) => nodesOut.push({ id: short[n], name: name[n], color: D.blocks.find(b => b.id === n).color, x: i * (NW + 24), y: maxY + 72, col: -1, iso: true }))
  const width = L * (NW + CG) - CG
  // edges: forward edges through dummies as polyline -> smooth path
  const edgesOut = []
  for (const ei of eInfo) {
    const { e, back, chain } = ei
    const pts = []
    if (!back) {
      chain.forEach((id, k) => { const v = V[id]; const px = v.dummy ? cx(v.layer) + NW / 2 : (k === 0 ? cx(v.layer) + NW : cx(v.layer)); pts.push([px, y[id]])
        if (v.dummy) { pts.splice(pts.length - 1, 1, [cx(v.layer) + NW / 2 - 40, y[id]], [cx(v.layer) + NW / 2 + 40, y[id]]) } })
    }
    edgesOut.push({ from: short[e.from], to: short[e.to], n: e.items.length, back, pts, items: e.items, loop: back })
  }
  return { nodes: nodesOut, edges: edgesOut, width, height: Math.max(...nodesOut.map(n => n.y + NH)), crossings: curC, back: eInfo.filter(e => e.back).length, layers: L, NW, NH }
}
const scenes = {}
scenes.A = buildScene(new Set())
const outDeg = {}; pairs.forEach(p => outDeg[p.from] = (outDeg[p.from] || 0) + 1)
const hubs = n => ids.filter(i => (outDeg[i] || 0) >= n)
scenes.hub3 = buildScene(new Set(hubs(7))); scenes.hub3.hubs = hubs(7).map(i => short[i])
scenes.hub5 = buildScene(new Set(hubs(6))); scenes.hub5.hubs = hubs(6).map(i => short[i])
for (const [k, s] of Object.entries(scenes)) console.error(k, 'nodes', s.nodes.length, 'edges', s.edges.length, 'back', s.back, 'layers', s.layers, 'crossings', s.crossings, 'w', s.width, 'h', s.height)
console.error('hubs7', hubs(7).map(i => name[i]), 'hubs6', hubs(6).map(i => name[i]))
writeFileSync(join(DIR, 'scenes.json'), JSON.stringify({ scenes, short, pairs: pairs.map(p => ({ f: short[p.from], t: short[p.to], items: p.items })), blocks: D.blocks.map(b => ({ id: short[b.id], name: b.name, color: b.color })) }))
// today's crossings count for comparison (straight-line between layer columns) -- computed from app layout rows

// ---- compact data file for the artifact ----
const S = JSON.parse(readFileSync(join(DIR, 'scenes.json'), 'utf8'))
const sh = S.short
const r = n => Math.round(n)
const ab = { ok: 'o', limited: 'l', unused: 'u' }
const out = {}
out.blocks = S.blocks.map(b => [b.id, b.name, b.color])
out.pairs = S.pairs.map(p => [p.f, p.t, p.items.map(i => [i.n, i.r, ab[i.s], i.k === 'take' ? 't' : 'r'])])
const L = D.layout
out.today = { w: r(L.width), h: r(L.height), nodes: Object.fromEntries(Object.entries(L.nodes).map(([id, n]) => [sh[id], [r(n.x), r(n.y), n.column]])),
  edges: L.edges.map(e => [sh[e.from], sh[e.to], e.path.replace(/(\d+\.\d+)/g, m => r(+m)), r(e.labelX), r(e.labelY), e.collapsed ? 1 : 0, e.back ? 1 : 0]) }
for (const k of ['A', 'hub3', 'hub5']) {
  const s = S.scenes[k]
  out[k] = { w: r(s.width), h: r(s.height), cr: s.crossings, bk: s.back, L: s.layers,
    nodes: s.nodes.map(n => [n.id, r(n.x), r(n.y), n.col]),
    edges: s.edges.map(e => [e.from, e.to, e.back ? 1 : 0, e.pts.map(p => [r(p[0]), r(p[1])])]),
    hubs: s.hubs }
}
writeFileSync(join(DIR, 'graph-data.js'), 'window.BG = ' + JSON.stringify(out) + ';\n')
console.error(readFileSync(join(DIR, 'graph-data.js')).length)
