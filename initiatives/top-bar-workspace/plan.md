# Top bar: workspace menu and icon tools

Status: Future

Redesign of the top bar ([spec/ui.md — TopBar](../../spec/ui.md#topbar)). Block tabs stay on the
left. The right side becomes three icon-only tool buttons (Horizon, Block graph, Tech tree), a
divider, and one **workspace button** that merges today's plan menu (`PlanMenu`, left end) and the
**Menu ▾** (`AppMenu`, right end). The Horizon button gets a targets popover.

Design canvas (interactive, private to the owner): https://claude.ai/artifact/BcwDeJWqFAtdCWrDffuyZw.
Everything needed to build it is restated below; the canvas is not required.

```
Before
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│ [Plan: Main base ▾] [▣ Plates][▣ Gears] +   [Block graph] [Horizon: none] [Tech tree] [Menu ▾] │
└──────────────────────────────────────────────────────────────────────────────────────────┘
After
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│ [▣ Plates][▣ Gears][▣ Circuits] +                   ⚑•  ⊞  ⚗  │ [≡ Main base   ▾]      │
│                                                                │    Nullius              │
└──────────────────────────────────────────────────────────────────────────────────────────┘
  ⚑ Horizon (• = blue dot when targets are set)  ⊞ Block graph  ⚗ Tech tree
```

---

## Decisions already made

- **One menu.** The workspace button replaces both `PlanMenu`'s trigger and `AppMenu`'s **Menu**
  trigger. Its panel holds, in order: the plans of the active data set, a row of plan actions,
  the game data group, export and import. There is no separate Menu button any more.
- **Icon-only tools.** Horizon, Block graph and Tech tree become 32×32 borderless icon buttons
  with a styled tooltip on hover and keyboard focus. Their accessible names stay `Horizon: …`,
  `Block graph` and `Tech tree`, so most existing selectors keep working.
- **Horizon state is a dot, not text.** A blue dot on the flag means at least one valid target is
  set. The text the button shows today (`Horizon: none`, `Horizon: <technology>`,
  `Horizon: N technologies`) becomes its `aria-label` and its tooltip.
- **Horizon targets popover.** Clicking the flag opens a popover (not the modal). It lists the
  targets, each removable in place, plus **Clear** and **Edit horizon…** (which opens today's
  `HorizonModal`, unchanged). With no targets it says so and offers **Choose technologies…**.
- **Behaviour is unchanged** for the horizon rules, the block graph and tech tree modals, plan
  actions, data-set switching, export and import. This is a top-bar re-layout plus one popover.

## Out of scope

- Block counts next to each plan in the plan list (the canvas shows them). `PlanEntry` only has
  `id` and `name`; counts for inactive plans would need reading each stored plan. Leave a backlog
  item.
- Tab overflow (`+3 ▾`) and keyboard shortcuts, explored on the canvas but not chosen.
- Turning Block graph / Tech tree into views instead of modals.

---

## Visual spec

Tailwind classes are a starting point; match the current dark palette (gray-900 bar, gray-800
raised, gray-700/600 borders, blue-600 primary).

**Bar** (`TopBar.tsx`): one row, `h-11` (44px; was `h-10`) so the two-line workspace button fits.
Left: `<BlockTabs />` only. Right, `flex items-center gap-0.5 shrink-0`: `<HorizonButton />`,
`<BlockGraphButton />`, `<TechTreeButton />`, a divider (`w-px h-5 bg-gray-700 mx-1.5`, hidden when
no game data is loaded since the tools are hidden too), then `<WorkspaceMenu />`. Check the folder
tabs still sit on the bar's bottom border after the height change.

**Icon button**: `relative w-8 h-8 rounded-md flex items-center justify-center text-gray-400
hover:bg-gray-800 hover:text-gray-100 focus-visible:bg-gray-800 focus-visible:text-gray-100`,
17px stroke icon. Tooltip: a `span` positioned below the button, centred, `bg-black text-gray-100
text-xs border border-gray-700 rounded px-2 py-1 whitespace-nowrap pointer-events-none`, shown on
`group-hover` / `group-focus-visible`, hidden while the button's popover is open. The tooltip text
equals the `aria-label`, so mark the tooltip `aria-hidden`.

**Horizon dot**: `absolute top-1.5 right-1.5 w-[7px] h-[7px] rounded-full bg-blue-400 ring-2
ring-gray-900`, rendered only when there is at least one valid target. Give it
`data-testid="horizon-dot"`.

**Horizon popover** (anchored under the flag, right-aligned to it, `w-72 p-3`):
- Heading "Research horizon" (`text-sm font-semibold`).
- With targets: caption "Pickers only offer what these technologies and their prerequisites
  unlock." then one row per valid target: `TechIcon` (`w-5 h-5`), the name (truncated, full name
  as `title`), and a remove button (`aria-label="Remove <name>"`, ✕ icon). Rows: `bg-gray-950
  border border-gray-700 rounded-md px-2 py-1`.
- Without targets: caption "No targets: pickers offer every recipe, machine and module."
- Footer: link-style button **Edit horizon…** (or **Choose technologies…** when empty) on the left;
  **Clear** on the right when there are targets, with `aria-label="Clear horizon"` so it does not
  collide with the modal's **Clear** button.
- `role="dialog"`, `aria-label="Horizon targets"`. Opening moves focus to the first remove button
  (else the edit button); Escape and outside click close it and return focus to the flag.

**Workspace button** (the `MenuButton` trigger): `h-9 flex items-center gap-2.5 pl-1.5 pr-2
bg-gray-800 border border-gray-600 hover:border-gray-500 rounded-lg`. Content: a 24px square
(`bg-gray-700 rounded`) holding a layers icon; two lines (`leading-tight`): plan name
(`text-xs font-semibold text-gray-100 truncate max-w-40`) and a sub-line (`text-[11px]
text-gray-400`); a chevron-down icon (no `▾` glyph).

| State | Top line | Sub-line | `aria-label` |
|---|---|---|---|
| No data set chosen yet | Choose game data | — | `Choose game data` |
| Loading | active plan name, else "Choose game data" | Loading… | as the row above / below |
| Error | active plan name, else "Choose game data" | Error loading data (red-400, `title` = message) | as above |
| Loaded | active plan name | data-set label: Nullius, Seablock or the uploaded file name | `Plan: <name>` |

The button is never disabled (the game data group must stay reachable). This replaces the
"Loading…" / "Error loading data" label that `AppMenu` renders beside its button today.

**Workspace panel** (`w-72`, right-aligned, `aria-label="Plan and game data"`):
1. Section heading "Plans" (`text-[11px] uppercase tracking-wide text-gray-400 px-3 pt-2 pb-1`,
   `aria-hidden`), then the `role="group" aria-label="Plans"` radio items as today. Only when a plan
   index exists.
2. Plan actions as a 4-column grid (`grid grid-cols-4 gap-1 px-2 py-1`) of small tiles (icon above
   a short label, `bg-gray-900 border border-gray-700 rounded-md`): **New**, **Rename**,
   **Duplicate**, **Delete** (red-400). They are `role="menuitem"` with `aria-label`s
   `New plan`, `Rename plan`, `Duplicate plan`, `Delete plan`. Disabled unless game data is
   loaded. Same handlers as today's items (Rename and Delete open today's dialogs).
3. Separator, heading "Game data", today's game data group (unchanged items and behaviour).
4. Separator, **Export plan** (download icon) and **Import plan…** (upload icon), unchanged
   behaviour.

`MenuButton`'s arrow-key navigation is linear over `[role^="menuitem"]`, so the action tiles are
reached in DOM order; that is fine.

### Icons

Add `src/components/icons.tsx` with small components (`{ className?: string }`, `aria-hidden`,
`viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
stroke-linejoin="round"`, default `w-4 h-4`). Path data from the canvas:

| Component | Children |
|---|---|
| `FlagIcon` | `<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>` |
| `GraphIcon` | `<rect x="3" y="3" width="6" height="6" rx="1"/><rect x="15" y="3" width="6" height="6" rx="1"/><rect x="15" y="15" width="6" height="6" rx="1"/><path d="M9 6h6M18 9v6"/>` |
| `FlaskIcon` | `<path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.7 3h10.6a2 2 0 0 0 1.7-3l-5-9V3"/><path d="M7.5 14h9"/>` |
| `LayersIcon` | `<path d="M12 3 3 8l9 5 9-5-9-5z"/><path d="m3 13 9 5 9-5"/>` |
| `ChevronDownIcon` | `<path d="m6 9 6 6 6-6"/>` |
| `PlusIcon` | `<path d="M12 5v14M5 12h14"/>` |
| `PencilIcon` | `<path d="M4 20h4L19 9l-4-4L4 16v4z"/>` |
| `CopyIcon` | `<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>` |
| `TrashIcon` | `<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>` |
| `DownloadIcon` | `<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>` |
| `UploadIcon` | `<path d="M12 20V9M7 14l5-5 5 5M5 4h14"/>` |
| `XIcon` | `<path d="M6 6l12 12M18 6 6 18"/>` |

Do not add an icon library dependency.

---

## Implementation steps

Work on a branch. Run `npm run lint`, `npm run lint:docs` and `npm run test:unit` after each step,
`npm run test:e2e` after steps 4 and 5.

### 1. Shared pieces

- `src/components/icons.tsx` as above.
- `src/components/IconButton.tsx`: `IconButton({ label, onClick, children, expanded?, hasPopup?,
  hideTooltip? })` rendering the button, `aria-label={label}`, optional `aria-expanded` /
  `aria-haspopup`, the icon children and the CSS-only tooltip. Wrap in a `relative group` span so
  the dot and a popover can be positioned against it (accept extra children or a `badge` prop).
- `MenuButton.tsx`: add optional `triggerClassName` (replaces the default trigger classes) and
  `caret?: ReactNode` (default the current `▾` span; the workspace trigger passes
  `<ChevronDownIcon />`), plus `panelClassName` (appended, for `w-72`). Existing callers unchanged.

### 2. Block graph and Tech tree buttons

`BlockGraphButton` (`factory/BlockGraph.tsx`) and `TechTreeButton` (`TechTree.tsx`) render
`IconButton` with `GraphIcon` / `FlaskIcon` and labels `Block graph` / `Tech tree`. Visibility
rules (hidden without game data / technology data) and modals unchanged.

### 3. Horizon button and popover

In `HorizonPicker.tsx`:
- `HorizonButton` renders `IconButton` with `FlagIcon`, `label` = today's text
  (`Horizon: none` / `Horizon: <name>` / `Horizon: N technologies`), the dot when
  `valid.length > 0`, `aria-haspopup="dialog"`, `aria-expanded`.
- Click toggles a new `HorizonTargetsPopover` (same file). Reuse `factory/Popover.tsx` for outside
  click and Escape. Check whether Escape there also clears the summary-pane selection; if so,
  handle Escape in the capture phase with `preventDefault`, as `MenuButton` does.
- Remove calls `setHorizonTechnologyIds(targets.filter(id => id !== removed))` (the same store
  action the modal uses). **Clear** calls it with `[]`. **Edit horizon…** / **Choose
  technologies…** closes the popover and opens `HorizonModal` (unchanged).
- Only valid targets (present in `gameData.technologies`) are listed, as the label already does.

### 4. Workspace menu

- `git mv src/components/AppMenu.tsx src/components/WorkspaceMenu.tsx` and
  `git mv src/components/AppMenu.test.tsx src/components/WorkspaceMenu.test.tsx`. Rename the
  component to `WorkspaceMenu`. `useGameDataSource`, `usePlanImport`, `exportPlan` and the hidden
  upload input stay in this file and stay always mounted.
- `PlanMenu.tsx` stops rendering its own `MenuButton`. Replace the `PlanMenu` component with a hook
  `usePlanSection()` returning `{ active, renderItems(close), dialogs }`: `renderItems` renders the
  Plans heading, radio group and action tiles; `dialogs` is today's rename / delete / error
  modals. Keep `PlanNameDialog` and the action handlers as they are.
- `WorkspaceMenu` renders one `MenuButton` (`align="right"`, `menuLabel="Plan and game data"`,
  `title="Plans, game data, export and import"`) with the trigger content and states from the
  visual spec, the panel sections in order, then `{planDialogs}{importDialog}` and the upload
  input. Drop the separate status label.
- `TopBar.tsx`: new layout from the visual spec; remove the `PlanMenu` and `AppMenu` imports.
- Grep for remaining imports of `AppMenu` / `PlanMenu` (components, tests, README map) and fix them.

### 5. Tests

Unit (Vitest, `dom` project):
- `WorkspaceMenu.test.tsx` (ex `AppMenu.test.tsx`): the trigger is no longer named `Menu`; select
  it with `{ name: /^(Plan: |Choose game data)/ }`. Add: trigger shows the data-set label;
  "Loading…" sub-line while loading; enabled before game data loads.
- `PlanMenu.test.tsx`: render `<WorkspaceMenu />` (or a test harness around `usePlanSection`);
  action names are now `New plan`, `Rename plan`, `Duplicate plan`, `Delete plan`; the panel is
  named `Plan and game data`.
- `HorizonPicker.test.tsx`: clicking the button now opens the popover; reach the modal through
  **Choose technologies…** / **Edit horizon…**. Add: dot present only with targets; remove button
  drops one target; **Clear horizon** empties; Escape closes and refocuses the flag.
- `TechTree.test.tsx`: should pass unchanged (name stays `Tech tree`); adjust if it reads text.

E2E (Playwright):
- `e2e/support/appMenu.ts`: `menuTrigger` → `page.getByRole('button', { name: /^(Plan: |Choose
  game data)/ })`.
- `e2e/support/planMenu.ts`: `planMenu` → the `Plan and game data` menu; item names in
  `renameActivePlan`, `runPlanAction` (`'New plan' | 'Duplicate plan'`) and `deleteActivePlan`
  (`Delete plan` menuitem, then the dialog's `Delete plan` button).
- Add `e2e/support/horizon.ts` with `openHorizonDialog(page)` (click the `/^Horizon/` button, then
  `/^(Edit horizon|Choose technologies)/`). Use it in `plan-horizon.spec.ts` (`setHorizon`) and
  `extraction.spec.ts`. Replace every `horizonButton(...).toHaveText('Horizon: …')` (also in
  `tech-tree.spec.ts`) with `toHaveAccessibleName`.
- `app-menu.spec.ts`, `plans.spec.ts`, `plan-import.spec.ts`, `plan-export.spec.ts`,
  `game-data-*.spec.ts`: run them; fix selectors only, not behaviour.
- New coverage (in `plan-horizon.spec.ts` or a new `e2e/horizon-popover.spec.ts`): dot appears
  after setting a target and disappears after removing it from the popover; the popover lists the
  target names; **Edit horizon…** opens the modal; the horizon follows plan switches (dot on in a
  plan with targets, off in one without).
- New coverage (in `app-menu.spec.ts`): no button named `Menu` exists; on a first visit the
  trigger reads "Choose game data" and its panel picks a data set; after loading, the trigger reads
  the plan name and data-set label.

### 6. Docs

Per [CLAUDE.md](../../CLAUDE.md#spec-maintenance):
- [spec/ui.md](../../spec/ui.md): Layout diagram; TopBar; Plans (now a section of the workspace
  menu, action names); Block graph / Research horizon / Technology tree (icon buttons, dot,
  tooltip, targets popover); Menu (rename to "Workspace menu", merged contents, trigger states,
  status sub-line); Game data set ("open Menu" wording).
- [README.md](../../README.md): "Using the planner" (Menu at the top right, Plan menu at the left,
  Horizon / Block graph / Tech tree buttons) and the repository map row naming `AppMenu.tsx` /
  `PlanMenu.tsx`; add `icons.tsx` and `IconButton.tsx`.
- [backlog.md](../backlog.md): remove the top-bar item; add "Block counts in the plan list".
- When shipped: `git mv initiatives/top-bar-workspace initiatives/archive/top-bar-workspace` and
  update [initiatives/README.md](../README.md).

---

## Acceptance

- The top bar shows block tabs on the left and, on the right, three icon buttons, a divider and
  the workspace button; no "Menu" button and no plan button on the left.
- Every action reachable today (switch / new / rename / duplicate / delete plan, pick or upload
  game data, export, import, horizon, block graph, tech tree) is still reachable, by mouse and by
  keyboard.
- The flag shows a dot exactly when the active plan has a valid horizon target; its tooltip and
  accessible name give today's label text.
- The horizon popover removes targets, clears, and opens the unchanged modal.
- `npm run lint`, `npm run lint:docs`, `npm test` and `npm run build` pass.
