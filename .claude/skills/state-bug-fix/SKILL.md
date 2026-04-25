---
name: state-bug-fix
description: Use this skill to debug a bug that can be reproduced via an exported app state (fixture). Invoked as /state-bug-fix when the user provides a fixture JSON file or describes a state-reproducible issue in the factorio-planner project.
argument-hint: [fixture-path-or-bug-description]
allowed-tools: [Read, Bash, Glob, Grep]
---

# State-Based Bug Fix Workflow

The user has either:
- Provided a fixture JSON in `e2e/fixtures/` that reproduces a bug, OR
- Described a bug they want to capture as a fixture (export from the running app)

## Step 1 — Understand the fixture

Read the fixture JSON. Key fields to note:
- `blocks[0].rootPlan.goals` — what items are being produced and at what rate
- `blocks[0].rootPlan.nodes` — the recipe nodes (`kind: 'game-recipe'` or `kind: 'subplan'`)
- `blocks[0].rootPlan.subPlans` — child sub-plans (empty = flat plan)

See `references/project-architecture.md` for the full schema.

## Step 2 — Classify the bug domain

| Symptom | Domain | Where to look |
|---------|--------|---------------|
| Stack overflow / crash | Rendering | `src/components/TreeView.tsx` → `buildColumns` / `descend` |
| Wrong throughput numbers (astronomical or zero) | Solver math | `src/solver/index.ts`, `src/solver/build.ts`, `src/solver/reduce.ts` |
| Recipe cards render instead of subplan cards | Rendering | `src/components/TreeView.tsx` → `renderNode` |
| Solver error message shown in UI | Solver | `src/store/solverStore.ts` → `solveBottomUp` |
| Wrong machine counts / power | Effects | `src/solver/effects.ts` |

## Step 3 — Write the e2e regression test

Create `e2e/<slug>.spec.ts` using this template (copy-adjust, don't explore):

```typescript
import { test, expect } from '@playwright/test'
import path from 'path'
import { loadPlanFixture } from './support/loadPlan'

test('<describe what must NOT happen>', async ({ page }) => {
  await loadPlanFixture(page, path.resolve('e2e/fixtures/<fixture>.json'))

  // Wait for game data and solver
  await expect(page.locator('main').getByText('Load game data to begin')).not.toBeVisible({ timeout: 10000 })
  await expect(page.locator('main').getByText('Solving…')).not.toBeVisible({ timeout: 10000 })

  // --- assertions specific to this bug ---
})
```

For multiple related tests on one fixture, wrap in `test.describe()` with `test.beforeEach()`.
See `references/project-architecture.md` for assertion patterns.

## Step 4 — Reproduce, fix, verify

1. Run the e2e test to confirm it **fails** (reproduces the bug)
2. Read the relevant source file(s) identified in Step 2
3. Apply the fix
4. Run the test again — it should pass
5. Commit: fixture JSON + spec file + source fix in one commit

## Reference

Load `references/project-architecture.md` for:
- Full fixture JSON schema
- Solver pipeline call chain
- TreeView rendering logic and CSS selectors
- Key file paths across the codebase
