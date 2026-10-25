# Initiative: Requests between blocks — PR 1b plan

Status: Shipped

Design saved from the first planning pass; re-check it against the code as shipped by PR 1a before implementing. Decisions taken: two PRs (1a the rename, then 1b the requests); keep today's shortfall behaviour (`pending` unchanged; the requester served first absorbs the shortfall, settled in phase 2); keep the goal labels ("Add goal", "Goal target rate", "Target: …", "Remove goal") until phase 2; a product change that closes a request cycle is allowed after confirmation and the solver treats every request in the cycle as take existing (`request-loop`).

## As shipped

The implementation followed a revised plan written after PR 1a landed, which superseded this draft. Corrections to the draft:

- `closesRequestLoop` changed meaning: its edges follow the source's products, not `pull`.
- `StepContext.goals` and `solveStep`'s use of it already existed; only `pull` became `requests`.
- `findUnknownPlanIds` and the unknown-item e2e check needed no change.
- `GoalInfo.target` became `ProductInfo.extra` (not an existing field).
- Loader `rejects` cases flipped: product `extraRate: 0`, legacy `rate: 0` and a missing `extraRate` now load.
- In the e2e removal test the consumer's plate slot is not `limited` afterwards (a zero-rate flow draws no segment).
- `solverStore.test.ts` "re-solves only the block whose goal changed" was rewritten: a consumer's request drives its source.
- `summary-many-items.json` is unchanged; its connections became requests.
- The item picker's amount became optional in 1b.
- `ProductChangeEffect` carries `blocker?`; removal skips already-ignored connections.
- `removeProduct` undo restores the old index; undo of a removed request is cycle-guarded.


## Hand-off from PR 1a
- **Migration ordering.** The connection rules belong in `AppStateSchema`'s preprocess after mapping every raw block through `migrateBlock`, so products hoisted from sub-plans are visible.
- **`pending`** still guards a later requester's share (unit test 12 below). Kept unchanged by user decision.
- **Tests that change meaning.** Plain connections to goal items become requests; keep `describe('solveAll')` and `loops` numbers by making the connected items byproducts (a `twin` recipe; marker co-products on the loop recipes).
- **`e2e/fixtures/block-loop.json`.** Remove Gears' ingot goal and pin node `n2` at 60 runs/min.
- **`block-connection.spec.ts`.** The "lower goal → limited" step no longer holds.
- **No undo UI**, so "undo applies without asking" is a store test.
- **`lint:docs`** checks paths, not anchors; README line 141 must follow the spec file rename.
- **Product slots.** A product with no extra and nothing requested must not show as short when the block consumes the item.

---

## Phase 1b plan: requests between blocks (model and migration)

Phase 1 of `initiatives/archive/block-requests/plan.md`, second half. After 1a (rename `goals`→`products`, `rate`→`extraRate`, `RecipeProduct`, `SolverGoal`, store renames) this PR does the behaviour change:

- `Product.extraRate` becomes optional.
- `BlockConnection.pull` is removed. A connection is a **request** or a **take existing** depending on the source's products.
- The legacy pulls migrate in the schema preprocess.
- The solver's pull pass becomes a request pass.
- The UI is kept consistent: the pull toggle and pull menus go, products without extra show `—`, the Ingredients menu gets Request and Take existing sections, and a confirmation appears when a product change affects other blocks.

Phases 2 to 6 stay out of scope.

### Findings that shaped the plan

1. **Many existing tests break, not just the pull tests.** Under the new rule, a plain connection to an item the source has as a goal becomes a request. Most of `describe('solveAll')` and its `loops` tests in `src/solver/index.test.ts` connect to goal items, so their expected rates would change. The plan keeps those tests' numbers by changing what the sources make (step 6), not by recomputing values.
2. **`e2e/block-loop.spec.ts` cannot pass as written.** Its loop closes through two items that are both goals of their source, so after migration both connections are requests and they form a cycle. The fixture has to change: the Gears block makes its ingots from a pinned recipe instead of an ingot goal.
3. **`e2e/block-connection.spec.ts` changes behaviour.** Lowering the Plates goal to 20 no longer limits Gears, because Gears' connection is now a request. That step is dropped.
4. **The app has no undo button or shortcut.** Undo exists only in the store, so "undo of a product change applies without asking" is tested in `blockStore.test.ts`, not in Playwright.
5. **The doc link checker only checks paths, not `#anchors`.** It does check repo paths written in backticks, so renaming `e2e/block-pull.spec.ts` breaks README line 141 until it is updated.

### Approach

Work in this order. Each step should type-check before the next one starts.

1. **Schema and types.** Optional `extraRate`, the plan-wide pull migration, flow types.
2. **Solver.** The request pass, the flow field renames, and goals built from products.
3. **Graph and store helpers.** The request-cycle check, the request and take candidate lists, and the product-change effects list.
4. **Store.** `addInputConnection` loses its `pull` parameter; `updateProductExtra` accepts undefined.
5. **UI.** Products pane, Ingredients menu, block graph, item picker, confirmation dialog.
6. **Unit tests.**
7. **End-to-end tests and fixtures.**
8. **Docs.**

Decisions the code and conventions settle:

- **The solver's "goal" has its own type** (`SolverGoal { id; itemId; rate }`, introduced in 1a).
- **`pending` stays.** It still protects a later requester's share in two cases:
  - a connection to a product that is treated as take existing (ignored as `request-loop` or `source-receives`, or a duplicate);
  - a requester whose first source of an item falls short and that then draws on its next source beyond its own share.

  New unit test 12 in step 6 shows the second case. Only the comment and names change.
- **When the migration runs.** `AppStateSchema`'s preprocess first runs `migrateBlock` on every raw block, so `products` already exists when the pull rules run. That covers both legacy block-level `goals` and goals stored on sub-plans. `BlockSchema` keeps `migrateBlock` too; running it twice is safe.
- **Request cycles.** The store refuses to add a request that would close a cycle, and refuses to redo one. Making an item a product can still create a cycle (after confirmation). The solver then treats every connection in that cycle as take existing, with `requestIgnored: 'request-loop'`, as `pull-loop` works today.
- **Visible labels.** "Add goal", "Goal target rate", the "Target: …" tooltip and "Remove goal" stay as they are. New text (dialog, menus) uses the new words.

### Files to change

#### Data: `src/data/schema.ts` and `src/data/types.ts`

**`ProductSchema`** (introduced in 1a with a required `extraRate`) makes `extraRate` optional:
```ts
export const ProductSchema = z.object({
  id: z.string(),
  itemId: z.string(),
  /** Extra output, items/min, kept beyond what other blocks request; absent = only what is requested. */
  extraRate: z.preprocess(v => (v === 0 ? undefined : v), z.number().positive().optional()),
}).transform(p => { if (p.extraRate === undefined) delete p.extraRate; return p })
```
- A saved `0` loads as an absent key, mirroring `maxRate`.

**`BlockConnectionSchema`.** Delete the `pull` field and its line in the transform. `z.object` drops unknown keys, so `pull` disappears from any loaded plan.

**New `migrateLegacyPulls(raw: unknown): unknown`.** Not exported.
1. If the input is not an object with a `blocks` array, return it unchanged.
2. Map every block through `migrateBlock`.
3. Index the raw blocks by string id; the first one wins.
4. For each consumer `b`, keep a `seen` set of `from\0item` keys. For each connection object `c` with string `itemId` and `fromBlockId`: work out whether it is a duplicate, then add its key to `seen`. Skip it unless `c.pull === true`. Also skip it when the source is missing, the source is `b` itself, it is a duplicate, the source already has a product for the item (including one added earlier in this pass), or the source receives the item. "Receives" means the source has a connection for that item from an existing block other than itself. Otherwise append `{ id: crypto.randomUUID(), itemId }` to the source's `products`.
5. Return `{ ...data, blocks }`. `pull` keys are left for Zod to strip.

**`AppStateSchema`.** `z.preprocess(raw => migrateLegacyPulls(assignMissingBlockColors(raw)), …)`.

**`types.ts`:**
- Add `ConnectionKind = 'request' | 'take'`, and `RequestIgnoredReason = 'request-loop' | 'source-receives' | 'duplicate'`.
- `ConnectionFlow` gains `kind: ConnectionKind` (required), and its fields become `requested?: number` (present iff `kind === 'request'`) and `requestIgnored?: RequestIgnoredReason` (present iff the item is a product of the source but the request is not applied). These replace `demand` and `pullIgnored`; remove `PullIgnoredReason`.

#### Solver: `src/solver/blockGraph.ts`
- `export function hasProduct(block: Block, itemId: string): boolean`. This is the one definition of "is a product"; the solver and store import it from here, which avoids a circular import with `index.ts`.
- `closesPullLoop` → `export function closesRequestLoop(blocks, fromBlockId, toBlockId): boolean`. Its edges are connections whose source exists, is not the block itself, and has the item as a product (whether or not the solver later ignores them). The rest of the logic is unchanged.

#### Solver: `src/solver/index.ts`
- `productGoals(products: Product[], requested?: Map<string, number>): SolverGoal[]` replaces `mergePulledGoals`:
  - each product's rate is `(extraRate ?? 0)`, plus the requested amount for the *first* product of its item when that amount is above `FLOW_TOLERANCE`;
  - products whose rate is `<= 0` are dropped;
  - each goal's id is the product's id.
- `flattenBlock(block)` sets `goals: productGoals(block.products)`.
- Delete `producesItem` and `pullIgnoredReason`. Keep `receivesItem`.
- `type RequestInfo = { requested: number } | { ignored: RequestIgnoredReason }`.
- `interface RequestPlan { goals: Map<string, SolverGoal[]>; info: Map<string, RequestInfo> }`. `goals` holds an entry only for blocks that received requests.
- `computePullDemands` → `computeRequests(blocks, gameData, selfConnectionIds, cache?): RequestPlan`, with the same structure as today:
  - a connection is a candidate when its source exists, it is not a self-connection, and `hasProduct(source, c.itemId)`;
  - a duplicate gets `{ ignored: 'duplicate' }`;
  - `receivesItem(source, …)` gives `{ ignored: 'source-receives' }`;
  - members of a cycle get `{ ignored: 'request-loop' }`;
  - effective goals are `productGoals(block.products, requested.get(block.id))`, set in `goals` only when the block has requested amounts;
  - the probe and the shares are unchanged.
- `StepContext`: `pull` → `requests: Map<string, RequestInfo>`; add `goals: Map<string, SolverGoal[]>`. `solveStep` builds `plan = { ...flattenBlock(block), goals: ctx.goals.get(block.id) ?? flattenBlock(block).goals }`. Remove `effective()` from `solveAll`.
- In `solveStep`, replace `'demand' in info` with `'requested' in info`. Each flow gets `kind: info && 'requested' in info ? 'request' : 'take'`, plus `requested` or `requestIgnored`. `ignoredFlow` sets `kind: 'take'`.
- Rewrite the `pending` comment (above `solveStep` and in `solveAll`): it holds the requested amounts not yet served; it shields them from take-existing consumers of a product and from requesters drawing beyond their share; each request gives its own share back when served.
- The `solveAll` doc comment should use request and take vocabulary.
- A block whose products have no extra and no requests gets the empty result (the existing "solve only when `goals.length > 0 && nodes.length > 0`" rule already gives this once zero-rate goals are dropped).

#### Store: `src/store/connections.ts`
- Delete `isGoalItem`; `canConnect` uses `hasProduct(target, itemId)`.
- `sourceCandidates` → `takeCandidates(...)`, which returns `TakeCandidate[]`. Same as today, but it filters out blocks that have the item as a product.
- `export type RequestBlocker = 'request-loop' | 'source-receives'`.
- `export function requestBlocker(blocks, target, itemId, fromBlockId): RequestBlocker | undefined`. It returns undefined when the source is missing or the item is not one of its products. It returns `'source-receives'` when `receivesItem(source, …)`, and `'request-loop'` when `closesRequestLoop(blocks, fromBlockId, target.id)`.
- `export function requestBlockerTitle(reason, sourceName, targetName, itemName): string`:
  - `'request-loop'`: `"<source> already requests from <target>, directly or through other blocks"`
  - `'source-receives'`: `"<source> receives <item> itself"`
- `export interface RequestCandidate { block: Block; closesLoop: boolean; blocker?: RequestBlocker }`.
- `export function requestCandidates(blocks, targetId, itemId): RequestCandidate[]`: blocks with `canConnect` and `hasProduct(b, itemId)`, in plan order, whatever they offer now.
- `ItemCandidate` gains `request: boolean; blocker?: RequestBlocker`, filled in by `connectableItems`.
- Delete `pullBlocker`, `pullBlockerTitle`, `pullCandidates` and `connectionPullBlocker`.
- `export interface ProductChangeEffect { connectionId: string; consumerId: string; consumerName: string; rate: number | undefined; closesRequestLoop: boolean }`.
- `export function productChangeEffects(blocks, blockId, itemId, change: 'add' | 'remove', flows): ProductChangeEffect[]`:
  - It returns `[]` when the kind would not change: on `'add'`, the block already has a product for the item; on `'remove'`, another product of the same item remains.
  - Otherwise it lists every connection on other blocks with that `fromBlockId` and `itemId`, in plan and then connection order.
  - `rate` is the matching flow's `rate`.
  - `closesRequestLoop` is computed only on `'add'`, as `closesRequestLoop(blocksWithProductAdded, blockId, consumerId)`.

#### Store: `src/store/blockStore.ts`
- `updateProductExtra(productId: string, extraRate: number | undefined)`, which does nothing for an unknown id or a value that is not a finite number above 0 (undefined is allowed), and deletes the key when given undefined. Undo and redo of product actions have no guards and change only that block.
- `addInputConnection(itemId, fromBlockId, toBlockId?)`. It refuses when `hasProduct(source, itemId) && closesRequestLoop(...)`, and `canApply` runs the same check.
- Delete `setConnectionPull` and `withPull`.

#### Store: `src/store/persistence.ts`
- `findUnknownPlanIds` loops over `block.products` (which includes products without extra), not `flattenBlock(block).goals`.

#### UI: `src/components/factory/summarySegments.ts`
- `GoalInfo` → `ProductInfo { id; extra: number | undefined; required: number; actual: number | undefined; short: boolean; tickAt: number | null }`.
- `SlotModel`:
  - `goal` → `product`;
  - remove `pulledOnly` and `pulledShort`;
  - add `empty?: true` ("products only: no extra output, nothing requested, nothing made").
- `Segment.pulled` → `requested`, set when `flow.kind === 'request'`. The `segmentTitle` suffix becomes `' — requested'`.
- `productSlot(product: Product, actualPerMin, exports, unit, requestedPerMin = 0)`:
  - `required = (extraRate ?? 0) + requested`;
  - it returns the **empty** model (rate 0, scale 0, no segments, status null, `empty: true`, `tickAt: null`) when `required <= FLOW_TOLERANCE`, there are no exports, and `!((actual ?? 0) > FLOW_TOLERANCE)`;
  - otherwise it behaves as today, except that `short` and `tickAt` need `required > FLOW_TOLERANCE`, and the rate is `Math.max(0, actual)` when `required <= FLOW_TOLERANCE`.
- Delete `pulledSlot`.

#### UI: `src/components/factory/SummarySlot.tsx`
- `slot.goal` → `slot.product`.
- When `slot.empty`, show `—` instead of the rate, and set `aria-label` to `"<item>, nothing requested yet"`.

#### UI: `src/components/factory/FactorySummary.tsx`
- Rename `GoalRates` to `ProductRates`. Its target button shows `—` when there is no extra, with the title `Target: none — click to edit`; the `RateInput` then starts empty. Keep the aria label "Goal target rate".
- `requestedPerMin` is built from the flows leaving the block that have `requested`.
- Delete all pulled-only, push-export and `pulledSlot` code. Byproducts are the net balance of items that are not products, minus their exports.
- Product slots: `products.map(...)`, with the requested amount given to the first product of each item.
- `connectable` uses `hasProduct`.
- The connection chip menu holds only "Remove connection".
- Add a pending-change state `{ change: 'add'; product; effects } | { change: 'remove'; productId; itemName; effects } | null` and two helpers:
  - `requestAddProduct(itemId, extraRate?)`, which `handleAddGoal` now calls;
  - `requestRemoveProduct(productId)`, which the strip action and the right-click menu both call.

  Each computes `productChangeEffects` and either applies the change at once (no effects) or renders `ProductChangeDialog`.

#### UI: new `src/components/factory/ProductChangeDialog.tsx`
- Pure text helpers, exported:
  - `productChangeTitle(change, itemName, blockName)`: `"Make <item> a product of <block>?"` / `"Remove <item> from <block>'s products?"`. The possessive adds only `'` when the name ends in `s`.
  - `productChangeLine(change, effect, itemName, rateText)`:
    - add: `"<consumer> takes existing <item> from this block (<rate>). It will request it instead, so its needs will drive how much this block makes."`
    - add, closing a cycle: `"<consumer> takes existing <item> from this block (<rate>). It would request it instead, but that closes a cycle of requests: every request in the cycle will only take what is left over."`
    - remove: `"<consumer> requests <item> from this block (<rate>). It will only take what is left over and no longer drive this block."`
    - `rate` is `fmtRate(r / 60, unit)` followed by `/m` or `/s`, or `—` when there is no flow.
- The component follows the delete dialog in `PlanMenu.tsx:99-116`: a `Modal` with `className="p-4 w-[28rem] text-sm"`, an `h2`, a `ul` of `li[data-testid="product-change-effect"]`, and **Cancel** plus an action button ("Make it a product" / "Remove product"). Wrap the content in `data-testid="product-change-confirm"`.

#### UI: `src/components/factory/ConnectionMenu.tsx`
- The Request section comes first. Its header is `"Request <item> from"`, shown only when there are candidates. Each entry has `data-kind="request"`, shows `↻` and `data-closes-loop` like the take entries, and is `disabled` with `requestBlockerTitle` as its title when blocked; otherwise its title is `"<block> makes what this block needs"`.
- Then `"Take existing <item> from"`, built from `takeCandidates`. Entries have `data-kind="take"` and show the offered rate.
- When both lists are empty, keep "No other block has this item to spare".
- Remove the Pull section and every `data-pull`.

#### UI: `src/components/factory/BlockGraph.tsx`
- `ConnectionChip`:
  - drop the `⇠` button, `onTogglePull`, and the `gameData` and `blocks` props;
  - add `data-kind={flow?.kind}` and `data-request-ignored={flow?.requestIgnored}`;
  - title suffixes: `" — requested: <source> makes N for <target>"`, or `" — taken as existing: "` followed by the reason from `REQUEST_IGNORED_TITLE`:
    - `request-loop`: "requests form a cycle, so this takes what is left over"
    - `source-receives`: "the source receives this item itself, so this takes what is left over"
    - `duplicate`: "an earlier connection already takes this item from the same source"
- Summary chip: drop the pulled count, `data-pull`, `⇠` and the pulled part of `edgeSummaryTitle`.
- `ConnectItemMenu`: a candidate with a `blocker` is a `disabled` menu item titled with `requestBlockerTitle`. Connect mode otherwise stays as it is; zero-offer sources are phase 3.

#### UI: other components
- `ItemPicker.tsx`:
  - `parseAmount(): number | undefined | null`: an empty or whitespace field gives `undefined` (no extra), a finite value above 0 gives that number, anything else gives `null` (nothing happens);
  - `onSelect: (id: string, rate: number | undefined) => void` at `:433` and `:673`;
  - the default stays `'60'`;
  - add `placeholder="—"`.

### Tests

#### Unit tests, in order

1. **`loader.test.ts`**
   - Remove the `pull` describe (`:519-545`).
   - New describe `'parseAppState — products'` (the 1a migration tests stay): a product without extra round-trips without the key; `extraRate: 0` loads as an absent key; `extraRate: -1` throws `AppStateLoadError`.
   - New describe `'parseAppState — legacy pull connections'`. Blocks S (source), T (consumer) and Z; every test also asserts there is no `pull` key:
     - pull to a goal of S: S's products are unchanged;
     - pull with no goal: S gains exactly one `{itemId}` without `extraRate`;
     - pull where S's goal is stored only on `rootPlan.goals`: S still has one product (with the hoisted extra), nothing added. **This is the ordering-risk case.**
     - S receives the item from Z: nothing added;
     - S "receives" the item from a missing block: the product *is* added;
     - T has a push and then a pull for the same `(S, item)`: the pull is a duplicate, nothing added;
     - two consumers pull the same item: one product added;
     - pulls to self or to a missing source: nothing added, no throw;
     - `pull: false`: key dropped, nothing added;
     - push to a goal item: products and connection unchanged;
     - the old "fixture saved before pull existed" test asserts Plates has `products`.
2. **`persistence.test.ts`.** `findUnknownPlanIds` lists the item of a product that has no extra.
3. **`blockGraph.test.ts`.**
   - `hasProduct` is true for a product with or without extra.
   - Replace `closesPullLoop` (`:36-63`) with `closesRequestLoop`:
     - true when the source already requests from the target, directly or through C;
     - false when the back connection's item is not a product of its source (take existing);
     - missing sources and self-connections never count.
4. **`connections.test.ts`.**
   - Replace `isGoalItem`, `pullCandidates` and `pullBlocker` with:
     - `takeCandidates`: excludes a block that has the item as a product, even with leftover;
     - `requestCandidates`: lists a block whose product offers 0; excludes already-connected blocks and the target itself; shows `blocker: 'source-receives'` and `'request-loop'`;
     - exact `requestBlockerTitle` strings;
     - `connectableItems` flags `request` and `blocker`.
   - `productChangeEffects`, one `it` each:
     - add with take connections lists each with its flow rate;
     - add when the block already has a product of the item gives `[]`;
     - add ignores the block's own connections and other items;
     - add sets `closesRequestLoop` when the source already requests from the consumer;
     - remove lists the requests;
     - remove gives `[]` when a second product of the item remains;
     - `rate` is undefined without a flow.
5. **`blockStore.test.ts`.** Replace `'pull connections'` (`:570-636`) with `'products'` additions:
   - `updateProductExtra` sets, clears (`'extraRate' in` false), and ignores 0, -1, NaN and unknown ids without adding a history entry; undo restores an absent extra;
   - **removing and then undoing a product on S leaves T's object identical (`toBe`)**;
   - `addInputConnection` refuses a request that closes a request cycle, allows the same pair when the item is not a product, and redo drops a request that has since become a cycle.
6. **`index.test.ts`.**
   - New `flattenBlock` test: products `[{p1 plate 60}, {p2 gear}]` give goals `[{id:'p1', itemId:'plate', rate:60}]`.
   - **Keep `describe('solveAll')` on take existing.** Add `twin: recipe('twin',1,[],[product('slag',1),product('plate',1)])` to `connectionGameData`. In that describe, `plateGoal(n)` returns `[{id:'gp', itemId:'slag', extraRate:n}]`, and every source node `planNode('p','plate')` becomes `planNode('p','twin')`; this includes the cache scenarios and the `machineId:'ghost'` edit. Leave `'does not feed a goal item'` unchanged. No expected value changes.
   - **Loops.** In `loopGameData`, `smelt` also makes `heat`, `sort` also makes `dust`, and `mine` also makes `rock` (one each per run). Metals, the `Extra` block and the "settles in one round" block get a `heat` product, Ores gets `dust`, Mine gets `rock`, and Sciences keeps `science`. Product rates equal the old goal rates, and no expected value changes.
   - Replace `'solveAll — pull connections'` (`:876-1066`) with `'solveAll — requests'`, using `prod(itemId, extra?)`. Each item lists its assertions:
     1. product without extra: A throughput 50; `kind 'request'`, `requested` 50, rate 50, `ok`.
     2. extra 10 plus a request: throughput 60; net minus rate equals 10.
     3. `maxRate` 30: `requested` 30, `capped`, `limited`, B imports 20.
     4. `maxRate` 100: `requested` 50, not capped, `ok`.
     5. take existing (A with `slag` 40 and `twin`; B needs 50): `kind 'take'`, no `requested` or `requestIgnored`, rate 40, `limited`, A throughput still 40.
     6. two requesters: throughput 70, flows 50 and 20.
     7. chain: `cc.requested` 10, `cb.requested` 20, throughputs B 10 and A 20.
     8. locked consumer with a pinned recipe: `requested` 30.
     9. A has a product `plate` but only an `ingot` node: `requested` 50, rate 0, `limited`; A has `no-recipe` for plate and is short 50.
     10. a product with no extra and no request gives the empty result; with a cache, `cache.has('A')` is false.
     11. products `[machine (no extra, no recipe), plate extra 10]`: no `no-recipe` warning for machine, no machine in `unsatisfied`, throughput 10.
     12. **`pending`:** blocks `[A1(product plate, ingot node), A2(product plate), B(gear 25, b1 from A1, b2 from A2), C(gear 10, c1 from A2)]` give `b2.rate` 0, `c1.rate` 20, C imports 0 plate, B imports 50.
     13. `source-receives`: `kind 'take'`, `requestIgnored 'source-receives'`, A has no nodes.
     14. duplicate: `c2.requestIgnored` `'duplicate'`, status `unused`.
     15. cycle: both connections `'request-loop'`, `kind 'take'`.
     16. a loop of blocks that closes through a take (B with product `machine` and nodes gear and machine; A takes `gear`): one loop, converged, `c1` a request of 50, `cg` a take.
     17. the cache test, adapted.
7. **`summarySegments.test.ts`.**
   - Rename the existing `productSlot` and pulled tests to extra and requested.
   - New cases:
     - short against extra plus requested;
     - no extra, 30 requested, actual 20: short 10;
     - no extra, nothing requested, actual -15: empty, status null, no segments;
     - before the first solve: empty;
     - an ingredient source segment has `requested` iff `kind === 'request'`, with the title suffix ` — requested`.
   - Delete the `pulledSlot` tests.
8. **`FactorySummary.test.tsx`.**
   - Add `kind` to every constructed flow.
   - Replace `'pull'` (`:723-905`) with `'requests'`:
     - the requested amount sits on the product slot and plate is not a byproduct;
     - a product without extra shows `—` with the label "Iron plate, nothing requested yet";
     - the source segment title says requested;
     - the chip menu holds only "Remove connection";
     - the menu lists a product block under Request with nothing left over, leftovers under Take with their rate, and a disabled request with its title; clicking a request adds a connection without `pull`;
     - removing a requested product shows the dialog with the exact line; Cancel keeps the product, confirming removes it;
     - removing an unrequested product does not ask;
     - adding through the picker an item another block takes shows "Make Iron plate a product of …?";
     - clearing the amount adds a product without `extraRate`.
9. **`BlockGraph.test.tsx`.**
   - Replace `'pull'` (`:430-492`) and `:602-618` with:
     - request chip with `data-kind` and title;
     - take chip;
     - an ignored request with `data-request-ignored="request-loop"` and its reason;
     - no `graph-edge-pull` anywhere;
     - the summary chip has no `⇠` and no "pulled";
     - a connect-mode item whose request would close a cycle is disabled, with its title.
10. **Other test files.**
    - `ItemPicker.test.tsx`: a cleared amount calls `onSelect('iron-plate', undefined)`; `0` calls nothing.

#### End-to-end tests

- **Rename `e2e/block-pull.spec.ts` to `e2e/block-requests.spec.ts`** with `git mv`, then rewrite it. The first four tests use `block-connection.json`; the fifth uses the changed `block-loop.json`.
  1. Request flow:
     - the Request section lists Plates and there are no take entries;
     - the source segment says requested; the entry is 30.0; no import;
     - Plates shows export 30.0 and `Actual: 90.0`;
     - with the target at 20, Gears still gets 30 and is not limited;
     - the export has no `pull`; Plates has `products[0]` with `extraRate: 20` and no `goals`.
  2. Remove with confirmation:
     - heading "Remove Iron plate from Plates' products?";
     - the line ends "(30.0/m). It will only take what is left over and no longer drive this block.";
     - Cancel keeps the slot; confirming removes it;
     - Gears' plate slot is `limited` with import 30.0.
  3. Add with confirmation, after test 2's steps:
     - pick Iron plate, amount 60;
     - "Make Iron plate a product of Plates?" with the take line;
     - "Make it a product" gives Gears 30.0 from Plates again.
  4. Product without extra: clear the amount, add Iron rod on Plates; the slot is named "Iron rod, nothing requested yet" and shows `—`.
  5. Cycle wording:
     - Gears requests plate, and Plates takes ingot (marked `↻`);
     - adding Iron ingot as a product on Gears shows a line containing "closes a cycle of requests";
     - after confirming, the graph has 2 chips with `data-request-ignored="request-loop"`.
- **Other specs:**
  - `block-connection.spec.ts`: `:not([data-pull])` → `[data-kind="request"]`; drop the "lower goal to 20 → limited" step (`:54-62`); update the doc comment.
  - `ingredients-pane.spec.ts` (`:79`, `:87`): `[data-kind="request"]`.
  - `block-loop.spec.ts`:
    - the plates connection uses `[data-kind="request"]`;
    - the closing connection uses `[data-kind="take"]`;
    - the ingot entry expects `120.0`.
  - `plan-import.spec.ts:~135`: also expect `import-unknown-ids` to contain `nope-item`. This is the check that legacy `goals` migrate.
- **Fixtures.** Keep the old shape (`goals`, `rate`) on purpose: `loadPlan.ts` seeds the legacy key, so every fixture exercises the migration. Change only `e2e/fixtures/block-loop.json`: remove Gears' goal `g2` (iron ingot) and add `"pinnedRate": 60` to node `n2` (60 runs/min × 2 = 120 ingots/min, all of it byproduct).
- **Synthetic case: not recommended.** The synthetic cases are single-block LP ground truths, and requests only exist between blocks.

### Docs

- **`spec/data-model.md`**
  - `products: Product[]` with optional `extraRate`, no `pull`.
  - Migration paragraph: the `migrateLegacyPulls` rules.
  - Connections: the kind is derived (link `solver.md#requests`); the store refuses a request that closes a cycle when adding and on redo; `extraRate` 0 loads as an absent key.
  - Flows section (`:685-709`): `kind`, `requested`, `requestIgnored`, and `RequestIgnoredReason`.
- **`spec/solver.md`**
  - `:20` and `:27`: the request pass and product goals.
  - `:42`: a goal is an item the LP must make, built from products as `extraRate` plus the requested amount.
  - `:136-160`: kinds, and "a block with nothing to make".
  - Rename the section `### Pull connections` to `### Requests`, rewritten as the request pass, `pending` (requests only, with both cases it protects), flow fields and loops. Update every `#pull-connections` link (`solver.md`, `ui.md` ×3, `data-model.md`).
- **`spec/ui.md`**
  - `:27`: empty result.
  - `:176-205`: chips with `data-kind` and titles, no toggle, summary chip without `⇠`; connect-mode items blocked with their title.
  - `:570-579`: product slots with extra, `—` and "nothing requested yet"; no pulled-only slots; a confirmation subsection describing the dialog texts.
  - `:589-593`: the Request and Take existing sections, the chip menu with only Remove, the ` — requested` suffix.
  - `:745-770`: an empty amount adds a product without extra.
- **README**
  - `:15-17`: optional extra output.
  - `:40`: rewrite the pull paragraph for Request and Take existing, and mention the confirmation.
  - `:44`: drop "pull".
  - `:60`: products are the hard constraints.
  - `:126`: add `ProductChangeDialog.tsx`.
  - `:141`: `block-requests.spec.ts`.
- **`initiatives/archive/block-requests/plan.md`**: append to phase 1: "Shipped."; in phase 2, a note that `pending` currently makes the requester served first absorb a shortfall (the Shortfall rule in this doc is implemented in phase 2).
- **`initiatives/backlog.md`**: the Requests item notes phases 1 shipped and 2 to 6 remain.
- **PR description (no changelog exists).** Release note: a plain connection to an item its source has as a goal is now a request, so that source makes the goal plus the demand. A former pull from a block that could not make the item now shows as short in that block.

### Out of scope

The dimmed or dashed empty-slot styling, the strip header `extra + requested → total`, the shortfall split, "+ Extra output" / "Remove extra", "Make it a product" in Byproducts and the label renames (phase 2). "Make in a new block…", the graph's `existing` tag and connect mode for sources with nothing on offer (phase 3). `connectionsFirstItems` and "Use connections first" (phase 4). Solving request cycles (phase 5). Subtracting take supply from requests (phase 6).

### Verification

`npm run lint`, `npm run lint:docs`, `npm run test:unit`, `npm run test:e2e`, `npm run build`. Also run `grep -rnE "\bpull\b|goals|ProductionGoal|demand|pullIgnored" src e2e`. The only hits left should be legacy shapes in migration tests and fixtures, and the LP-internal `goals`.

### Riskiest parts for review

1. **When the migration runs and whether it is safe to run twice.** `migrateLegacyPulls` must see products hoisted from sub-plans; covered by loader test 1.
2. **The fixture rewrites in `solveAll` and `loops`.** They must keep the old numbers. Any changed expected value means a connection accidentally became a request.
3. **`pending` with requests** (new test 12) and the `capped` logic for requests.
4. **`productSlot` edge cases.** A product that the block consumes but has no extra must not show as short.
5. **Every connection in a request cycle is ignored**, which the confirmation wording promises.
6. **The `block-loop.json` pin values.**
