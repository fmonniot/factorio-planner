# CLAUDE.md — Factorio Planner

Conventions and quirks for agents working in this repository. This file holds
rules; how the system works lives in [spec/](spec/), how to use and build it
lives in [README.md](README.md).

---

## What this project is

A browser-based production planner for Factorio 2.0, built Nullius-first but data-driven (Nullius and Seablock data sets are bundled). Given desired output rates, it solves the production chain — recipes, intermediates, raw inputs, machine counts, power — with a linear program. No backend; everything runs client-side.

→ [spec/overview.md](spec/overview.md) for the product overview, [README.md](README.md#repository-map) for the repository map, [spec/tech-stack.md](spec/tech-stack.md) and `package.json` for libraries and versions.

**Quirks worth knowing:**
- `vite.config.ts` and `vitest.config.ts` are **separate files**. The `test` key causes a TypeScript error in `UserConfigExport`, so test config lives exclusively in `vitest.config.ts`.
- `vitest.config.ts` defines three projects: `dom` (`src/components/**/*.test.tsx`, happy-dom), `node` (`src/**/*.test.ts`) and `scripts` (`scripts/__tests__/`).
- Tailwind CSS v4 uses `@import "tailwindcss"` in CSS (`src/index.css`), not `@tailwind` directives.

---

## Commands

```sh
npm run dev        # start Vite dev server
npm run build      # type-check + bundle; postbuild runs scripts/build-icons.mjs (WebP + PNG optimisation in dist/)
npm run preview    # serve the production build
npm run lint       # ESLint
npm run lint:docs  # broken relative links / repo paths in Markdown
npm test           # unit + e2e (test:unit then test:e2e)
npm run test:unit  # Vitest, all projects, once
npm run test:watch # Vitest in watch mode
npm run test:e2e   # Playwright; starts the dev server itself
```

On a fresh checkout, run `npx playwright install chromium` before the e2e tests.

CI (`.github/workflows/test.yml`) runs lint, doc-link check, unit, e2e and build on every pull request.

To regenerate game data, follow [README.md — Exporting game data](README.md#exporting-game-data).

---

## Type system

**`src/data/schema.ts` is the single source of truth for all game data and plan types.**

- All types are derived with `z.output<typeof FooSchema>` — never hand-written.
- `src/data/types.ts` re-exports the game/plan types from `schema.ts` and adds the transient solver types (`SolvedNode`, `SolverResult`, …) that have no Zod schema.
- Downstream code imports from `src/data/types.ts`.
- Do **not** cast with `as GameData` / `as AppState` in application code — the Zod output type IS the TypeScript type.

---

## Tests

- Unit tests live beside the source as `*.test.ts` / `*.test.tsx`; build-script tests live in `scripts/__tests__/`; Playwright specs in `e2e/`.
- **Synthetic cases** in [spec/test-synthetic.md](spec/test-synthetic.md) are the ground truth for solver behaviour. They are automated in `src/solver/synthetic.test.ts`; update the spec and that test together when a synthetic-case value changes. They stay on synthetic fixtures; real-data solver invariants live in `src/solver/index.integration.test.ts`.
- **Fixture hygiene:** fixture factory functions must return a fresh object each call (a new literal or `structuredClone(...)`). Shared mutable fixtures cause hard-to-diagnose test ordering bugs.
- **Vitest API:** the message goes on `expect(value, 'message')`, not `expect(value).toBe(true, 'message')` — the latter is a TypeScript error.
- **Testing preference:** when a plan includes validation steps, prefer Playwright e2e tests (in `e2e/`) over manual browser checks. Fall back to manual testing only when the scenario cannot be automated.

---

## Spec documents

Read these before making decisions that affect core behaviour:

| File | Contents |
|---|---|
| [spec/overview.md](spec/overview.md) | What the planner is, scope, principles |
| [spec/tech-stack.md](spec/tech-stack.md) | Technology choices, rationale, CI and deploy |
| [spec/solver.md](spec/solver.md) | LP formulation, solver pipeline, warnings, machine metrics |
| [spec/data-model.md](spec/data-model.md) | Field-level game-data and plan-state model |
| [spec/test-synthetic.md](spec/test-synthetic.md) | 9 synthetic cases with full derivations — ground truth for the solver |
| [spec/ui.md](spec/ui.md) | The production-table UI as it is today |
| [initiatives/README.md](initiatives/README.md) | Index of active and archived initiatives |
| [initiatives/backlog.md](initiatives/backlog.md) | Planned and possible work, known bugs |

---

## Documentation layout

Two locations, two purposes. Follow these rules when adding or editing docs:

1. **`spec/` is timeless.** Files there describe how the system currently works. No phase markers, no ticket numbers, no `[ ]/[~]/[x]` checklists. If a fact changes, the file changes; old behaviour is not preserved.

2. **`initiatives/` is time-bound.** Anything with a status, a ticket list, or a "we plan to do X" framing belongs here. Small items go in [initiatives/backlog.md](initiatives/backlog.md); an item that grows a design doc becomes its own folder, linked from the backlog.

3. **Status badge on every active initiative.** The first non-heading line of an initiative's primary doc is one of:
   - `Status: Active` — work in progress
   - `Status: Future` — design exists, no implementation yet
   - `Status: Blocked — <reason>` — waiting on external work
   - `Status: Shipped` — optional once archived (the location already implies it)

4. **When an initiative ships, move the folder to `initiatives/archive/`.** Run `git mv initiatives/<name> initiatives/archive/<name>` and fix in-folder references to the old path so the link check stays green. Don't otherwise rewrite the documents; setting `Status: Shipped` is optional.

5. **Update `initiatives/README.md` whenever a folder is added, archived, or its status changes.** The README is the only initiative index; nothing else should claim that role.

6. **CLAUDE.md does not duplicate `spec/` or README.** It points to them for tech stack, data model, solver behaviour, repository layout and the export recipe — never restates them.

---

## Spec maintenance

After changing source files, update the relevant docs so that a new session can read this file + `spec/` and work without traversing the codebase.

| What changed | What to update |
|---|---|
| Solver algorithm (`src/solver/`) | [spec/solver.md](spec/solver.md); [spec/test-synthetic.md](spec/test-synthetic.md) if expected synthetic-case values changed |
| Data model (`src/data/schema.ts`, `types.ts`) | [spec/data-model.md](spec/data-model.md) |
| UI behaviour or layout (`src/components/`) | [spec/ui.md](spec/ui.md); README "Using the planner" if user-visible |
| File or directory added/removed/renamed | README [repository map](README.md#repository-map) |
| Technology or tooling change | [spec/tech-stack.md](spec/tech-stack.md); Commands section in this file |
| Backlog item done | Remove it from [initiatives/backlog.md](initiatives/backlog.md) (or update its `[~]` note) |
| Initiative shipped | `git mv initiatives/<name> initiatives/archive/<name>`, fix in-folder paths, update [initiatives/README.md](initiatives/README.md) |
| New synthetic case added | [spec/test-synthetic.md](spec/test-synthetic.md) |
