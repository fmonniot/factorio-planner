# Initiatives

Time-bound work — the backlog, active initiatives, and archived shipped ones.
For timeless reference docs (system-as-it-is), see [../spec/](../spec/).

## Conventions

1. `spec/` is timeless; `initiatives/` is time-bound. Phases, tickets, status
   markers belong here.
2. Small or not-yet-designed work is a line in [backlog.md](backlog.md). Work
   that needs a design doc gets its own folder with a primary design/plan doc,
   linked from the backlog.
3. The first non-heading line of that doc is `Status: Active | Future | Blocked — <reason>` (`Shipped` is optional once archived).
4. When an initiative ships, run `git mv initiatives/<name> initiatives/archive/<name>`
   and fix in-folder references to the old path. Do not otherwise rewrite the documents.
5. Update this README whenever a folder is added, archived, or changes status.

## Index

| Initiative                  | Status   | Folder                                                 |
|-----------------------------|----------|--------------------------------------------------------|
| Backlog                     | —        | [backlog.md](backlog.md)                               |
| Share a plan by URL         | Future   | [share-by-url/](share-by-url/)                         |
| Block granularity           | Future   | [block-granularity/](block-granularity/problem.md)     |
| Requests between blocks     | Shipped  | [archive/block-requests/](archive/block-requests/)     |
| Top bar workspace menu      | Shipped  | [archive/top-bar-workspace/](archive/top-bar-workspace/) |
| Summary panes as slots      | Shipped  | [archive/summary-panes-slots/](archive/summary-panes-slots/) |
| Reorder recipes (DnD)       | Shipped  | [archive/reorder-recipes-dnd/](archive/reorder-recipes-dnd/) |
| LP solver v2                | Shipped  | [archive/lp-solver/](archive/lp-solver/)               |
| Factory-planner UI redesign | Shipped  | [archive/ui-redesign/](archive/ui-redesign/)           |
| Visual parity (V01–V10)     | Shipped  | [archive/visual-parity/](archive/visual-parity/)       |
| Edit Machine modal          | Shipped  | [archive/edit-machine-modal/](archive/edit-machine-modal/) |
| Edit Beacon modal           | Shipped  | [archive/edit-beacon-modal/](archive/edit-beacon-modal/) |
| Flatten subplans            | Shipped  | [archive/flatten-subplans/](archive/flatten-subplans/) |
| Documentation cleanup       | Shipped  | [archive/docs-cleanup/](archive/docs-cleanup/)         |

Phases 0–5 (ground-truth data and test corpus, scaffold, first solver, state
and persistence, first UI) predate initiative folders and are recorded only in
`git log`. Their solver and UI were later replaced by the LP solver v2 and UI
redesign initiatives above.

Outstanding work not yet promoted into its own folder lives in
[backlog.md](backlog.md).
