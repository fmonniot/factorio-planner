# Technology Stack

---

## Frontend Framework: React + TypeScript

**Why React:** The UI is a tree of interactive components. React's component model maps well to recipe cards, and its ecosystem (tooling, state libraries, testing) is mature. TypeScript is mandatory — the data model has enough shape complexity that type errors at compile time are essential.

**Why not Svelte/Vue/Solid:** No strong reason against them. React is chosen for ecosystem breadth and to avoid exotic constraints, not as a rejection of alternatives.

---

## State Management: Zustand

**Why Zustand:** The application state has two layers:
1. **Plan state** — goals, node overrides, machine selections. Needs undo/redo and JSON serialization.
2. **Solver result** — derived, transient, recomputed after every plan change.

Zustand's minimal API handles both without boilerplate. Redux Toolkit is viable but heavier than needed.

**Undo/redo:** Implemented via a simple command stack in the plan store. Each mutation is a reversible action. The solver result is not part of the undo stack — it is recomputed after undo/redo.

---

## Solver: Pure TypeScript, Client-Side

The solver runs entirely in the browser with no server round-trip. This keeps the app fully static and ensures it works offline.

**Linear algebra:** [`ml-matrix`](https://github.com/mljs/matrix) provides LU decomposition, matrix inversion, and least-squares. The matrices are small (typically < 200×200 for any realistic plan), so performance is not a concern.

**No WASM for v1.** The solver does not need WASM-level performance. If profiling later shows the solver is slow for very large modded plans, it can be moved to a Web Worker with a message-passing interface.

---

## Styling: Tailwind CSS

Tailwind's utility classes enable fast iteration without maintaining a parallel CSS file. The design is information-dense (helmod-style), and Tailwind's spacing/color system handles that well.

Component library: none for v1. Recipe cards and the item picker are custom components.

---

## Build Tooling: Vite

Fast dev server with HMR, native ESM, and simple configuration. No custom webpack config needed.

---

## Testing

| Layer | Tool | Scope |
|---|---|---|
| Solver unit tests | Vitest | Matrix construction, solve correctness, cycle handling, known recipe chains |
| Component tests | React Testing Library + Vitest | Item picker, recipe card interactions, goal CRUD |
| E2E (stretch) | Playwright | Full plan creation flows |

Solver tests are the most critical. They should cover:
- Simple linear chain (iron ore → iron plate → iron gear)
- Multi-output recipe (advanced oil processing)
- Cycle (Kovarex enrichment)
- Productivity module effect on upstream demand
- Pinned node (rate override propagation)

---

## Data Pipeline

Game data is not bundled in source. A Lua export script run inside Factorio (via the in-game console or a helper mod) produces the `GameData` JSON bundle. This approach supports any mod combination — the script reads the live `data.raw` tables that the game has already processed, including all mod additions and overrides.

**Export script** (`scripts/export-game-data.lua`): run in Factorio's script console or packaged as a mod. Outputs a JSON file the user then imports into the planner.

**Bundled data:** The Nullius export (`data/samples/nullius/data-raw-dump.json`) is the default dataset shipped with the app. It loads on startup with no user action required.

**Schema validation:** The JSON bundle is validated at load time against the `GameData` TypeScript interface (using Zod). Invalid bundles are rejected with a user-visible error.

**Versioning:** The bundle includes a `version` string and a `modSet` list. Plans record the version they were created with. On load, if the plan's version differs from the loaded bundle, a warning is shown but the plan is still opened (best-effort).

---

## Hosting

Static site. No backend, no database.

- Primary: Cloudflare Pages or Vercel (free tier sufficient)
- Plans stored in localStorage; large plans can be exported/imported as JSON
- URL sharing via compressed query parameter

---

## Project Structure

```
factorio-planner/
├── spec/                   # This directory
├── scripts/
│   └── export-game-data/   # Data pipeline tooling
├── src/
│   ├── data/
│   │   ├── schema.ts       # Zod schema for GameData
│   │   └── nullius/        # Bundled Nullius game data JSON (processed from samples/)
│   ├── solver/
│   │   ├── matrix.ts       # LU decomposition, linear algebra utilities
│   │   ├── build.ts        # Stoichiometry matrix construction
│   │   ├── solve.ts        # Main solver entry point
│   │   └── solver.test.ts
│   ├── store/
│   │   ├── planStore.ts    # Zustand plan state + undo/redo
│   │   └── gameDataStore.ts
│   ├── components/
│   │   ├── RecipeCard/
│   │   ├── GoalsPanel/
│   │   ├── ItemPicker/
│   │   ├── SummaryBar/
│   │   └── SettingsPanel/
│   ├── views/
│   │   ├── TreeView.tsx
│   │   └── TableView.tsx
│   └── App.tsx
├── public/
│   └── icons/              # Factorio item icon sprite sheets
├── index.html
├── vite.config.ts
└── tsconfig.json
```
