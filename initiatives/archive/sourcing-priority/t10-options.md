# T10 options: where the Comes from control lives for an item with no Ingredients slot

Working notes for [T10 in phase-1.md](phase-1.md).

**Decided on 2026-11-10, after the owner tried a prototype:** the review's recommendation, A + F + G wired as "always the popover", with two changes. The marker is no longer clickable (on a laptop the right-click on the ingredient chip (G) felt natural and the marker click did not), and G is the main entry with **Change…** as the visible and touch fallback. The decision and the build list are in T10 of [phase-1.md](phase-1.md); this file keeps the options and the review behind it. The "Leaning" and "Next step" sections below are superseded.

## What the player is trying to do

They are looking at a row and an ingredient looks wrong ("why is it making its own gears, I want those received"). The item is an intermediate with no slot. Today the only way in is the side panel's **Change…**. A chip with no rule has no marker to click, and the T7 rule list only holds rules that already exist.

The constraint for every option: the Ingredients pane's membership does not grow with the number of intermediates.

## Options

### A. Popover where the player already is

The same **Comes from** control (`ComesFrom.tsx`) opens in a popover anchored to whatever was clicked: the side panel's **Change…**, a marker, or a row of the T7 list.

- Good: no slot appears or disappears and the pane does not change. Below `xl` the drawer can stay open, because the popover floats over it. The popover can say "applies to every row of this block", which was T5's scope complaint.
- Cost: the control lives in two places, the strip for slot items and the popover for the rest. The fix is to open the popover for every item and keep the strip only for the slot's own details.

### B. "Add a rule…" in the T7 rule list

An entry at the bottom of the Source rules popover opens an item search, then the control.

- Good: suits "I know which item I want" and scales to 100+ intermediates through search.
- Cost: the wrong starting point when the player is looking at a row. The Source rules button is hidden when N is 0, so the entry needs another home. An add-on to A, not an answer on its own.

### C. Ghost marker on ingredient chips

On hover or focus, an ingredient chip without a rule shows a hollow dot where the filled marker goes. Clicking it opens the popover from A.

- Good: the entry is on the thing the player is looking at. Self-explanatory: hollow means "no rule", filled means "rule".
- Cost: no hover on touch, so the side panel entry stays as the fallback. Adds visual noise on dense rows.

### D. Keep the temporary slot, make it deliberate

The stopgap becomes a dashed "No rule yet" slot with a close button. It stays until dismissed or a rule is set, instead of vanishing on any deselect.

- Good: the smallest change, and the strip UI is reused as is.
- Cost: the pane jumps and the slot can sit off-screen in a long pane. It is hidden when the summary is collapsed, and a drawer-closing flow is still needed below `xl`. It is still a control in a pane the item does not belong to.

### E. Inline in the side panel

**Change…** expands the control in place, as an accordion under the ingredient.

- Good: the most direct path from a row, with no popover layering.
- Cost: only works from the panel, and undoes T5's "the panel is read-only because the rule is the block's, not the row's". Does not help the marker or the T7 list.

## Leaning

A as the core, with C as the discoverable trigger and B as a cheap add-on. D is the fallback if popovers turn out awkward on touch. E is dropped, since it reopens T5's decision.

## Next step

One clickable prototype of a block's table, side panel and Ingredients pane, with a switch between A+C, A+B, D and E, so each can be tried on the same scenario.

## Review (second session, 2026-11-10)

A second reading of the options above against the code. It adds two facts the options do not use, a verdict on each option, and two more options (F and G).

### Two facts that change the problem

**1. An intermediate that gets a rule almost always gets a slot.** A slot exists for an item that is imported, connected or locked. On an item that is only an intermediate:

| Rule set | What happens to the item |
| --- | --- |
| Import off | It is locked, so it has a slot from then on. |
| Only what's already made | The block stops running a recipe just for it and imports or receives the rest (`spec/solver.md`, "Byproducts first"), so it has a slot. The exception: rows that run anyway already cover all of it. |
| Receive it first | No effect until there is a connection (`no-connection` in `sourceRules`); with one, the item is connected and has a slot. |

So "an item with a rule and no slot" is close to an empty state: a *Receive it first* with no connection (greyed, removable from the rule list) and the exception above. T10 is about the moment of entry, not about a place for these items to live. That argues against anything that gives them a lasting home (D, B) and for something that opens, sets the rule and goes away.

**2. The scenario at the top is not solved by the control alone.** "I want those gears received" needs two things: a connection for gears and *Receive it first*. With the default preset a connection brings nothing, because the block makes all it needs; with the preset and no connection the rule has no effect. The connection is made by **Receive from…**, which is an action of the slot's strip and of the slot's right-click menu (`FactorySummary.tsx`, `ConnectionMenu`), or from the block graph. Today's temporary slot offers it, because it is a slot. A popover that holds only `ComesFrom` loses it: the player picks *Receive it first*, reads "No connection for gear." with a **Remove** button, and has no way forward from there. No option above mentions this.

### Verdict on each option

| Option | Verdict | Why |
| --- | --- | --- |
| A. Popover | Keep, as the core. Reject its "fix". | `ComesFrom` takes an item id and reads the stores, so a second host costs little. The fix ("open the popover for every item and keep the strip only for the slot's own details") undoes T4 and the plan's decision that the Ingredients slot owns the rule, and phase 2's **Custom order…** needs the strip's room. One component in two hosts is the lesser cost. Incomplete without F. |
| B. "Add a rule…" in the rule list | Drop from T10. | Nobody sets a rule on an item they are not looking at, and by fact 1 the list would mostly be used to add rules that have no effect. The button is hidden at N = 0, so the entry needs a second home. If phase 2 shows a need, it can come back then. |
| C. Ghost marker | Reject. | The marker is a button in the tab order, so a ghost on every ingredient chip either adds a tab stop per chip or is pointer-only. It is a 14px target on a chip whose click already opens the producer picker. And it walks back the plan's decision that the marker is rare and means "a rule with an effect". G gives the same entry without drawing anything. |
| D. Deliberate temporary slot | Reject, also as the fallback. | A slot that reads "need 0" in a pane about what the block takes from outside says something false, and by fact 1 it would be dismissed or replaced by a real slot within seconds. The Source rules popover already ships as a portalled dialog, so "popovers turn out awkward" is not an open risk. |
| E. Inline in the side panel | Reject, but the reason given is too easy. | A popover anchored to the panel's **Change…** is E in a floating frame. What keeps T5's decision is not the frame but the popover saying whose rule it is. So A must carry a header with the item and its scope ("Gear: for every row of this block"); without it A is E. |

### F. The popover offers the connection

The `no-connection` line of `ComesFrom` gains a **Receive from…** button beside **Remove**, which opens `ConnectionMenu` for the item. It goes in the component, so the strip gets it too.

- Good: closes the dead end of fact 2 in both hosts, and the wanted outcome takes two clicks in one place. Once the connection exists the item has a slot, and the popover can close and hand over to it.
- Cost: `ConnectionMenu` is owned by `FactorySummary` today and has to be openable from elsewhere (a `uiStore` request, or lifting its state). A menu opened from a popover needs care with dismissal: Escape and outside clicks must close only the menu.

### G. "Comes from…" in the right-click menu of an ingredient chip

Product and byproduct chips already have an item menu (`openItemMenu` in `RecipeRow.tsx`); ingredient chips have no handler of their own. Right-clicking an ingredient chip opens a menu with **Comes from…**, which opens the popover of A anchored to the chip.

- Good: an entry on the thing the player is looking at, with nothing drawn and no tab stop. It is where the rule was set before T4, so returning players look there.
- Cost: right-click is not discoverable and has no touch equivalent, so the side panel's **Change…** stays the visible path. Check what a right-click on an ingredient chip bubbles to today before adding the handler.

### One question the options leave open: what the triggers do for an item that has a slot

**Change…**, the marker and a rule of the list all call `openIngredientSlot` today. With A there are two ways to wire them:

1. **Always the popover.** Every remote trigger opens the popover in place, for any item, with a "Show in Ingredients" link when the item has a slot. One behaviour to learn, the drawer stays open below `xl` for every item, and the temporary slot, the drawer-closing code and most of the request handling in `FactorySummary` go. It changes what T5, T6 and T7 shipped (their specs and e2e say "opens the slot") and amends two rows of the plan ("a click selects the Ingredients slot", "**Change…** link to the slot").
2. **The popover only when there is no slot.** Smallest diff, but the same button jumps to the pane for iron plate and opens a popover for gears, and the player cannot tell which beforehand.

Recommended: 1. The inconsistency of 2 is the kind of thing this initiative exists to remove.

A rule of the Source rules list is a special case, since it would open a popover from a popover. Expanding the control inside the row avoids the nesting.

### Recommendation

A + F + G, wired as "always the popover":

- The popover holds a header with the item and its scope, `ComesFrom` (with F), and "Show in Ingredients" when the item has a slot.
- Triggers: the side panel's **Change…**, the marker, the right-click menu of an ingredient chip (G), a row of the rule list (expanded in the row).
- The strip of a selected Ingredients slot keeps its `ComesFrom` as it is.
- The temporary slot is removed.

Implementation risks to check first: the tooltips of `ComesFrom` open upwards with absolute positioning, which a popover near the top of the viewport can clip; the side panel is at the right edge, so the popover has to flip to the left.

### On the next step

A four-way prototype is more than the decision needs: D and E fall to argument, and C to the tab-order problem. If a prototype is built, compare today's temporary slot with A + F + G on two scenarios only: "receive these gears from another block" starting from a row (fact 2), and the same below `xl` with the panel as a drawer.
