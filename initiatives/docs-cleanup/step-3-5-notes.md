# Steps 3 and 5 — notes

Scope: `CLAUDE.md`, `AGENTS.md`, `.claude/skills/state-bug-fix/`, `TODO.md`,
`initiatives/roadmap.md` → `initiatives/backlog.md`, `initiatives/README.md`.
Nothing committed; all moves/deletes staged with `git mv` / `git rm`.

## Step 3 — agent-facing docs

- `git rm CLAUDE.md` (symlink), `git mv AGENTS.md CLAUDE.md`, then rewrote
  `CLAUDE.md` per structure.md "Slim CLAUDE.md contents". Git currently shows
  this as `D AGENTS.md` + `T CLAUDE.md` (typechange); rename detection on the
  commit should still pair them as the content stays similar in places, but
  the rewrite is large, so `git log --follow CLAUDE.md` may not cross it.
- `git rm -r .claude/skills/state-bug-fix` (D2).
- New CLAUDE.md keeps: what-this-is + pointers; quirks (vite/vitest split,
  vitest's 3 projects, Tailwind `@import`); full command list from
  `package.json` incl. `postbuild`, `preview`, `test:unit`, `test:e2e`,
  `npx playwright install chromium`; one CI line; type-system rules (cast rule
  scoped to application code — component tests do `as unknown as GameData`);
  test rules (fresh fixtures, literal or `structuredClone`; `expect(v, msg)`;
  e2e preference; corpus = ground truth, not yet automated); spec table for
  the final spec set; documentation-layout rules and maintenance table updated
  for `backlog.md` and README repository map. Added a "UI behaviour → spec/ui.md"
  maintenance row (ui.md had none).
- Dropped: tech-stack sentence, repository layout, mainProduct transform,
  solver pipeline, game-data export recipe, "not yet implemented".
- Verified against: `package.json` scripts, `vitest.config.ts`,
  `vite.config.ts` (no `test` key), `src/index.css:1`, `src/data/types.ts`
  re-exports, `schema.ts` `z.output` types, `playwright.config.ts` webServer,
  `.github/workflows/test.yml`.

## Step 5 — backlog

- `git mv initiatives/roadmap.md initiatives/backlog.md`, rewritten from the
  audit-c draft. Shipped table dropped (pointer to `initiatives/README.md` +
  `git log`). `git rm TODO.md` after folding in all open items.
- Added from audit.md "Code issues spotted": corpus cases as unit tests,
  Seablock `'kompetenz-seablock/'` id / `//` URL, `gameDataVersion` never set,
  `MachinePopover`/`ModulePopover` never rendered (files still export live
  `MachineCell`/`ModuleCell`/`isModuleAllowed*`), CI not on `main`.
  Undo/redo and `renameSubPlan` were already in the draft's UI section.
- Reworded "Solver integration test" so it no longer points at
  `src/solver/__fixtures__/` (deleted under R1 in step 4).
- Dropped: done items (6.1, 6.4, 7.1, labels, usage README), "Review project
  management" (closed by this initiative), Lua runner, dark mode (→ light-theme
  idea), manual grouping, multi-factory splitting.
- `initiatives/README.md`: Roadmap row → Backlog; convention 2 mentions the
  backlog; intro and closing line point to `backlog.md`; added a sentence for
  phases 0–5. Documentation cleanup row left as Active.

## Not verified / open questions

- The vite/vitest "`test` key causes a TypeScript error" quirk is carried over
  from AGENTS.md and the audit marked it verified; I did not reproduce the
  error myself.
- Seablock id: whether `'kompetenz-seablock/'` is persisted (IndexedDB /
  localStorage selection key) was not checked — noted in the backlog item.
- Inbound references outside my scope still to fix (owned by others):
  `README.md` links to roadmap/TODO (structure.md lines 39, 93, 99);
  `spec/test-corpus.md:4` "see AGENTS.md"; `spec/data-analysis.md` (deleted
  in step 4). CLAUDE.md links `README.md#repository-map` and
  `#exporting-game-data` — both headings exist today; keep them if README is
  rewritten.
- `initiatives/archive/reorder-recipes-dnd/plan.md:15` links `../../TODO.md` —
  archive, left as-is.
- `docs-cleanup/plan.md` step checkboxes not updated by me (not in my scope).
