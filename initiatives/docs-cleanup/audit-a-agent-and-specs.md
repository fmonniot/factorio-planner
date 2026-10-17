# Audit A — agent-facing docs, README, and specs

Read-only audit for step 1 of [plan.md](plan.md). Scope: `AGENTS.md` (= `CLAUDE.md`
symlink), `README.md`, `spec/overview.md`, `spec/tech-stack.md`, `spec/ui.md`,
`spec/data-model.md`, `spec/lua-export.md`. Every finding was checked against the
code on branch `docs/cleanup` (2026-10-17).

Format: `- [tag] file:line — what's wrong — evidence — proposed fix`.

---

## AGENTS.md

### Factual errors

- [outdated] AGENTS.md:15 — "Zod 3", "Vitest 3" — package.json has `zod ^4.6.7`, `vitest ^5.0.4`, `typescript ~6.0.3` (TS version not mentioned) — drop version list from CLAUDE.md entirely (point to package.json / tech-stack.md), per D3.
- [outdated] AGENTS.md:28 — `npm test # run all tests once` — package.json `"test": "npm run test:unit && npm run test:e2e"` (starts the dev server via playwright.config.ts `webServer`, needs `npx playwright install chromium`) — list `npm run test:unit` (vitest) and `npm run test:e2e` (Playwright) separately; say `npm test` runs both.
- [outdated] AGENTS.md:27-33 — command list omits `test:unit`, `test:e2e`, `preview`, and that `build` triggers `postbuild` → `node scripts/build-icons.mjs` (PNG→WebP + PNG optimisation in `dist/data`) — package.json scripts — add those.
- [wrong] AGENTS.md:43 — scripts list names `verify-game-data.js` — file does not exist; `scripts/` holds `build-game-data.js`, `build-icons.mjs`, `icon-compositor.js`, `trace-recipe-chain.js`, `__tests__/` (golden-image tests, run by vitest project `scripts`) — fix list.
- [outdated] AGENTS.md:44 — only `public/data/nullius/` listed — `public/data/kompetenz-seablock/` (game-data.json + icons) is also committed and offered in the selector (`src/components/GameDataSelector.tsx:9-12`) — use `public/data/<dataset>/`.
- [wrong] AGENTS.md:47 — solver = "Stoichiometry, reduction, LU + pseudo-inverse, effects, entry point" — no reduction/LU/pseudo-inverse exists; files are `build.ts` (net stoichiometry + classification), `solve.ts` (LP via javascript-lp-solver), `effects.ts` (modules/beacons + machine metrics), `index.ts` (`solve`, `flattenBlock`), plus `__fixtures__/` — fix.
- [outdated] AGENTS.md:45-50 — layout omits `src/utils/` (`iconUrl.ts`), `src/test-setup.ts`, `src/index.css`, `src/solver/__fixtures__/` (4 JSON files, referenced by no test — `grep -rn __fixtures__ src e2e scripts` finds nothing), `e2e/fixtures/`, `e2e/support/`, `.claude/`, `.github/workflows/` — add the ones worth pointing at (or drop the layout block and point to README's repository map).
- [wrong] AGENTS.md:53 — "read the file headers in `src/`" — many files have no header: `FactoryShell.tsx`, `TopBar.tsx`, `MachinePopover.tsx`, `Icon.tsx`, `Modal.tsx`, `index.ts`… — drop the claim or soften to "module comments where present".
- [wrong] AGENTS.md:67 — quotes `mainProduct: z.string().nullable().optional().transform(v => v === '' ? null : v)` and attributes `""` to "the Lua exporter" — actual is `z.preprocess(v => (v === '' ? null : v), z.string().nullable().optional())` (`src/data/schema.ts:70-73`); the `""` now comes from `scripts/build-game-data.js:446` (`resolveMainProduct`) — if kept, fix quote and attribution; better: move to data-model.md (it is data-model content).
- [wrong] AGENTS.md:84-86 — diagnostic passes list "too-many-alternatives" — no such warning; `SolverWarning` (`src/data/types.ts:49-53`) is `no-recipe | duplicate-recipe | infeasible-pins | overconstrained`. Pipeline also omits the duplicate-recipe detection (`index.ts:40-50`), no-recipe check (`index.ts:73-81`) and `byproductPolicy: 'discard'` zeroing (`index.ts:83-93`) — remove (solver.md owns this; note solver.md:68 has the same phantom warning, flagged for the solver audit).
- [wrong] AGENTS.md:115 — "All 6 cases are covered in `src/solver/index.test.ts` and the individual module tests" — `index.test.ts` has 6 tests (simple plan, pin, no-recipe ×2, flattenBlock ×2), none of them corpus cases; `solve.test.ts` uses synthetic chains; no solver test exercises multi-output (case 3), Kovarex cycle (case 4), probability (case 5) or `ignoredByProductivity` (case 6) — `grep -rniE "kovarex|uranium|probability|ignoredByProductivity" src/solver/*.test.ts` is empty. Only `loader.integration.test.ts:39-95` checks corpus recipes exist in the export — state the truth ("corpus cases are ground truth; solver tests currently cover chains, pins, bc, slack, shortfall; cases 3–6 are not yet encoded as solver tests") and file a backlog item.
- [wrong] AGENTS.md:113 — "Tests live beside the source files as `*.test.ts`" — component tests are `*.test.tsx`; `scripts/__tests__/` is not beside source; vitest has 3 projects `dom` / `node` / `scripts` (`vitest.config.ts`) — fix, and mention the projects (pointer-worthy quirk).
- [outdated] AGENTS.md:119 — fixture hygiene "must return `structuredClone(...)`" — only `src/data/loader.test.ts:82,96` does; solver/store factories return fresh literals (fine), but component tests share module-level objects (`FactorySummary.test.tsx:22`, `ProductionTable.test.tsx:46`, `RecipeRow.test.tsx:112`, `WarningsPopover.test.tsx:26`, `ModulePopover.test.tsx:60`) — reword as "factories must return a fresh object (literal or `structuredClone`)"; keep as quirk.
- [wrong] AGENTS.md:65 — "Do not cast with `as GameData`" — five component tests do `as unknown as GameData` (files above) — either scope the rule to non-test code or note the test exception.
- [wrong] AGENTS.md:143-146 — step 3 runs `scripts/verify-game-data.js` — file does not exist — delete step.
- [outdated] AGENTS.md:149 — "Legacy Lua mod … `scripts/factorio-planner-export_1.0.0/`" — directory gone; D1 — delete.
- [outdated] AGENTS.md:169-173 — "Phases 6–7 are pending" — shipped: 6.1 Export plan (`ExportPlanButton`, `GameDataSelector.tsx:170`), 6.4 Import game data (Upload file → IndexedDB, `GameDataSelector.tsx:111-120`), 7.1 icon pipeline (`build-game-data.js` icons + `build-icons.mjs`), 7.2 warnings in UI (`WarningsPopover.tsx`); 6.5 partial (only a /sec·/min toggle). Not shipped: 6.2 import plan, 6.3 URL sharing (no `searchParams`/`parseAppState` call in UI), 7.3, 7.4 — delete section (status belongs in the backlog, step 5).
- [outdated] AGENTS.md:206, 212-213 — "this file (`AGENTS.md`)" — D3 removes AGENTS.md — rename to CLAUDE.md; the "Repository layout table in this file" rows go away if the layout block is cut.
- [outdated] AGENTS.md:157-165 — spec table misses `spec/overview.md`, `spec/ui.md`, `spec/solver-chains/` (and `lua-export.md`, to be deleted) — regenerate from the final spec list (step 2).
- [outdated] AGENTS.md:9 — "targeting the **Nullius** overhaul mod" — Seablock is bundled too — say "Nullius-first; data-driven".

### Inbound references to AGENTS.md (fix in step 3)

- [outdated] spec/data-analysis.md:4 and spec/test-corpus.md:4 — "see AGENTS.md for how to regenerate" — point to README "Exporting game data" (or wherever the export recipe ends up).
- [outdated] TODO.md:34 — mentions `AGENTS.md` in the "Review project management" item — closed by step 5 anyway.
- README.md:95 links `CLAUDE.md` — still valid after D3.

### Duplication vs pointer-worthy (input for D3)

| Lines | Section | Verdict |
|---|---|---|
| 7-9 | What this project is | duplicated (overview.md / README) → one-line + pointer |
| 13-17 | Tech stack sentence | duplicated (tech-stack.md, package.json) → pointer only |
| 19-21 | Quirks (vite/vitest split, Tailwind v4 `@import`) | **keep** (verified: `vitest.config.ts` separate, `src/index.css:1`) |
| 25-33 | Commands | **keep**, fixed as above |
| 37-53 | Repository layout | duplicated (README repository map, tech-stack.md project structure) → drop or keep a 5-line map; one canonical copy only |
| 57-65 | Type system rules (schema.ts is source of truth, `z.output`, import from `types.ts`, no casts) | **keep** as conventions (rules, not description) |
| 67 | mainProduct transform | duplicated / data-model content → move to data-model.md |
| 71-107 | Solver pipeline, classifications, sign convention, productivity, Kovarex, bc | duplicated (spec/solver.md covers all of it: lines 18-27, 31-56, 60-86) → pointer only |
| 111-121 | Tests | keep the quirks (corpus is ground truth, integration skip-if, fresh fixtures, Vitest `expect(v, msg)`), fixed as above |
| 125-149 | Game data export | duplicated (README:62-79, tech-stack.md:62-74) → pointer to README |
| 153-165 | Spec documents table | **keep** (pointers), regenerated |
| 169-173 | Not yet implemented | misplaced (status) → delete; backlog owns it |
| 177-194 | Documentation layout rules | **keep** (conventions) |
| 198-200 | Testing preference | **keep** |
| 204-217 | Spec maintenance table | **keep**, update for CLAUDE.md and the cut layout block |

---

## README.md

- [wrong] README.md:13 — "**Nullius** is the default" — nothing loads on a first visit: the selector shows a disabled "Select game data…" option (`GameDataSelector.tsx:72-74,138-140`) and the table says "Load game data to begin" (`ProductionTable.tsx:51`); a dataset loads only once chosen (then remembered in localStorage key `factorio-planner:game-data-source`) — say "Pick Nullius (listed first) or Seablock"; or change code to auto-load Nullius (separate decision).
- [wrong] README.md:23 — "Choose another recipe for an item when alternatives exist, using the recipe picker" — there is no per-row recipe swap; the picker (`ItemPicker` `source="recipes"`) only *adds* a recipe (from "+ Add recipe" or an ingredient click, filtered to producers of that item); replacing means adding the alternative and removing the old row — reword.
- [wrong] README.md:27 — "Click a product to make it the recipe's primary output, or toggle its policy" — clicking a *byproduct* tile sets it primary (`RecipeRow.tsx:412-423`); the discard/feed-back toggle branch (`RecipeRow.tsx:426-441`) is only reached for single-product recipes, which have no byproduct tiles, so it is effectively unreachable — drop "or toggle its policy" (and flag the dead branch / unreachable `discard` policy as a backlog item).
- [wrong] README.md:31 — "a warnings indicator in the footer" — `WarningsPopover` sits in the summary header row next to the /sec·/min toggle (`FactorySummary.tsx:222-223`), opening downward — say "in the summary header".
- [outdated] README.md:35 — "click a block's name to rename it" — clicking a tab activates it; rename is via the block name in the summary header (`FactorySummary.tsx:213-219`) or right-click tab → Rename; right-click also offers Delete (`BlockTabs.tsx` context menu) — reword, mention Delete.
- [outdated] README.md:17 — "use **Add goal**" — the control is a "+" button with tooltip "Add goal" in the Products pane (`FactorySummary.tsx:258-265`); picker then asks for a rate — minor wording ("the **+** in Products").
- [outdated] README.md:39 — status of import/URL sharing is correct today, but links the roadmap; after step 5 merge, point at the merged backlog.
- [outdated] README.md:47 — "Node.js 22 or newer" — consistent with CI (`.github/workflows/test.yml:16`, `deploy.yml:28`: `node-version: 22`), but there is no `.nvmrc` and no `engines` field in package.json — optional: add `"engines": {"node": ">=22"}` so the claim has a source of truth.
- [outdated] README.md:64 — "The Nullius export in `public/data/nullius/` is committed" — Seablock export in `public/data/kompetenz-seablock/` is committed too — mention both.
- [outdated] README.md:83-93 — repository map omits `src/utils/`, `public/data/` — add `public/data/` (it is user-relevant: bundled datasets).
- [outdated] README.md:99 — "Known gaps" list duplicates TODO.md items — fine as prose, but re-check after the backlog merge.

Verified OK: the "Try it" URL matches `vite.config.ts` base `/factorio-planner/` and the GitHub Pages deploy workflow; commands at :50-56 match package.json; `--dump/--factorio-dir/--mods-dir/--icons-out/--output` match `build-game-data.js:57-61` and defaults at :45-51; pin, bc toggle ("Only run to absorb byproduct…", `RecipeRow.tsx:262`), ingredient click, lock/no-import (`FactorySummary.tsx:281-302`), wrap in subfactory, drag-and-drop and move up/down, Export plan — all exist.

Side note (code, not docs): Seablock dataset id/URL has a stray slash — `id: 'kompetenz-seablock/'`, URL `data/kompetenz-seablock//game-data.json` (`GameDataSelector.tsx:11`).

---

## spec/overview.md

- [outdated] spec/overview.md:5 — "targeting the **Nullius** overhaul mod" — Seablock also bundled (`GameDataSelector.tsx:11`) — "Nullius-first, data-driven; Nullius and Seablock bundled".
- [wrong] spec/overview.md:7 — "helmod's general approach … inspect the resulting tree" — there is no tree; the UI is a flat production table with collapsible sub-factory groups (`ProductionTable.tsx`, `RecipeRow.tsx`) — rewrite.
- [outdated] spec/overview.md:11 — "the only tested and supported dataset … is the Nullius export" — Seablock is offered in the UI (e2e still only uses Nullius: `e2e/game-data-source.spec.ts:4`) — state Nullius as primary/tested, Seablock as bundled best-effort.
- [wrong] spec/overview.md:15 — non-goal "any mod other than Nullius" — contradicted by the Seablock bundle — remove or reword.
- [wrong] spec/overview.md:24 — "plans are stored in localStorage and shareable via URL" — localStorage yes (`persistence.ts:9`, key `factorio-planner:app-state`); no URL sharing exists — drop "shareable via URL" (custom game data is stored in IndexedDB, `GameDataSelector.tsx:20-60`, worth stating).
- [outdated] spec/overview.md:25 — "The Nullius bundle is the default" — not auto-loaded (see README.md:13 finding) — fix.
- [misplaced] spec/overview.md:9-20 — "v1 target", "Non-Goals (v1)" — release-phase framing in a timeless spec — rephrase as current scope / non-goals.

---

## spec/tech-stack.md

- [outdated] spec/tech-stack.md:7 — "maps well to recipe cards" — no recipe cards; table rows — reword.
- [outdated] spec/tech-stack.md:21 — undo/redo "Implemented via a simple command stack" — true in the store (`blockStore.ts:5-15,161-189`), but no UI or shortcut calls `undo`/`redo` (`grep -rn "undo\|redo" src/components src/main.tsx` empty) — say "store-level only, not exposed in the UI" (and add backlog item).
- [outdated] spec/tech-stack.md:37,39 — "information-dense (helmod-style)", "Recipe cards and the item picker are custom components" — recipe cards gone — reword ("production table, popovers/modals and the item picker are custom").
- [outdated] spec/tech-stack.md:51-56 — testing table omits the `scripts` vitest project (icon compositor golden tests, `scripts/__tests__/`) and the dom/node project split — add.
- [wrong] spec/tech-stack.md:58 — "Solver tests cover all six corpus cases" — false (see AGENTS.md:115 finding) — fix.
- [outdated] spec/tech-stack.md:62-66 — pipeline omits `scripts/icon-compositor.js` (layered icon compositing with sharp) and the build-time `postbuild` → `scripts/build-icons.mjs` (WebP + optimised PNG in `dist/data`) plus the dev-server WebP middleware in `vite.config.ts:14-44`; `sharp` and `adm-zip` are dev deps for this — add.
- [wrong] spec/tech-stack.md:66 — "emits `public/data/nullius/game-data.json`" — that's only the default `--output`; mixes fixed and `<mod>` paths — use `public/data/<dataset>/`.
- [wrong] spec/tech-stack.md:68 — "Verify script (`scripts/verify-game-data.js`)" — file does not exist — delete.
- [outdated] spec/tech-stack.md:70 — "Legacy fallback: `scripts/factorio-planner-export_1.0.0/`" — gone; D1 — delete.
- [wrong] spec/tech-stack.md:74 — "No bundled data. The app starts empty — the user imports `game-data.json` via the top-bar selector" — two datasets are bundled and selectable (Nullius, Seablock); uploads are persisted in IndexedDB — rewrite.
- [wrong] spec/tech-stack.md:82 — "Primary: Cloudflare Pages or Vercel" — deployed to GitHub Pages on release (`.github/workflows/deploy.yml`, `vite.config.ts:10` base `/factorio-planner/`) — fix.
- [wrong] spec/tech-stack.md:83-84 — "exported/imported as JSON", "URL sharing via compressed query parameter" — only export exists; no import, no URL sharing — fix (planned work goes to the backlog).
- [outdated] spec/tech-stack.md:88-124 — project tree omits `src/utils/iconUrl.ts`, `src/components/GameDataSelector.tsx`, `Icon.tsx`, `src/test-setup.ts`, `src/index.css`, `src/solver/__fixtures__/`, `scripts/` contents; line 94 "export + verification tooling" (no verifier); line 118 "Generated icons sprite" — icons are individual PNGs (+ WebP at build), not a sprite; line 118 repeats `public/data/` already on line 95 — fix, or drop this tree in favour of one canonical map (README or CLAUDE.md) to stop triplication.
- [outdated] spec/tech-stack.md:31 — "No WASM for v1" — phase framing; fine to keep as rationale, drop "v1".
- [duplicated] spec/tech-stack.md:88-124 vs AGENTS.md:37-51 vs README.md:81-93 — three repository maps — keep one.

Verified OK: React/Zustand/Vite/Tailwind/javascript-lp-solver choices; LP description at :29 matches `solve.ts`; schema validation via `GameDataLoadError` (`src/data/loader.ts`).

---

## spec/ui.md

The whole file describes the abandoned helmod-style layout. Rewrite from scratch
(step 4) using the sketch at the end of this file. Specific wrong claims, for the record:

- [wrong] spec/ui.md:3 — "structured around recipe nodes… helmod" — table-based — rewrite.
- [wrong] spec/ui.md:9-26 — header with plan name / New / Open / Import / Export / Settings; goals sidebar; production tree; bottom summary bar — none exist; actual: top bar (block tabs + Export plan + game-data selector), summary strip (Products/Byproducts/Ingredients), production table — rewrite.
- [wrong] spec/ui.md:36-44 — tree canvas, Tree/Table toggle, summary bar with total machines/MW and click-to-scroll — no tree, no toggle, no totals (power is per row only, `RecipeRow.tsx:465-470`) — remove.
- [wrong] spec/ui.md:48-84 — Recipe Card with alt-recipe dropdown, per-card machine dropdown, inputs "from <recipe>", card states (highlighted, warning border, rate-changed animation) — none exist — remove.
- [wrong] spec/ui.md:92-95 — item picker "fuzzy search", "Keyboard-navigable; Enter selects" — search is case-insensitive substring on name/id (`ItemPicker.tsx` "Fuzzy matching — case-insensitive substring"); picker is organised in item-group tabs and subgroup rows, with a show-hidden toggle for recipes; no evidence of arrow-key navigation — describe actual behaviour.
- [wrong] spec/ui.md:99-107 — sortable Table View — table is not sortable; order is user-defined (drag-and-drop, move up/down) — rewrite.
- [wrong] spec/ui.md:111-119 — Settings panel — does not exist; only a /sec·/min toggle (`uiStore.ts:13` `RateUnit = 'sec' | 'min'`, no items/tick) — remove; planned items go to the backlog.
- [wrong] spec/ui.md:125-128 — Import plan, Share URL — not implemented; Export plan downloads `{blocks, activeBlockId}` as `factorio-plan-YYYY-MM-DD.json` (`GameDataSelector.tsx:170-180`) — fix.
- [wrong] spec/ui.md:132-139 — responsive behaviour — not implemented — remove (backlog if wanted).

---

## spec/data-model.md

Compared field by field against `src/data/schema.ts` and `src/data/types.ts`.

- [wrong] spec/data-model.md:3-5 — "All types are defined in TypeScript … produced by the Lua export script" — types are derived from Zod schemas (`z.output<…>`); the bundle is produced by `scripts/build-game-data.js` from `factorio --dump-data` — fix; say schema.ts is authoritative and this doc mirrors it.
- [outdated] spec/data-model.md:14-20 (Item) — missing `hidden: boolean` (default false), `subgroup: string` (default ''), `order: string` (default '') — schema.ts:29-38 — add.
- [wrong] spec/data-model.md:18 — `iconPath` "relative path to the icon PNG within the export directory" — exporter writes an absolute filesystem path (e.g. `//Users/…/public/data/nullius/icons/item-unknown.png` in the committed JSON); `src/utils/iconUrl.ts` strips everything up to `/public/` — document actual behaviour (and consider a backlog item: committed data embeds the author's home path).
- [outdated] spec/data-model.md:26-38 (Recipe) — missing `hidden`, `subgroup`, `order` (schema.ts:67,74-75); `ingredients`/`products`/`madeIn` accept `{}` as empty array (`luaArray` preprocess, schema.ts:12-23) — add.
- [wrong] spec/data-model.md:36-37 — `mainProduct?: string`, "absent = single-product recipe; null = explicitly multi-output" — type is `string | null | undefined`; `build-game-data.js:444-451` sets single-product recipes to their product id, `""` (→ null) for explicit multi-output, and omits the field for multi-output with no declared primary — fix semantics; mention per-node `primaryProduct` override.
- [wrong] spec/data-model.md:55-56 — amountMin/Max "average = (min+max)/2" — exporter sets `amount = prod.amount ?? prod.amount_max ?? 0` (`build-game-data.js:413`); solver only reads `amount` (`build.ts:70-75`), amountMin/Max are informational — fix.
- [outdated] spec/data-model.md:52 — Product `amount` is nonnegative (0 allowed), Ingredient `amount` positive — schema.ts:43,51 — note the constraint.
- [outdated] spec/data-model.md:67-79 (Machine) — missing `hidden`; `craftingSpeed` defaults to 1 when absent (schema.ts:105) — add.
- [outdated] spec/data-model.md:87-96 (Module) — missing `iconPath` (default '') (schema.ts:124); `tier` is int ≥ 0; `limitation`/`limitationBlacklist` are always emitted as `[]` by the exporter (`build-game-data.js:675-676`) — add / note.
- [outdated] spec/data-model.md:101-116 (GameData) — missing `beacons: Record<string, BeaconEntity>` (default {}), `itemGroups: Record<string, ItemGroup>` (default {}), `itemSubgroups: Record<string, ItemSubgroup>` (default {}) — schema.ts:144-147 — add.
- [outdated] spec/data-model.md (no section) — types `BeaconEntity` {id, name, iconPath, hidden, moduleSlots, distributionEfficiency, allowedEffects} (schema.ts:127-135), `ItemGroup` {id, name, order, iconPath} (:78-83), `ItemSubgroup` {id, group, order} (:85-89) are undocumented — add.
- [outdated] spec/data-model.md:113-115 — defaultMachines "highest tier" — exporter picks the machine with the highest `craftingSpeed` per category (`build-game-data.js:717-731`) — fix wording.
- [wrong] spec/data-model.md:123 — "serialized to JSON for export and URL sharing" — no URL sharing; export serialises `AppState` — fix.
- [wrong] spec/data-model.md:137 — RecipeNode "One node in the solved production tree … populated/updated on solve" (also :176) — nodes are user-authored (added via the recipe picker); the solver never creates them — fix.
- [wrong] spec/data-model.md:140-153 — `RecipeNode` is now a discriminated union on `kind`: `GameRecipeNode` (`kind: 'game-recipe'`) | `SubPlanNode` (`kind: 'subplan'`, `id`, `subPlanId`); legacy nodes without `kind` get `'game-recipe'` injected (schema.ts:173-203) — rewrite.
- [outdated] spec/data-model.md:140-153 — GameRecipeNode missing `kind`, `primaryProduct?: string`, `byproductConsumer?: boolean`; `pinnedRate` is positive with `0 → undefined` coercion (schema.ts:180-185) — add.
- [outdated] spec/data-model.md:160-165 — BeaconConfig missing `beaconId?: string` (schema.ts:166); `beaconCount` int ≥ 0, `modulesPerBeacon` int > 0 — add.
- [wrong] spec/data-model.md:168-180 — `Plan` {id, name, gameDataVersion, goals, nodes, createdAt, updatedAt} does not exist. Actual hierarchy: `AppState` {blocks: Block[], activeBlockId} (schema.ts:321-324) → `Block` {id, name, gameDataVersion, goals (default []), noImportItems: string[] (default []), rootPlan: SubPlan} (:308-319, with `migrateBlock` hoisting legacy per-subplan goals/noImportItems, :249-306) → `SubPlan` {id, name, nodes: RecipeNode[], subPlans: SubPlan[], createdAt, updatedAt (ISO datetime)} (:211-229). SubPlans are UI grouping only; the solver flattens them (`flattenBlock`, `src/solver/index.ts:17-29`) — rewrite section.
- [outdated] spec/data-model.md:174 — `gameDataVersion` "factorioVersion from the loaded GameData" — never set; new blocks get `''` (`blockStore.ts:111`) and nothing writes it — document as unused/reserved or drop.
- [outdated] spec/data-model.md:191 — `unsatisfied` "items with no producing recipe (raw resources)" — also contains goal shortfalls and intermediate slack, in that order (`index.ts:193-234`) — fix comment.
- [wrong] spec/data-model.md:210-214 — `SolverWarning` variants `cycle-detected`, `underdetermined`, `productivity-not-allowed` do not exist; actual: `no-recipe {itemId}`, `duplicate-recipe {recipeId, count}`, `infeasible-pins {recipeIds}`, `overconstrained {surplusItems: {itemId, rate}[]}` (types.ts:49-53) — fix.
- [misplaced] spec/data-model.md:219 — "Known Omissions (v1)" — phase framing; content is right (`parameter` recipes filtered at `build-game-data.js:604`) — drop "(v1)".

Verified OK: Ingredient fields; Product probability/ignoredByProductivity; Machine type/energy/drain/moduleSlots/allowedEffects/craftingCategories; EffectName enum; ProductionGoal; ModuleConfig; SolvedNode; UnsatisfiedItem fields; SolverResult.

---

## spec/lua-export.md (D1)

- [outdated] spec/lua-export.md:1-114 — describes the removed in-game Lua exporter; the replacement header comment in `scripts/build-game-data.js:6` says "Replaces the runtime Lua mod" — delete file. No Markdown file links to `lua-export.md` (only plan.md mentions it), so deletion leaves no broken links.

Other references to the Lua exporter (outside `initiatives/archive/` and this initiative):

- Docs: AGENTS.md:67, AGENTS.md:149; spec/tech-stack.md:70; spec/data-model.md:4; spec/data-analysis.md:14 ("export script uses runtime API") and :122 (section "Implications for the Lua Export Script" — whole section is about the old exporter); initiatives/roadmap.md:14 (Phase 0 "Lua export" — historical, fine) and :81 ("In-app Lua script runner" deferred idea — drop or keep as idea).
- Code comments (optional cleanup, not docs): `src/data/schema.ts:8-12` (`luaArray` — keep the helper unless the dump is verified never to emit `{}`, but reword), `:68-69`, `:103`; `src/data/loader.test.ts:205-206`; `scripts/build-game-data.js:6,354,448`; `scripts/trace-recipe-chain.js:57`.

---

## UI as it is today

Source: `src/components/`, `src/components/factory/`. Entry `src/main.tsx` restores
localStorage state, wires persistence + debounced auto-solve (`wireSolver`), mounts
`FactoryShell`.

```
┌ TopBar ─────────────────────────────────────────────────────────────────┐
│ [Block A][Block B][+]                     [Export plan] [Game data ▾]   │
├ FactorySummary ─────────────────────────────────────────────────────────┤
│ Block name (click to rename)              [⚠ warnings ▾]  /sec · /min   │
│ ┌ Products ─────────┐ ┌ Byproducts ───────┐ ┌ Ingredients ────────────┐ │
│ │ goal tiles: target│ │ net-positive non- │ │ raw/imported items;     │ │
│ │ (click to edit) / │ │ goal items        │ │ click → lock (no-import)│ │
│ │ actual, ×; [+]    │ │                   │ │ locked chips → unlock   │ │
│ └───────────────────┘ └───────────────────┘ └─────────────────────────┘ │
├ ProductionTable ────────────────────────────────────────────────────────┤
│ ⋮ | Recipe | Machine (+modules) | Beacon | Products | Byproducts | Ingr. │
│ ▶ Sub-factory row (collapsible, drag, ×)                                │
│ ⋮ [bc][pin][wrap][×] icon | machine×N [mods] | beacon | … | … | … + ⚡kW │
│ + Add recipe                                                            │
└─────────────────────────────────────────────────────────────────────────┘
```

- **TopBar** (`TopBar.tsx`): `BlockTabs` (click = activate; right-click menu Rename / Delete; "+" adds a block) on the left; `ExportPlanButton` and `GameDataSelector` (Nullius / Seablock bundled datasets, "Upload file…" for a custom JSON stored in IndexedDB; choice remembered in localStorage) on the right. No dataset is loaded until one is chosen.
- **FactorySummary** (`FactorySummary.tsx`): header row with editable block name, `WarningsPopover` (rendered only when warnings exist: "⚠ N warnings", yellow, red if any `infeasible-pins`; dropdown lists `no-recipe` / `duplicate-recipe` / `infeasible-pins` / `overconstrained` with title, body, hint, and a one-click fix that removes duplicate recipe nodes; closes on Escape / outside click), and rate-unit toggle (/sec, /min — `uiStore`). Three panes: **Products** (one `GoalTile` per block goal — target rate editable inline, actual rate from net solver balance, remove; "+" opens `ItemPicker` in items mode with a rate input), **Byproducts** (net-positive non-goal items), **Ingredients** (`unsatisfied` items: goal shortfalls, intermediate slack, raw consumption; clicking toggles the block's `noImportItems`, locked items shown as chips).
- **ProductionTable** (`ProductionTable.tsx`): empty states "Load game data to begin" / "No recipes yet + Add recipe"; otherwise a sticky-header table wrapped in `RecipeDndProvider` (`RecipeDnd.tsx`) rendering the active block's `rootPlan` recursively — sub-plan rows are collapsible groups with drop targets (empty group target, trailing drop zone, cycle guard). Footer "+ Add recipe" opens `ItemPicker` in recipes mode.
- **RecipeRow** (`RecipeRow.tsx`): drag handle + move up/down; action buttons — byproduct-consumer toggle ("Only run to absorb byproduct from other recipes"), pin/unpin (pinned rate becomes an editable input in the Products cell; hidden for bc rows), "Wrap in subfactory", remove; recipe icon from the primary product. **Machine** cell: `MachineCell` (machine icon × ceil count) + `ModuleCell` (slot badges), both opening `EditMachineModal` (machine choice, modules constrained by machine slots/allowed effects and recipe productivity, effects panel). **Beacon** cell: `BeaconCell` → `BeaconModal` (beacon entity, module, count, effects). **Products** = primary output; **Byproducts** = other outputs, click to set primary (`primaryProduct`); **Ingredients** = inputs, click opens recipe picker filtered to producers of that item (added in the same sub-plan), plus a power tile (kW) when > 0.
- **ItemPicker** (`ItemPicker.tsx`, modal via `Modal.tsx`): two modes. Items mode: search (substring on name/id), item-group tabs, subgroup rows, rate input. Recipes mode: search, "show hidden" toggle, item-group tabs (hidden if ≤ 1 group), subgroup rows, recipe detail panel on hover/focus, optional `filterByItemId` subtitle "Choose a recipe to produce '…'".
- **Shared bits**: `ItemTile.tsx` (tile variants + `fmtRate`/`fmtPower`), `Popover.tsx`, `Icon.tsx` + `src/utils/iconUrl.ts` (PNG/WebP `<picture>` with BASE_URL).
- **Not present** (despite older docs): goals sidebar, tree view, Tree/Table toggle, sorting, totals bar (machines / MW), settings panel, plan import, URL sharing, undo/redo UI, responsive layout, rate-changed animation, per-row recipe swap.
- **Dead code observed**: `MachinePopover` and `ModulePopover` components are exported but never rendered (only `MachineCell`, `ModuleCell` and the helper predicates are imported); the byproduct-policy toggle branch in `RecipeRow.tsx:426-441` is unreachable.
