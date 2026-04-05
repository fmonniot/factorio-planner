#!/usr/bin/env node
/**
 * trace-recipe-chain.js
 *
 * Traces the full recipe dependency chain for one or more goal items against
 * a Nullius (or vanilla) game-data.json export and emits two artefacts:
 *
 *   stdout  – a clean solver fixture JSON  { description, goals, nodes }
 *             ready to be saved as  spec/solver-chains/<name>.fixture.json
 *             and loaded by the integration test.
 *
 *   --md <path>  – optional: write a human-readable Markdown chain document
 *                  to <path> for review.
 *
 * Usage:
 *   node scripts/trace-recipe-chain.js <game-data.json> \
 *        <itemId>[:<rate>] [<itemId>[:<rate>] ...] \
 *        [--md <markdown-output-path>]
 *
 * Example:
 *   node scripts/trace-recipe-chain.js data/samples/nullius/game-data.json \
 *        chemical-science-pack:60 \
 *        --md spec/solver-chains/chemical-science-pack.md \
 *        > spec/solver-chains/chemical-science-pack.fixture.json
 */

import { readFileSync, writeFileSync } from 'node:fs'

// ── CLI parsing ──────────────────────────────────────────────────────────────

const args = process.argv.slice(2)
if (args.length < 2) {
  console.error('Usage: node scripts/trace-recipe-chain.js <game-data.json> <itemId>[:<rate>] ... [--md <path>]')
  process.exit(1)
}

let mdPath = null
const filteredArgs = []
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--md') {
    mdPath = args[++i]
  } else {
    filteredArgs.push(args[i])
  }
}

const [dataPath, ...goalArgs] = filteredArgs
if (!dataPath || goalArgs.length === 0) {
  console.error('Error: missing game-data path or goal items.')
  process.exit(1)
}

// ── Load and normalise game data ─────────────────────────────────────────────

const raw = JSON.parse(readFileSync(dataPath, 'utf8'))

// The Lua exporter emits {} for empty arrays; normalise before iteration.
function normArray(v) {
  if (Array.isArray(v)) return v
  if (v != null && typeof v === 'object' && Object.keys(v).length === 0) return []
  return v ?? []
}
for (const r of Object.values(raw.recipes)) {
  r.ingredients = normArray(r.ingredients)
  r.products    = normArray(r.products)
  r.madeIn      = normArray(r.madeIn)
}

const { recipes, items, defaultMachines } = raw

// ── Goal parsing ─────────────────────────────────────────────────────────────

const goals = goalArgs.map((arg, i) => {
  const [itemId, rateStr] = arg.split(':')
  return { id: `goal-${i + 1}`, itemId, rate: rateStr ? parseFloat(rateStr) : 60 }
})

// ── Recipe lookup ─────────────────────────────────────────────────────────────

/** First recipe that produces itemId, preferring a recipe with the same id. */
function findProducerRecipe(itemId) {
  if (recipes[itemId]?.products.some(p => p.itemId === itemId)) {
    return recipes[itemId]
  }
  for (const r of Object.values(recipes)) {
    if (r.products.some(p => p.itemId === itemId)) return r
  }
  return null
}

// ── Recursive chain tracing ───────────────────────────────────────────────────

/**
 * DFS with explicit cycle detection.
 *
 * visited       – items already fully traced
 * stack         – items currently on the DFS call stack (in-progress)
 * cycleRecipes  – recipe IDs whose processing directly caused a cycle re-entry.
 *                 These are the BOXING recipes (e.g. nullius-box-iron-ore) that
 *                 consume an item (iron-ore) already on the DFS stack.
 * cycleTargets  – item IDs that were on the DFS stack when re-encountered
 *                 (the "ancestor" items, e.g. iron-ore).  Used only for the
 *                 human-readable tree rendering; NOT used for exclusion logic.
 *
 * Returns true if this item was found to be a cycle target (already on the
 * stack), so the caller can record its recipe as cycle-causing.
 */
function traceChain(itemId, visited = new Map(), stack = new Set(), cycleRecipes = new Set(), cycleTargets = new Set(), depth = 0) {
  // Already fully traced OR currently being traced (in-progress guard via visited).
  if (visited.has(itemId)) {
    if (stack.has(itemId)) {
      cycleTargets.add(itemId)
      return true   // signal to caller: this ingredient is a cycle target
    }
    return false    // shared node, already fully resolved — not a cycle
  }

  const recipe     = findProducerRecipe(itemId)
  const itemName   = items[itemId]?.name ?? itemId

  if (!recipe) {
    visited.set(itemId, { itemId, itemName, recipe: null, depth, ingredients: [] })
    return false
  }

  // Set visited BEFORE recursing so re-entrant calls see this item as in-progress.
  stack.add(itemId)
  const entry = { itemId, itemName, recipe, depth, ingredients: [] }
  visited.set(itemId, entry)

  for (const ing of recipe.ingredients) {
    const isCycleTarget = traceChain(ing.itemId, visited, stack, cycleRecipes, cycleTargets, depth + 1)
    if (isCycleTarget) {
      // THIS recipe directly consumed a cycle-ancestor ingredient — it is the
      // cycle-causer (e.g. nullius-box-iron-ore consuming iron-ore).
      cycleRecipes.add(recipe.id)
    }
    entry.ingredients.push(ing.itemId)
  }

  stack.delete(itemId)
  return false
}

// ── Build human-readable tree ─────────────────────────────────────────────────

/**
 * Recursively render the chain as indented text lines.
 * `seen` prevents re-expanding shared nodes (shows a back-reference instead).
 */
function buildTree(itemId, visited, cycleIds, indent = 0, seen = new Set()) {
  const entry = visited.get(itemId)
  if (!entry) return []

  const prefix  = '  '.repeat(indent)
  const lines   = []
  const isCycle = cycleIds.has(itemId)

  if (!entry.recipe || isCycle) {
    const tag = isCycle ? ' *(cycle — also ingredient of this recipe)*' : ''
    lines.push(`${prefix}- **${entry.itemName}** \`${itemId}\` ← raw${tag}`)
    return lines
  }

  if (seen.has(itemId)) {
    lines.push(`${prefix}- *${entry.recipe.name}* → **${entry.itemName}** ← *(shared node, see above)*`)
    return lines
  }

  seen.add(itemId)

  const r             = entry.recipe
  const machine       = defaultMachines[r.category] ?? r.madeIn[0] ?? 'unknown'
  const outputProduct = r.products.find(p => p.itemId === itemId)
  const outputAmt     = outputProduct ? outputProduct.amount : '?'

  const inputStr  = r.ingredients.map(i => `${i.amount}× ${items[i.itemId]?.name ?? i.itemId}`).join(', ')
  const outputStr = r.products.map(p => {
    const prob = (p.probability != null && p.probability < 1) ? ` (p=${p.probability})` : ''
    return `${p.amount}× ${items[p.itemId]?.name ?? p.itemId}${prob}`
  }).join(', ')

  lines.push(`${prefix}- **${r.name}** \`${r.id}\` → ${outputAmt}× **${entry.itemName}**`)
  lines.push(`${prefix}  - machine: \`${machine}\`  |  time: ${r.craftingTime}s`)
  lines.push(`${prefix}  - inputs:  ${inputStr}`)
  lines.push(`${prefix}  - outputs: ${outputStr}`)

  for (const ingId of entry.ingredients) {
    lines.push(...buildTree(ingId, visited, cycleIds, indent + 1, seen))
  }
  return lines
}

// ── Run the trace ─────────────────────────────────────────────────────────────

const visited      = new Map()
const stack        = new Set()
const cycleRecipes = new Set()   // recipe IDs to exclude (cycle-causers)
const cycleTargets = new Set()   // item IDs that are cycle ancestors (for display)
for (const g of goals) {
  traceChain(g.itemId, visited, stack, cycleRecipes, cycleTargets, 0)
}

// ── Build fixture: plan nodes (one per recipe found) ─────────────────────────

// cycleRecipes contains recipe IDs (e.g. nullius-box-iron-ore) that directly
// caused a cycle re-entry.  Excluding them prevents the solver from seeing an
// underdetermined loop; their consumed items (iron-ore, copper-ore) become raw
// external inputs.  Recipes that merely USE the same items (e.g. iron-plate)
// are NOT excluded — they legitimately depend on those raw items.
function isCycleCausing(recipe) {
  return cycleRecipes.has(recipe.id)
}

let nodeSeq = 1
const nodes = []
const recipesSeen = new Set()
const excludedRecipes = new Set()

// Deterministic order: BFS from goals so goal-producing nodes come first.
const queue = goals.map(g => g.itemId)
const bfsVisited = new Set()

while (queue.length > 0) {
  const itemId = queue.shift()
  if (bfsVisited.has(itemId)) continue
  bfsVisited.add(itemId)

  // Cycle-target items are treated as raw external inputs — do not expand
  // their recipe into a plan node (doing so would re-introduce the cycle).
  if (cycleTargets.has(itemId)) continue

  const entry = visited.get(itemId)
  if (!entry || !entry.recipe) continue

  if (isCycleCausing(entry.recipe)) {
    excludedRecipes.add(entry.recipe.id)
    continue  // Don't add to plan — its item input(s) are treated as raw
  }

  if (!recipesSeen.has(entry.recipe.id)) {
    recipesSeen.add(entry.recipe.id)
    nodes.push({
      id: `node-${nodeSeq++}`,
      recipeId: entry.recipe.id,
      modules: [],
      byproductPolicy: {},
    })
  }
  for (const ingId of entry.ingredients) {
    queue.push(ingId)
  }
}

// ── Summary stats ─────────────────────────────────────────────────────────────

const rawItems = [...visited.values()]
  .filter(e => !e.recipe && !cycleTargets.has(e.itemId))
  .map(e => ({ itemId: e.itemId, name: e.itemName }))

const cycleItems = [...cycleTargets].map(itemId => ({
  itemId,
  name: items[itemId]?.name ?? itemId,
}))

const goalNames = goals.map(g => `${g.rate}/min ${items[g.itemId]?.name ?? g.itemId}`).join(', ')

// ── Write Markdown (if --md was requested) ────────────────────────────────────

if (mdPath) {
  const treeLines = []
  for (const g of goals) {
    treeLines.push(...buildTree(g.itemId, visited, cycleTargets, 0, new Set()))
    treeLines.push('')
  }

  const md = [
    `# Recipe Chain: ${goalNames}`,
    '',
    `> Generated by \`scripts/trace-recipe-chain.js\`  `,
    `> Source: \`${dataPath}\``,
    '',
    '## Goals',
    '',
    ...goals.map(g => `- **${items[g.itemId]?.name ?? g.itemId}** (\`${g.itemId}\`) at **${g.rate}/min**`),
    '',
    '## Summary',
    '',
    `| | |`,
    `|---|---|`,
    `| Recipe nodes | ${nodes.length} |`,
    `| Raw inputs | ${rawItems.length > 0 ? rawItems.map(r => `\`${r.itemId}\``).join(', ') : '*(none — all items derived by recipe)*'} |`,
    `| Cycle items | ${cycleItems.length > 0 ? cycleItems.map(c => `\`${c.itemId}\``).join(', ') : '*(none)*'} |`,
    `| Excluded (cycle-causing) | ${excludedRecipes.size > 0 ? [...excludedRecipes].map(r => `\`${r}\``).join(', ') : '*(none)*'} |`,
    '',
    '## Dependency Tree',
    '',
    '> Each indented level is an ingredient of the item above it.',
    '> Shared nodes are shown once; subsequent references say *(shared node, see above)*.',
    '> Cycle items (e.g. boxing loops) are marked *(cycle)*.',
    '',
    ...treeLines,
    '## Fixture',
    '',
    '```json',
    JSON.stringify({ description: goalNames, goals, nodes }, null, 2),
    '```',
  ].join('\n')

  writeFileSync(mdPath, md, 'utf8')
  process.stderr.write(`Markdown written to ${mdPath}\n`)
}

process.stderr.write(
  `Traced ${nodes.length} recipe nodes, ${rawItems.length} raw inputs, ` +
  `${cycleItems.length} cycle items, ${excludedRecipes.size} cycle-causing recipes excluded\n`,
)

// ── Emit fixture JSON ─────────────────────────────────────────────────────────

console.log(JSON.stringify({ description: goalNames, goals, nodes }, null, 2))
