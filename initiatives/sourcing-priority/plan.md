# Sourcing priority: one Sources list per item

Status: Active

Where a block gets an item from is decided today by six settings in four places and five orders the player cannot see. This initiative replaces them with one ordered list per item, named by outcome, and a matching list on the source side that says who is served first. How sourcing works now is in [spec/solver.md](../../spec/solver.md) and [spec/ui.md](../../spec/ui.md); this document is the target and the path to it.

## Summary

Replace the three sourcing modes, the import lock and the implicit ordering rules with one concept: a **Sources list** per item. It is the ordered list of places an item may come from, and every existing setting is a reordering or a switch on that list.

- **One list, five sources.** Already made here, make more here, other areas, other blocks, import. The default order needs no setting; a non-default order replaces `B`, `C` and the lock.
- **Named by outcome.** Three presets cover the common cases: *Make it here*, *Receive it first*, *Only what's already made*. The full list is one click further for complex packs.
- **One place to set it.** The Ingredients pane owns the rule, because the rule belongs to the block and not to a row. The `B` / `C` pills go; the chip shows where the item comes from instead.
- **Rules can attach to an area.** An area rule overrides its block's rule. That gives per-consumer control and settles how connections interact with local-first, with no new concept.
- **Sharing is explicit too.** A source lists who it serves, in order, and how consumers of the same rank share a shortage. That replaces three hidden orders: block order, connection order and loop member order.

This plan is a design from the specs and the code. Nothing was prototyped, so the solver cost in the last sections is an estimate. The decisions that shaped it are listed under [Decisions](#decisions); the tickets of the first phase are in [phase-1.md](phase-1.md), and each later phase has a short doc with its scope and what to settle before it is ticketed: [2](phase-2.md), [3](phase-3.md), [4](phase-4.md), [5](phase-5.md), [6](phase-6.md).

## How sourcing works today

Sourcing is decided by six settings a player can change and five orders they cannot. The settings live in four places and the orders are not shown anywhere.

| Setting | Scope | Where it is set | What it does |
| --- | --- | --- | --- |
| Connection (request or take) | Consumer block, per item and source | Ingredients slot menu, block graph | A request drives the source; a take only draws on what is left over. The kind is derived from whether the source has the item as a product. |
| Connection limit (`maxRate`) | One connection | Segment menu, graph **≤** control | Caps what the consumer takes from that source. |
| Sourcing mode (`itemSourcing`) | Block, per item | Row side panel, Ingredients slot menu | *Own recipes first* (default), *Byproducts first* (`B`), *Connections first* (`C`). |
| Forbid imports (`noImportItems`) | Block, per item | Ingredients strip and menu, row side panel | Removes the import slack for the item. |
| Area flag | Sub-factory | Sub-factory row | Makes the sub-factory a separate area with its own rows. |
| Primary product | Row | Byproducts column | In a block with areas, decides which item a row is dedicated to. |

The orders the solver applies without a control:

1. **Own recipes before connections.** Two LP passes: measure the shortfall, then let connections fill it.
2. **Competing consumers of one source** are served in block order.
3. **Several sources for one item** are filled in connection order, reserved shares first.
4. **Inside a loop**, consumers are served in loop member order.
5. **Between areas**, an area with its own dedicated row does not take another area's dedicated output (local first). Among senders, the area higher in the table supplies first.

One default depends on a recipe ratio. When a block makes X only from an imported Y, a connection for X replaces the import with 1 Y per X, and does not when the recipe yields more X than Y. The [solver spec](../../spec/solver.md#connections-between-blocks) calls this an artefact of the objective.

## Where it confuses

A connection limit is easy because it is a number on a visible thing, and the result shows on that same thing. The sourcing modes fail on each of those three points.

| Problem | What the player meets |
| --- | --- |
| The badge is a code | `B` and `C` are single letters that must be learned. They show on table chips only: not on Ingredients slots, the areas matrix or the block graph. |
| The names describe the solver | "Byproducts first" really means "never run a recipe just for this; import or receive the rest". The import is the consequence the player cares about, and the name hides it. |
| Scope does not match the place | The mode applies to the item across the whole block, but it is set in the side panel of one row. A line in the panel has to say that every other row follows it. |
| Two controls, one question | "Where does this item come from?" is answered by the mode radio and by the separate **Forbid imports** checkbox, and they interact (a locked item ignores *Byproducts first*). |
| Settings that do nothing | *Connections first* has no effect without a connection, on a raw item, or on an item the block cannot make. *Byproducts first* has no effect on a locked, raw or goal item. The badge still shows. |
| One radio, two decisions | The modes mix "should my recipes run for this?" with "which comes first, my recipes or my connections?". There is no way to say "receive first, and never make it here". |
| Hidden orders | Who is served first depends on block order, connection order or loop member order. None is visible, and reordering tabs changes the plan. |
| Areas follow different rules | Local-first is automatic and driven by the primary product. *Connections first* does not override it. The same question has a different answer inside a block and between blocks. |
| Docs disagree | `spec/data-model.md` says the mode is set from an item chip's right-click menu; `spec/ui.md` says it is set in the panel and not from the chip. |

The common cause is that the app exposes solver mechanisms one by one. Each was added to fix one case, so each has its own name, place and exceptions.

## Proposed model

Every item a block uses has a Sources list: the places it may come from, tried top to bottom. The player learns one list, and every current setting becomes a position or a switch on it.

### The Sources list

1. **Already made here.** Surplus and byproducts of rows already running for something else. Byproducts and spare main product included: a row sized for another goal that overshoots counts too. Always first and always on, since using it adds no machines.
2. **Make more here.** Rows run or scaled up for this item itself, new or existing, which adds machines (the area's own rows when the rule is on an area). Heavy oil from a row running for petroleum gas is already made here; running more of that row to get more heavy oil is Make more here.
3. **Other areas.** Rows in other areas of the same block. Shown only in a block with areas.
4. **Other blocks.** One line per connection, in order, each with its optional limit and a read-only tag: requested when the source makes the item for this block, existing when it only gives what it has spare.
5. **Import.** From outside the plan. Always last.

Each line except Already made here can be switched off. *Make more here* and the block lines can be reordered. That is the whole model.

### How today's settings map onto it

| Today | Sources |
| --- | --- |
| Own recipes first (default) | Already made here, Make more here, Other areas, Other blocks, Import |
| Connections first (`C`) | Already made here, Other blocks, Make more here, Import |
| Byproducts first (`B`) | Already made here, Other areas, Other blocks, Import. *Make more here* is off. |
| Forbid imports | Any order with *Import* off |
| Connection limit | A cap on one *Other blocks* line |
| Connection order | The order of the *Other blocks* lines |
| Local first between areas | *Make more here* above *Other areas* in the area's order |

Two combinations become possible that are not today: receive first and never make it here, and receive from another block ahead of the area's own row.

### Presets, named by outcome

Most players never open the list. The slot offers three presets and an import switch:

| Preset | Replaces | Sentence shown |
| --- | --- | --- |
| **Make it here** | Own recipes first | "Made here; connections and imports cover what is missing." |
| **Receive it first** | Connections first | "Taken from Metals first; made here for the rest." |
| **Only what's already made** | Byproducts first | "Uses what this block already makes; the rest is received or imported." |

**Custom order…** opens the list itself: drag to reorder, a switch per line, a limit field on each block line. A custom order reads as its sentence, never as a code.

### Help on every line

Every line and preset carries a one-sentence description, so a name never has to stand alone. It shows as a tooltip on hover and keyboard focus, and as a help line under the selected line in **Custom order…**. It ships with the first version and can be thinned out once the names have proven themselves. A preset's help is its sentence from the table above.

| Line | Help text |
| --- | --- |
| Already made here | "What this block's rows already make while running for something else: byproducts and spare output. Using it adds no machines." |
| Make more here | "Run this block's rows, or more of them, for this item. Adds machines." |
| Other areas | "Take it from rows in another area of this block." |
| Other blocks | "Receive it from a connected block, up to the connection's limit." |
| Import | "Bring it in from outside the plan." |

### What changes in the UI

| Place | Today | Proposed |
| --- | --- | --- |
| Ingredients slot | Three radio items buried in the connection menu, no marker | Owns the rule: a **Comes from** control in the selected strip with the presets and **Custom order…** |
| Item chip in the table | Amber `B` / `C` | No letter. One neutral marker on the ingredient chips of the rows a rule changes, and only for a non-default rule that has an effect; the tooltip is the sentence, and a click selects the Ingredients slot. |
| Row side panel | Radio group and Forbid imports checkbox per ingredient | Read-only sentence per ingredient with a **Change…** link to the slot |
| Forbid imports | Separate checkbox and menu item | The *Import* switch in the same control |
| A rule with no effect | Badge shows as if active | Greyed with the reason ("No connection for iron plate") and a **Remove** action |
| Block level | Nothing | A "Source rules (3)" entry listing every non-default rule of the block, each removable |
| Areas matrix, block graph | Nothing | The same marker on the cell or the edge |

### Sharing: who a source serves first

The consumer side decides where an item comes from; the source side should decide who gets it. Each product and leftover of a block gets a **Served in this order** list of its consumers, shown in the Products and Byproducts panes and on the graph. It defaults to today's block order, so nothing changes until the player drags a line.

This one list replaces block order, loop member order and the rule that extra output gives way first. Extra output becomes a line of its own that can be moved up.

The list is made of groups, served top to bottom. A group holds one or more consumers.

- **Between groups: strict order.** A group is served in full before the next one gets anything. A list with one consumer per group is today's behaviour.
- **Inside a group: shares.** Equal by default, editable as percentages. A consumer that needs less than its share passes the spare to the others in its group, as a splitter overflows.
- **One gesture.** Drop a consumer between lines to give it its own rank, or onto a line to join that group.
- **Areas are consumers.** A consumer block with areas expands into them, so a source can rank or share between two areas of the same block.

```
Iron plate: served in this order
1  Science                         all it needs
2  Hub / Logistics    50%   share what is left
   Hub / Building     50%
3  Extra output
```

Shortages are rare on requests, which make the source produce what is asked. The list matters most for takes of a finite byproduct and inside loops. A connection limit still caps one consumer whatever its rank.

## Keeping the power

The list covers every case the modes cover today, and it closes five of the six open items under "Sourcing priority" in the [backlog](../backlog.md), plus the "Supplies other areas toggle" under Planning features. Packs like Seablock and Nullius need the cases below; each is one edit on the list or one rule on an area.

| Need in a complex pack | Today | With the Sources list |
| --- | --- | --- |
| Use a byproduct stream before making more (slag, waste water, hydrogen) | `B` on the item, block-wide | **Only what's already made**, or keep *Make more here* on below *Other blocks* to top up |
| One consumer takes the byproduct, another keeps its own supply | Not possible (backlog: byproducts first per consumer) | Put the consumer in an area and set the rule on that area |
| A central block feeds an area that also has its own row | Not possible (backlog: connections first vs local-first) | Move *Other blocks* above *Make more here* in that area's order |
| Prefer a cheap source, cap it, fall back to a second | Limits plus connection order, order not visible | Two block lines in order, a limit on the first |
| Decide who is short, or how a shortage is shared, when a source cannot serve everyone | Block order, or loop member order (backlog: served first in a loop) | The source's **Served in this order** list |
| Connected supply replaces an upstream import | Depends on the recipe ratio (backlog, partly done) | Follows the order: *Make more here* above *Other blocks* always makes it here, the reverse always receives it |
| Force a closed block with no outside input | Forbid imports per item | *Import* off, per item or as a block default |

### Choosing the supplying area

The backlog's **Supplies other areas toggle** (under Planning features) is covered only if *Other areas* expands like *Other blocks*: one line per area that makes the item, in order, each with a switch. Today an area without its own row is supplied by the most productive row, then table order. With per-area lines the receiving area picks its supplier, and switching a line off does what the toggle would do for that one receiver.

The toggle is per row and says "this row serves nobody else" in one click. The list needs that switched off in every receiving area. If that case is common, a **Served in this order** list on the supplying row, with an empty list meaning local only, is the source-side equivalent and matches the block-level design.

### Showing the routes where the rule is set

The backlog's **Per-partner area figures elsewhere** belongs with phase 5 as a prerequisite, not something the model makes obsolete. Once a player can choose which area supplies which, the result has to show beside the control. Today only the matrix and its focus view show who supplies whom; the collapsed-area chips and an item's "Trades with" panel do not.

The per-area lines of the Sources list are the natural place for those figures: each line shows the rate the solver routed from that area, read from `SolverResult.areaRoutes`. The collapsed-area chips and the "Trades with" panel then read the same routes, so the backlog item ships as part of phase 5 and needs no solver change.

### Scopes

A rule attaches to a block or to an area, and the narrower scope wins. A block with no areas has one scope and looks exactly like today. This is the only new idea for power users, and it reuses a structure they already built.

| Scope | Sets | Typical use |
| --- | --- | --- |
| Block | Default order for an item everywhere in the block | "This block never makes sulfuric acid" |
| Area | Order for an item in one area | "The smelting area takes slag slurry; the rest of the block makes its own" |
| Source block | Who is served first, and the shares | "Science gets plates before the mall" |

A block default for all items ("never import anything") is a natural extension and costs one more row in the block's rule list.

### What stays out

The sixth backlog item, connections first with partial supply, is a solver defect in the request probe. The new model does not fix it, and *Receive it first* inherits it until the probe knows the real supply.

Choosing between two recipes for the same item inside one block is a related question the list does not answer. *Make more here* stays one line; the LP keeps picking the cheaper recipe.

## Phasing and migration

The first phase removes most of the confusion and touches neither the solver nor saved plans. Later phases add power and each stands alone.

| Phase | What ships | Solver | Saved plans |
| --- | --- | --- | --- |
| 1. Rename and relocate | Outcome names, the **Comes from** control on the Ingredients slot with the import switch, sentence and marker instead of `B` / `C`, greyed inert rules, the block's rule list, help text on every line and preset, the third preset greyed with its reason while Import is off, a solver test pinning leftovers before connections | None | None: `itemSourcing` and `noImportItems` stay as stored |
| 2. The list | **Custom order…**, visible connection order, the requested / existing tag on each block line, the two new combinations | Small: both exist as LP terms already (free supply variable, cheap slack) but have never been combined on one item | `itemSourcing` and `noImportItems` load into one rule map, as `connectionsFirstItems` did |
| 3. Served order | The source's consumer list with blocks as consumers, one per rank, dragged to reorder; extra output as a line | Medium: serving order in `solveAll` and in loop rounds reads the list instead of block order | New optional field on the source; absent means block order |
| 4. Shares and areas | Groups in the consumer list with equal or percentage shares; a consumer block expands into its areas | Large: a shared group needs each member's need, then the split, then a second solve with the shares, also inside loop rounds; the area solve must divide what a block receives among its areas | The phase 3 field gains groups, shares and area entries; a list without them loads as one consumer per rank |
| 5. Area rules | Rules on an area, *Other blocks* above *Make more here* in an area | Large: the area LP needs the local-first penalty and the slack cost per area and item | New optional field on an area sub-factory |
| 6. Predictable default | *Make more here* no longer depends on the recipe ratio | Medium: an extra pass, or a changed objective, for items made from an import | None, but results change for affected plans |

### Risks

- **Phase 1 is a rename of visible strings.** The e2e specs `item-sourcing.spec.ts` and `block-requests.spec.ts` and the `sourcingText` tests assert the current labels.
- **Phases 2 to 6 change solver results or inputs.** Each needs its synthetic case in `spec/test-synthetic.md` first. `legacyParity.test.ts` already guards that default plans do not move.
- **More LP calls.** A block with areas runs up to four LPs per solve today. An order with three movable tiers could need one pass per tier; the solve cache key must then include the rule.
- **Phase 6 changes numbers in existing plans.** It should ship alone, with a release note.

## Decisions

Taken with the author on 2026-11-10, in answer to the open questions of the first draft.

| Question | Decision | Why |
| --- | --- | --- |
| Does *Connections first* use the block's own spare output before a connection today? | Yes, in the single LP and in the area LP. A solver test pins it in phase 1. | Measured with throwaway `solveBlock` runs: a block with 30 spare plate and a need of 50 receives 20, also with an unlimited offer, so a request asks the source for 20. Nothing guarantees it: supply and surplus both cost 0, so it is a tie the solver happens to break this way. `spec/solver.md` says a connections-first item's need is "its whole use", which is loose. |
| What are the things called? | The list is **Sources**, its control is labelled **Comes from**. Lines: *Already made here*, *Make more here*, *Other areas*, *Other blocks*, *Import*. Presets: *Make it here*, *Receive it first*, *Only what's already made*. | "Supply" already means what arrives over a connection. "Leftovers" did not explain itself against "Make here", since both are the block's own rows; the first two lines are named as a pair instead. |
| Does a name need a backup explanation? | Yes: help text on every line and preset from the first version. | The names are new; they can be thinned out once they have proven themselves. |
| Drag order or priority numbers on the source side? | Drag, with groups. | One ordering gesture across the app. Ties between numbers cannot express 70 / 30, and their direction has to be learned. |
| Is a shortage ever split? | Yes, and the player chooses how: consumers in one group share, equally by default, with editable percentages. Areas of a consumer block can be ranked and grouped like blocks. | This is how the author lays out factories: science first, then the hub's areas sharing what is left. A split in proportion to need is left out until someone asks. |
| How many phases? | Six: the shares and areas work is its own phase 4. | It needs a second solve per shared group and a change to the area solve, too much to carry in the served-order phase. |
| Is the chip marker needed? | Yes, but rarer: only for a non-default rule that has an effect, and only on the ingredient chips of the rows it changes. | The table is where a rule's effect shows, so the marker is the link from effect to cause. An inert rule is greyed in the block's rule list and shows nothing in the table. |
| Phase 1 alone, or with phase 2? | Alone. | It is UI only, and the names get tried before a migration builds the stored format around them. Today a locked item ignores Byproducts first, so *Only what's already made* is greyed, with its reason, while Import is off; phase 2 makes that combination real. |
| Is request or take shown on a block line? | Yes, as a read-only tag, **requested** or **existing**, the words the block graph uses. It ships with phase 2. | A requested line can cover the whole need; an existing line gives only what is spare. Without the word, the order alone does not say which one the player has. The kind still follows from the source's products; an existing line links to the source's **Make it a product** action. |
