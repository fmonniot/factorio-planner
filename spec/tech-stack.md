# Technology Stack

Exact versions live in [package.json](../package.json) and are kept current by Dependabot; this file records the choices and why, not version numbers.

---

## Frontend Framework: React + TypeScript

**Why React:** The UI is a tree of interactive components (production table rows, popovers, modals). React's component model maps well to that, and its ecosystem (tooling, state libraries, testing) is mature. TypeScript is mandatory — the data model has enough shape complexity that type errors at compile time are essential.

**Why not Svelte/Vue/Solid:** No strong reason against them. React is chosen for ecosystem breadth and to avoid exotic constraints, not as a rejection of alternatives.

---

## State Management: Zustand

**Why Zustand:** The application state has two layers:
1. **Plan state** — blocks, goals, recipe nodes, machine selections. Needs JSON serialization.
2. **Solver result** — derived, transient, recomputed after every plan change.

Zustand's minimal API handles both without boilerplate. Redux Toolkit is viable but heavier than needed.

**Undo/redo:** The block store keeps a simple history stack with `undo` / `redo` actions. It is store-level only: no UI control or keyboard shortcut calls it. The solver result is not part of the history — it is recomputed after any change.

---

## Schema validation: Zod

Game data and persisted plan state are parsed at load time and on plan import against the Zod schemas in `src/data/schema.ts`; TypeScript types are derived from them. Invalid game data surfaces a structured `GameDataLoadError`.

---

## Solver: Pure TypeScript, Client-Side

The solver runs entirely in the browser with no server round-trip. This keeps the app fully static and ensures it works offline.

**LP engine:** [`javascript-lp-solver`](https://www.npmjs.com/package/javascript-lp-solver) — a pure-JS simplex implementation. The solver builds an elastic LP per block: hard constraints on goals, slack-extended constraints on intermediates, equality constraints for pinned recipes. Problems are small (< 200 variables for any realistic plan), so performance is not a concern. See [solver.md](solver.md) for the formulation.

**No WASM.** If profiling later shows the solver is slow for very large modded plans, it can be moved to a Web Worker with a message-passing interface.

---

## Styling: Tailwind CSS

Tailwind's utility classes enable fast iteration without maintaining a parallel CSS file. The design is information-dense, and Tailwind's spacing/color system handles that well.

Component library: none. The production table, popovers, modals and the item picker are custom components. So is the technology tree: hand-written pan/zoom (`src/utils/viewTransform.ts`) and column layout (`src/data/techTree.ts`), with no graph-layout library. The block graph is the same: a layered layout (`src/utils/blockGraphLayout.ts`), SVG edges and native scrolling.

---

## Build Tooling: Vite

Fast dev server with HMR, native ESM, and simple configuration. `vite.config.ts` sets `base: '/factorio-planner/'` for production builds (the GitHub Pages path) and adds a dev-server middleware that converts icon PNGs to WebP on request, mirroring the production build.

`npm run build` type-checks (`tsc -b`), bundles with Vite, then runs `postbuild` → `scripts/build-icons.mjs`, which writes WebP siblings and optimised PNGs for the icons under `dist/data` (using `sharp`).

---

## Testing

Vitest runs three projects (see `vitest.config.ts`): `dom` (component tests under `src/components/`, happy-dom + jest-dom), `node` (store, solver and data tests under `src/`), and `scripts` (golden-image tests for the icon compositor under `scripts/__tests__/`).

| Layer | Tool | Scope |
|---|---|---|
| Solver unit tests | Vitest (`node`) | LP construction, slack and surplus reporting, pins, byproduct consumers, effects and machine metrics |
| Store / data tests | Vitest (`node`) | Store actions, persistence and migration, schema parsing |
| Integration | Vitest (`node`) | Loading the committed Nullius `game-data.json` against the schema |
| Component tests | React Testing Library + Vitest (`dom`) | Item picker, recipe row interactions, modal flows, goal CRUD |
| Build scripts | Vitest (`scripts`) | Icon layer compositing against golden images |
| E2E | Playwright | Full plan creation flows against the dev server (Nullius data) |

The corpus cases in [test-corpus.md](test-corpus.md) are the reference values for the solver; they are automated in `src/solver/corpus.test.ts`.

---

## Data Pipeline

Game data is bundled with the app under `public/data/<dataset>/` (Nullius and Seablock are committed). The pipeline runs `factorio --dump-data` (no GUI needed) to emit `data-raw-dump.json`, then a Node script post-processes it into the `GameData` shape the app expects. The command-line recipe is in the README ("Exporting game data").

**Build script** (`scripts/build-game-data.js`): reads the raw dump, walks the Factorio and mods directories for icons, resolves names (`scripts/locale.js`: the game's `<type>-locale.json` files from `--dump-prototype-locale` first, then the merged mod locale map with placeholder expansion), classifies machines, exports beacons, and writes `game-data.json` plus icons to the paths given by `--output` and `--icons-out` (defaulting to `public/data/nullius/`). Technology icons go to `icons/technology/` (capped at 128 px) so they cannot collide with item icons of the same id. Layered icons are composited by `scripts/icon-compositor.js` with `sharp`; `adm-zip` reads zipped mods. `scripts/place-results.js` sets `Item.placeResult` (prototype `place_result`) on the items that place an exported machine or beacon; the research horizon uses it to gate machines and beacons.

**Bundled and uploaded data.** Nothing is loaded on a first visit: the top-bar workspace menu offers the bundled datasets and an "Upload file…" item. An uploaded file is stored in IndexedDB; the selected source is remembered in localStorage. Each data set keeps its own list of plans in localStorage (an index key plus one key per plan); the active plan on screen is swapped when a different data set loads.

---

## Hosting

Static site. No backend, no database. Deployed to GitHub Pages at `/factorio-planner/`. Plans are stored in localStorage (several per game data set) and can be exported, and imported as new plans, as JSON.

---

## CI and deployment

GitHub Actions, Node 22 (`.github/workflows/`):

- **`test.yml`** runs on every pull request, on `v*` tag pushes, and as a reusable workflow: `npm ci` → `npm run lint` → `npm run lint:docs` → `npm run test:unit` → Playwright chromium install → `npm run test:e2e` → `npm run build`. It does not run on pushes to `main`.
- **`deploy.yml`** runs when a GitHub release is published (or by manual dispatch): it calls `test.yml`, then builds and deploys `dist/` to GitHub Pages.
- **Dependabot** (`.github/dependabot.yml`) opens weekly npm update PRs, grouping React and Vitest packages.
