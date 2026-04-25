# Factorio Planner — Project Architecture Reference

## Key File Paths

| Path | Purpose |
|------|---------|
| `e2e/fixtures/` | Exported app-state JSON files that reproduce bugs |
| `e2e/support/loadPlan.ts` | `loadPlanFixture()` helper used by all fixture-based e2e specs |
| `e2e/*.spec.ts` | Playwright e2e specs (one file per bug/feature) |
| `src/store/solverStore.ts` | Solver entry point; `wireSolver()`, `solveBottomUp()` |
| `src/store/blockStore.ts` | Block/SubPlan tree store; `findSubPlan()`, `updateSubPlanInTree()` |
| `src/store/persistence.ts` | localStorage save/load; `APP_STATE_STORAGE_KEY` |
| `src/solver/index.ts` | `solve()` — orchestrates all solver steps |
| `src/solver/build.ts` | `buildStoichiometryMatrix()` |
| `src/solver/reduce.ts` | `reduceSystem()` — removes raw/byproduct rows |
| `src/solver/pin.ts` | `applyPinnedRates()` |
| `src/solver/solve.ts` | `solveSystem()` — LU / pseudo-inverse |
| `src/solver/effects.ts` | `computeNodeEffects()`, `computeMachineMetrics()` |
| `src/solver/subplan.ts` | `deriveSyntheticRecipe()` — child subplan → opaque recipe |
| `src/components/TreeView.tsx` | Column layout (`buildColumns`/`descend`) and node rendering |
| `src/components/RecipeCard.tsx` | Game-recipe node card; `fmtRate()` helper |
| `src/data/schema.ts` | Zod schemas + derived TypeScript types (single source of truth) |
| `src/data/loader.ts` | `parseAppState()`, `loadGameDataFromJson()` |
| `src/data/types.ts` | Re-exports schema types + transient solver types (`SolverResult`, etc.) |

---

## Fixture JSON Schema

```
AppState
├── blocks: Block[]
│   └── Block
│       ├── id: string (UUID)
│       ├── name: string
│       ├── gameDataVersion: string (usually "")
│       └── rootPlan: SubPlan (recursive)
│           ├── id: string (UUID)
│           ├── name: string
│           ├── goals: ProductionGoal[]
│           │   └── { id, itemId, rate: number (items/min) }
│           ├── nodes: RecipeNode[]  ← discriminated union
│           │   ├── GameRecipeNode
│           │   │   ├── kind: 'game-recipe'
│           │   │   ├── id: string
│           │   │   ├── recipeId: string  (key into gameData.recipes)
│           │   │   ├── machineId?: string
│           │   │   ├── modules: ModuleConfig[]
│           │   │   ├── beaconConfig?: BeaconConfig
│           │   │   ├── pinnedRate?: number  (0 coerced → undefined)
│           │   │   ├── byproductPolicy: Record<itemId, 'discard'|'feed-back'>
│           │   │   └── primaryProduct?: string
│           │   └── SubPlanNode
│           │       ├── kind: 'subplan'
│           │       ├── id: string  (node's own UUID in parent.nodes[])
│           │       ├── subPlanId: string  (references parent.subPlans[].id)
│           │       └── pinnedRate?: number  (scale multiplier)
│           ├── subPlans: SubPlan[]  (recursive children)
│           ├── createdAt: ISO8601
│           └── updatedAt: ISO8601
└── activeBlockId: string (UUID matching blocks[].id)
```

Legacy fixtures (pre-discriminated-union) omit `kind` on nodes — the schema preprocessor injects `kind: 'game-recipe'` automatically.

---

## e2e Test Patterns

### loadPlanFixture (e2e/support/loadPlan.ts)

```typescript
loadPlanFixture(
  page: Page,
  planFixturePath: string,          // absolute path to fixture JSON
  gameDataSource: 'nullius' | null  // default 'nullius'; null = skip auto-load
): Promise<void>
```

Internals: navigates to `/`, injects two localStorage keys, then reloads:
- `'factorio-planner:app-state'` → fixture JSON string
- `'factorio-planner:game-data-source'` → `'nullius'`

### Standard wait pattern (always use these two)

```typescript
await expect(page.locator('main').getByText('Load game data to begin')).not.toBeVisible({ timeout: 10000 })
await expect(page.locator('main').getByText('Solving…')).not.toBeVisible({ timeout: 10000 })
```

### CSS selectors for card types

| Card type | CSS classes | Notes |
|-----------|-------------|-------|
| Subplan card | `.bg-gray-800.border-blue-800` | `SubPlanSolvedCard` |
| Recipe card | `.bg-gray-800.border-gray-700` | `RecipeCard` |
| Solver error | `getByText(/Solver error:/)` | Caught by solverStore try/catch |

### Rate formatting (`fmtRate` in RecipeCard.tsx)

- `>= 100` → one decimal (`100.0`)
- `>= 10` → one decimal (`10.0`)
- `< 10` → two decimals (`1.23`)
- Text format in DOM: `"60.0/min"` — match with `/\/min/`

### Numeric threshold assertion (solver regression)

```typescript
const rateLocator = page.locator('main').getByText(/\/min/)
const count = await rateLocator.count()
for (let i = 0; i < count; i++) {
  const text = (await rateLocator.nth(i).textContent()) ?? ''
  const match = text.match(/([\d.]+)\/min/)
  if (!match) continue
  expect(parseFloat(match[1])).toBeLessThan(1e9)
}
```

---

## Solver Pipeline

`wireSolver()` in `solverStore.ts` subscribes to block + game data changes, debounces 150 ms, then:

```
solveBottomUp(rootPlan, gameData)
  └── visit(subPlan)  [post-order — children first]
      ├── for each child: deriveSyntheticRecipe(child, childResult)
      └── solve(subPlan, gameData, syntheticRecipes)
          ├── 1. computeNodeEffects()         effects.ts
          ├── 2. build productivityMap
          ├── 3. buildStoichiometryMatrix()   build.ts   (deduplicates recipe IDs)
          ├── 3b. apply byproductPolicy
          ├── 4. check goals have producers  → 'no-recipe' warning
          ├── 5. reduceSystem()              reduce.ts  (drop raw/byproduct rows)
          ├── 6. applyPinnedRates()          pin.ts
          ├── 7. solveSystem()               solve.ts   (LU or pseudo-inverse)
          ├── 8. mergeThroughput()
          ├── 9. assemble SolvedNode[]
          └── 10. compute UnsatisfiedItem[]
```

`SolverResult` shape:
```typescript
{ nodes: SolvedNode[], unsatisfied: UnsatisfiedItem[], warnings: SolverWarning[] }
```

`SolverWarning` types: `'cycle-detected'`, `'underdetermined'`, `'no-recipe'`, `'productivity-not-allowed'`, `'duplicate-recipe'`

Errors thrown inside `solve()` are caught by `solverStore` and surfaced as `{ type: 'error', message }` — displayed in `TreeView` as "Solver error: …". Stack overflows in `TreeView` itself (e.g. in `buildColumns`) are **not** caught there and crash the React tree instead.

---

## TreeView Rendering Architecture

### buildColumns (lines 16–75)

Assigns each `SolvedNode` a column depth (0 = closest to goal, higher = further upstream).

```
producerOf: Map<itemId, recipeNodeId>   — built from all SolvedNode.outputRates
depthOf:    Map<recipeNodeId, depth>    — filled by DFS

descend(nodeId, depth, visiting: Set):
  if visiting.has(nodeId) → return  (cycle guard — back-edge detection)
  if depthOf[nodeId] >= depth → return  (already assigned a deeper column)
  depthOf[nodeId] = depth
  visiting.add(nodeId)
  for each inputItem of this node:
    if producerOf[inputItem] exists → descend(producer, depth+1, visiting)
  visiting.delete(nodeId)
```

Nodes unreachable from any goal end up in a trailing "orphan" column.

**Cycle invariant:** The `visiting` set prevents re-entering any node currently on the DFS stack. Without it, a cycle `A→B→A` causes depth to grow by 2 each pass and never terminates.

### renderNode dispatch (lines 237–260)

```
renderNode(nodeId):
  sn = result.nodes.find(n => n.recipeNodeId === nodeId)
  childSubPlan     = subPlan.subPlans.find(sp => sp.id === nodeId)
  childSubPlanNode = subPlan.nodes.find(n => n.kind==='subplan' && n.subPlanId===nodeId)

  if childSubPlan && childSubPlanNode → SubPlanSolvedCard
  else                                → RecipeCard
```

Note: `recipeNodeId` in `SolvedNode` equals the plan node's `id` for game-recipe nodes, but equals the `subPlanId` for synthetic (subplan) nodes — that's how `renderNode` matches them.
