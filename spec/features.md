# Features

## MVP (v1)

These features must work before the project is considered usable.

### Plan Management
- [ ] Create a new empty plan with a name
- [ ] Add/remove production goals (item + rate)
- [ ] Edit goal rate inline
- [ ] Save plan to localStorage
- [ ] Export plan as JSON
- [ ] Import plan from JSON
- [ ] Share plan via URL (compressed query param)
- [ ] Undo / redo

### Solver
- [ ] Solve a linear chain of recipes
- [ ] Solve multi-output recipes (oil processing)
- [ ] Solve cyclic recipes (Kovarex)
- [ ] Detect and report underdetermined systems
- [ ] Pin a recipe node's rate (set as free variable)
- [ ] Apply productivity module bonus to stoichiometry
- [ ] Report raw resource requirements (unsatisfied items)

### Recipe Node Configuration
- [ ] Select alternate recipe for an item (when multiple recipes exist)
- [ ] Select machine type per node
- [ ] Configure modules per node (slot-count enforced)
- [ ] Configure beacons per node
- [ ] Set byproduct policy per product (discard / feed-back)

### UI
- [ ] Tree view of production plan
- [ ] Table view (flat, sortable)
- [ ] Goals panel (sidebar)
- [ ] Summary bar (machines, power, raw resources)
- [ ] Item picker (search by name)
- [ ] Solver warnings displayed on affected nodes
- [ ] Settings panel: default machine per category, rate unit
- [ ] Load Nullius game data bundle on startup (bundled with app)
- [ ] Import custom game data JSON (other mod sets, future use)

---

## Post-MVP (v2+)

These are desirable but explicitly deferred.

### Enhanced Solver
- Optimization mode: minimize machine count, or power, subject to goal constraints (linear programming via simplex)
- Multi-factory support: split plan into sub-factories with explicit inter-factory transfer rates
- Mining productivity support (affects ore yield)

### UI / UX
- Sankey / flow diagram view
- Recipe card grouping (manual folders or auto-group by tier)
- Collapse/expand subtrees in tree view
- Drag-and-drop goal ordering
- Keyboard shortcuts for common actions
- Dark mode

### Data
- Vanilla Factorio support
- Additional mod support (tested and bundled datasets)
- In-app Lua script runner to export data directly from a game installation
- Diff view: compare two versions of a plan

### Sharing / Collaboration
- Named plan links (server-side short URLs)
- Read-only plan view for sharing without editing
