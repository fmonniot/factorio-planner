# Initiatives

Time-bound work — roadmap, active initiatives, and archived shipped ones.
For timeless reference docs (system-as-it-is), see [../spec/](../spec/).

## Conventions

1. `spec/` is timeless; `initiatives/` is time-bound. Phases, tickets, status
   markers belong here.
2. Each initiative gets its own folder with a primary design/plan doc.
3. The first non-heading line of that doc is `Status: Active | Future | Blocked — <reason>`.
4. When an initiative ships, run `git mv initiatives/<name> initiatives/archive/<name>`.
   No rewriting. Location implies status.
5. Update this README whenever a folder is added, archived, or changes status.

## Index

| Initiative                  | Status   | Folder                                                 |
|-----------------------------|----------|--------------------------------------------------------|
| Roadmap                     | —        | [roadmap.md](roadmap.md)                               |
| Reorder recipes (DnD)       | Active   | [reorder-recipes-dnd/](reorder-recipes-dnd/)           |
| LP solver v2                | Shipped  | [archive/lp-solver/](archive/lp-solver/)               |
| Factory-planner UI redesign | Shipped  | [archive/ui-redesign/](archive/ui-redesign/)           |
| Visual parity (V01–V10)     | Shipped  | [archive/visual-parity/](archive/visual-parity/)       |
| Edit Machine modal          | Shipped  | [archive/edit-machine-modal/](archive/edit-machine-modal/) |
| Edit Beacon modal           | Shipped  | [archive/edit-beacon-modal/](archive/edit-beacon-modal/) |
| Flatten subplans            | Shipped  | [archive/flatten-subplans/](archive/flatten-subplans/) |

Outstanding work not yet promoted into its own folder lives in
[roadmap.md](roadmap.md) (Phases 6 and 7).
