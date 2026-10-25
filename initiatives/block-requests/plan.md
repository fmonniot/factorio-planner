# Initiative: Requests between blocks

Status: Active

Rework how blocks supply each other. Today each connection is a *push* (the consumer takes what the source's goals leave over) or a *pull* (the consumer's demand is added to the source's goals), chosen per connection on the consumer's side. This initiative replaces that choice with two plain actions: a block **requests** one of another block's **products**, which makes the source produce it, or **takes existing** output the source has left over, which never changes the source. A product's rate becomes optional **extra output**, added to what is requested.

UI sketches: [Supply modes sketches](https://claude.ai/artifact/Us8n3uoSDyYRH3W4XoSzfu) (Design canvas, six artboards; referred to below as *sketch 1–6*).

---

## Why

The current system grew in two steps (push connections, then pull on top), and it shows:

1. **A goal's number changes meaning depending on a flag stored on another block.** With push consumers, the source's goal is a capacity that consumers share. With pull consumers, it is extra output added to what they pull. Looking at the source, you cannot tell which one applies.
2. **The setting and its effect are on opposite blocks.** Push/pull is set on the consumer, but it changes how much the source makes. The source shows pulled demand in read-only "pulled-only" slots, and reports a shortfall on it as if the user had set that goal.
3. **The toggle asks a question the data already answers.** A pull applies only when the source has a recipe that makes the item (`pullIgnored: 'no-producer'` otherwise). Push is the natural fit for byproducts and surplus. In practice, main products are pulled and byproducts are pushed.
4. **Goals of 0 are not allowed.** A pure supplier block still needs a goal to anchor the block (tab icon, Find recipe, menus), so users type a tiny rate.
5. **Setting up a supplier block runs backwards.** To pull from a block it needs a recipe for the item, which usually comes from "add goal → Find recipe". The graph's connect mode lists only sources with something on offer.

Auto-routing (any block that imports X is served by "the" block that makes X) was considered and rejected. The solver has no notion of where things are built, and a connection stands for a real belt or train between two places. Connections stay explicit and per item.

## The model

**Products.** A block's products are what `Block.goals` holds today. A product has an item and an optional **extra output** (items/min, > 0). The block makes `extra + Σ requested` of it. A product without extra and without requests makes nothing. It stays listed, dimmed, so the block keeps its icon and its Find recipe action (sketch 1, Iron rod).

**Connections.** A connection still lives on the consumer and reads "B gets X from A", with an optional limit. Its kind follows from A's product list:

| X at the source A | Connection kind | Effect |
|---|---|---|
| one of A's products | **request** | B's demand for X (capped by the limit) is added to what A makes of X |
| anything else (byproduct, surplus intermediate) | **take existing** | B takes what A has left over, as a push does today; A is never changed by it |

A product can only be requested: there is no way to take only what is left of a product, because a product's extra output is meant for outside the plan. Byproducts can only be taken. A user who wants a byproduct to drive its source makes it a product on the source, then requests it.

Example (Nullius-style): block *Electrolysis* makes slag, oxygen and hydrogen; slag is its product. *Sludge* requests slag, so its needs drive how hard Electrolysis runs. *Acids* takes existing hydrogen: it uses whatever falls out and never changes Electrolysis.

**Only the block you are looking at changes.** From a consumer you request another block's products or take its existing byproducts; you never change what another block declares as products. The [block graph](../../spec/ui.md) shows the whole plan, so it counts as looking at every block: connecting, limiting and removing connections stay possible there, but it does not change products either. *Make in a new block…* creates a block and switches to it, so it does not change a block behind the user's back.

**Changing products asks first.** A connection's kind depends only on its source's product list, and that list only changes on the source. When adding or removing a product of A would change other blocks' connections, a confirmation lists them and what happens to each (sketch 6):

- **Making X a product** while other blocks take existing X from A: "Acids takes existing Hydrogen from this block (14/m). It will request it instead, so its needs will drive how much this block makes."
- **Removing product X** while other blocks request it: "Sludge requests Slag from this block (30/m). It will only take what is left over and no longer drive this block."

Cancel leaves everything as it was. Undo and redo of such a change apply without asking, since they revert or replay a change the user confirmed.

**Own production or connections first.** By default a block uses its own recipes first, and a connection covers only what it would otherwise import (today's rule). Per item, the consumer can choose **Use connections first**: connected supply is used before its own rows, which only top up the rest. It sits next to **Forbid imports** and applies to every connection for that item, request or take. Example: Acids has its own hydrogen row; with *Use connections first* on hydrogen it uses Electrolysis' leftover hydrogen and its row makes only the rest.

**Shortfall.** When A cannot make everything asked of a product, requests are served first, in solve order. The shortfall comes out of the extra first, then out of the requests served last. The Products pane splits it accordingly (sketch 2, "Short 10 — comes out of the extra"). This replaces the backlog item "Soften a source's shortfall caused only by pulled demand".

**Wording.** The UI says *product*, *extra output*, *request(ed)* and *take existing*. It does not label products "on demand": with no alternative mode, that would only add noise. The only product state that needs words is "nothing requested yet".

## Data model

The stored model and the code use the new vocabulary rather than keeping the old names to save changes:

```ts
interface Block {
  // …
  products: Product[]               // was `goals`
  noImportItems: string[]
  connectionsFirstItems: string[]   // new; default []; items for which connected supply is used before own production
  inputConnections: BlockConnection[]
}

interface Product {                 // was `ProductionGoal`
  id: string
  itemId: string
  extraRate?: number                // was `rate`; > 0 when present: extra output, items/min; absent = only what is requested
}

interface BlockConnection {
  id: string
  itemId: string
  fromBlockId: string
  maxRate?: number                  // unchanged
  // `pull` removed; the kind is derived from the source's products
}
```

Inside the solver, *goal* keeps its meaning as the rate the LP must reach: a product's goal is `extraRate + Σ requested`. `SolverPlan.goals` stays, and is built from the products and the request pass. On `ConnectionFlow`, `demand` becomes `requested`, `pullIgnored` becomes `requestIgnored`, and a derived `kind: 'request' | 'take'` tells the UI which one a connection is.

### Migration

Every load goes through the schema (localStorage, plan import, and the per-data-set plan keys), and the schema already migrates older shapes in preprocess steps (`migrateBlock` lifts goals out of sub-plans). The renames go there too: `goals` → `products`, `rate` → `extraRate`. A saved plan loads in the new shape and is written back in it on the next save, so users see no difference. `migrateBlock`'s legacy path produces `products` directly.

The connection rules run in `AppStateSchema`'s preprocess (like `assignMissingBlockColors`), because they change a source block based on its consumers' connections. They have no game data, so they are data-free. This is the one place a block is changed from another block's data, and it preserves behaviour except where noted:

| Before | After |
|---|---|
| `pull: true`, source has a goal for X | flag dropped; request (same behaviour) |
| `pull: true`, source has no goal for X, does not receive X, not a duplicate | X added to the source's products without extra; flag dropped; request (same behaviour) |
| `pull: true`, source receives X, or duplicate `(source, item)` | flag dropped; take existing (same behaviour: those pulls were ignored) |
| push to a non-goal item | take existing (same behaviour) |
| push to a goal item of the source | **request — behaviour changes**: the source now makes goal + demand instead of sharing the goal between consumers |

Two cases change what a saved plan shows:

- A former `no-producer` pull now adds a product the source cannot make, which shows as short in the source. The consumer gets nothing, as before, and the problem is now visible where it belongs.
- A push to a goal item now makes the source grow. This is the one change in totals; the release notes should say so.

## Solver

- **Request pass.** `computePullDemands` becomes the request pass. A connection is a request when its item is a product of an existing source other than the consumer, and it is the first connection for its `(source, item)` pair. `pullIgnoredReason`'s `no-producer` disappears (the demand goes to a product that falls short); `source-receives` stays only as a guard for imported JSON (the store already forbids a connection to one of the consumer's products). `mergePulledGoals` treats a missing `extraRate` as 0 and drops products whose total is 0.
- **Blocks with nothing to make.** A block whose products have no extra and no requests gets the empty result, as a goal-less block does today.
- **`pending` reservation.** It protected pulled demand from push consumers of the same `(source, item)`. A product now has only request consumers, so check whether `pending` is still needed, and simplify it if not.
- **Use connections first.** For an item in `connectionsFirstItems`, the supply variable `u_i` (cost 0) goes into a single LP capped by the offer only, not by the pass-1 residual. Every recipe run costs at least `+1` in the objective, so the LP prefers supply and the block's own rows make only the rest. The probe of a requesting block then measures its full need (minus pinned production), so the source makes all of it. To check: byproduct-consumer recipes (`BC_BONUS`, negative cost) competing with supply, and locked items (pass 1 drops locks on connected items today). It also gives users a way around the backlog item "Let connected supply replace an upstream import": with the option on, supply at cost 0 beats importing an upstream item.

### Request cycles

The request pass runs once, consumers first, so it needs requests to form a DAG. Cycles of pulls are ignored today (`pull-loop`), and the store refuses to create them (`closesPullLoop`).

Many real loops close through a byproduct (the Seablock Metals → Sciences → Ores → Metals loop is carried by `sct-waste-ironcopper`). Those connections take existing output, and the requests still form a DAG. So request cycles are a separate, later phase, not a prerequisite:

- **Until then.** The connection menus disable a request that would close a cycle, with the reason as the title, as they do for pulls today. Making an item a product can turn existing take connections into requests and close a cycle; the confirmation says so, and the solver ignores a cycle-closing request (`request-loop`), treats it as take existing, and the UI flags it.
- **Then.** Solve demand in rounds, like loops of blocks: start from zero demand on back connections, re-run the members' probes with last round's demand, and stop when every back connection's demand changes by less than `1e-6` relative. Demand converges geometrically with the loop's gain, so `LOOP_ROUND_LIMIT = 8` is probably too low (gain 0.5 needs about 20 rounds). Options to compare on a real plan: plain iteration with a higher limit, an acceleration step on the back connections, or one LP for the whole loop. A loop whose gain is ≥ 1 cannot be satisfied, so it reports a warning after the limit. Each round runs a probe per member, so the `SolveCache`'s three entries per block will thrash in a loop.

## UI

- **Products pane** (sketches 1 and 2).
  - Every product is a slot. A product with no extra and no requests is dimmed with a dashed border and `—`.
  - The pulled-only slots go away: after migration, everything pulled is a product.
  - Strip header: `extra N + requested M → K /m`, or `requested M → K /m` without extra, where the extra is the inline-editable button. Segments: one `export` per requester, then `Extra` (what is kept), then `Short`.
  - The key gives `<block>: delivered of requested` per requester, `Extra: kept of N`, and where the shortfall comes from.
  - Actions: **Find recipe**, **+ Extra output** or **Remove extra**, **Remove product** (with the confirmation when other blocks request it).
- **Byproducts pane.** Unchanged, plus **Make it a product** in the slot's menu and strip (with the confirmation when other blocks take it).
- **Adding a product** (sketch 3). The item picker's amount becomes **Extra output**. The default stays 60, so adding an item still shows machines at once with no setup ("Progressive complexity" in [spec/overview.md](../../spec/overview.md)). Clearing the field adds the product without extra. Adding an item other blocks take goes through the confirmation.
- **Confirmation** (sketch 6). A modal titled after the change ("Make Hydrogen a product of Electrolysis?" / "Remove Slag from Electrolysis' products?"), one line per affected connection (consumer, item, current rate, what happens), **Cancel** and the action. Shown only when some connection changes kind.
- **Ingredients connection menu** (sketch 4). Sections:
  - **Request X from**: blocks that have X as a product.
  - **Take existing X from**: blocks that have X left over and do not have it as a product, with the rate. Blocks with nothing left are not listed.
  - **Make in a new block…**: creates a block named after X with X as its only product, adds the request, switches to the new block and opens the recipe picker filtered to X.
  - **Use connections first** (checked or not; only when the item has a connection) and **Forbid imports** / **Allow imports**.

  The segment menu loses **Pull from source** / **Stop pulling**.
- **Block graph** (sketch 5).
  - The chip loses its `⇠` toggle. A take-existing connection gets a small `existing` tag; a request has none (it is the common case).
  - Connect mode lists, per target, the items the target imports that the source has as a product or has left over. A source with nothing on offer is still listed for its products. This replaces the backlog item "Pull from the block graph's connect mode".
  - The summary chip's `⇠` marker goes away.

## Phases

1. **Model and migration.** Renames, optional `extraRate`, `pull` removed, migration, solver request rule (DAG only, cycles refused / ignored as today), flow field renames. The UI changes needed to stay consistent ship in the same phase: the pull toggle, the Pull menu entries and the pulled-only slots go away; products without extra render (rate `—`); the Ingredients menu gets its **Request X from** / **Take existing X from** sections; the confirmation for product changes. Spec: [data-model.md](../../spec/data-model.md), [solver.md](../../spec/solver.md), [ui.md](../../spec/ui.md). Split in two: 1a, the rename with no behaviour change (shipped); 1b, the request semantics and the UI that keeps it consistent (shipped; see [phase-1b-plan.md](phase-1b-plan.md)). 1b also made the item picker's amount optional (an empty amount adds a product without extra output), so products without extra are reachable without migration.
2. **Products pane.** The dimmed empty state, the strip header and segments, shortfall split, **+ Extra output** / **Remove extra**, **Make it a product** in Byproducts. The item picker's optional amount shipped in 1b. Note for the shortfall split: `pending` currently makes the requester served first absorb a shortfall of the source (phase 1b kept today's behaviour); the Shortfall rule above is implemented here. Spec: ui.md.
3. **Connecting.** **Make in a new block…**, the graph's `existing` tag, connect mode for zero-offer sources. Spec: ui.md, README "Using the planner".
4. **Use connections first.** `connectionsFirstItems`, the single-LP path, the menu entry. Spec: data-model.md, solver.md, ui.md; a synthetic case in [spec/test-synthetic.md](../../spec/test-synthetic.md) if one fits.
5. **Request cycles.** Demand rounds with a convergence check (see above), then drop the menu restriction. Includes the Seablock loop as an integration test (backlog: "Seablock loop regression test").
6. **Take before request.** A consumer with a take connection and a request for the same item asks the requested source for its whole demand, because the take offer is unknown when demand is computed. Subtract the taken supply first (backlog: "Subtract push supply from pull demand").

Each phase ends with unit and e2e coverage. `e2e/block-requests.spec.ts` (renamed from `block-pull.spec.ts` in phase 1) is extended in the later phases.

## Decisions

- No Fixed capacity mode: a product's number is always extra output, added to what is requested.
- No auto-routing: connections stay explicit, one per item, made deliberately.
- No bulk "receive everything <block> can give" action.
- A connection's kind is derived from the source's products, not stored. The only change that can alter it, a product change on the source, asks for confirmation and lists the consequences.
- From a consumer you can only request existing products or take existing byproducts; other blocks' products are never changed from there. Turning a byproduct into a product is done on its block.
- Products can only be requested; nothing takes "what is left" of a product.
- Own production first stays the default; **Use connections first** is a per-item choice on the consumer.
- Names follow the new model (`products`, `Product`, `extraRate`), not the smallest diff; the schema migrates saved plans so users see no difference.
