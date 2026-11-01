# Manual checklist: the mod in Factorio 2.0.77

CI never starts the game, so everything that touches the Factorio API (`control.lua`, `gui.lua`, `cursor.lua`, `data.lua`, `settings.lua`, the locale file) is checked here, once per release and after any change to those files. The pure Lua modules are covered by the busted specs, and `glue_spec.lua` runs the glue against a fake runtime, which catches plain Lua mistakes and nothing about the real API.

Run it on **Factorio 2.0.77 only**, on a **throwaway save** (the mod writes the received snapshot into the save). Tick each item, and write down what was seen in the PR or release notes. A failure of an item marked **(unverified API)** is expected to be a one-line fix in the file named; the list of such calls is in the PR that added them.

## Setup

1. Put the mod in the game's `mods/` folder as `factorio-planner-viewer_0.1.0/`, holding `info.json`, `control.lua`, `data.lua`, `settings.lua`, `graphics/`, `lib/`, `scripts/` and `locale/` (a copy or a symlink of `mod/` is enough, `spec/`, `tools/` and the rest are ignored by the game).
2. Start the game with `--enable-lua-udp 34198` (Steam launch option, or on the command line). Load the throwaway save.
3. The bridge does not exist yet; `mod/tools/udp_sender.py` stands in for it (`python3 mod/tools/udp_sender.py --help`). It sends datagrams to the game's port and prints the mod's answers, which the mod sends to the bridge port 34199.
4. After loading, `factorio-current.log` must show no Lua error from `factorio-planner-viewer`.

## Checks

### The game launched without the flag

1. Quit, start the game **without** `--enable-lua-udp`, load the save.
2. No error, no crash, in the first minute and after opening the window. The top left corner shows the button with the black **P** icon, in a framed strip (the frame other mods' buttons share); the window shows **Disconnected** with the text about the launch option and `factorio-current.log`.
3. Run `python3 mod/tools/udp_sender.py ping`: nothing is answered, the indicator stays Disconnected, and the log has at most one `recv_udp failed` / `send_udp failed` line each if the game raises there.

### Handshake and the indicator

1. With the flag, load the save, open the window: **Disconnected** (no datagram yet).
2. `udp_sender.py ping`: the sender prints `FP01 H ---------------- 0 ----------------` within about a second, and the indicator clears within a poll (the window is rebuilt, no longer showing Disconnected). The window says no plan has arrived yet.
3. Leave the sender silent for 18 s of game time (1,080 ticks at speed 1, which is 18 s of wall clock): **Disconnected** returns. Then set `/c game.speed = 8` and send a ping. At speed 8 the game runs 480 ticks per wall-clock second and the mod scales the threshold to 1,080 x 8 = 8,640 ticks, so **Disconnected** must return after about 18 s of wall clock again (time it). It must not come back after about 2.3 s of wall clock, which is what an unscaled 1,080-tick threshold would give. Set `/c game.speed = 1` afterwards.
4. `udp_sender.py raw 'FP02 P ----------------'`: **Protocol mismatch** shows, and the answer is a `FP01 H` hello. A normal ping clears it.

### Delivering a snapshot

1. `udp_sender.py send contract/fixtures/small.json`. Expected replies: `FP01 R <id>`, then `FP01 A <id> <n>` (the sender sends probe, chunks and end of window together, and the mod answers once per poll, so the last answer is what counts). With a base-game install the ids of the Seablock fixture are missing, so `<n>` is above 0: see the unknown-id check below.
2. Open the window from the top left button: the drop-down shows **Gears** with its colour swatch; the table below it has one line per recipe: a checkbox, the recipe icon, the machine icon with the machines to place as its number, the products and the ingredients in green, with rates per minute in the tooltips. There is no power anywhere and no column titles.
3. Save and load the game **without** sending anything: the window, once opened, still shows the plan (it is read from the save), with **Disconnected** until the first ping.
4. `udp_sender.py ping 0000000000000000`: the indicator shows **Stale** (the planner's newest differs from the stored id). `udp_sender.py ping <the stored id>` clears it.
5. `udp_sender.py send contract/fixtures/seablock-areas.json --chunk 700`: a multi-chunk delivery. The table shows the sub-factories **Smelting** and **Pumps** as one line each, with a blue icon, no name, and "Separate area" in the tooltip.
6. Pick each block in the drop-down: the table follows and scrolls back to the top. With a plan of more blocks than fit (Seablock), the drop-down's list scrolls. Scroll the table down, then send a new snapshot: the table keeps its scroll position (**unverified**: that the game keeps a scroll position when a pane's children are cleared and added again).
7. Send a snapshot with the same blocks in another order: the window keeps showing the block of the same name, wherever it moved.

### A non-ASCII block name

1. `udp_sender.py send contract/fixtures/unicode.json --chunk 1000` (the cut falls inside multi-byte characters).
2. The log shows no error; the reply is an ack (`FP01 A`), not `FP01 N ... json`.
3. The drop-down lists `Fonderie à fer – été`, `鉄工場 (歯車)` and `Électricité ⚡🏭 « Ünï»` as written (a glyph the game's font lacks may show as a box; that is the font's doing, not the mod's).

### A save load mid-transfer

1. `udp_sender.py send contract/fixtures/seablock-loop.json --chunk 500 --stop-after 3` (a probe and three of the chunks, no end of window).
2. Save, quit to the main menu, load the save, then `udp_sender.py ping`.
3. The `FP01 H` hello shows the previously stored id (or sixteen dashes on a fresh save) and **sixteen dashes as the assembling id**: the reassembly was lost, as designed. Sending the whole snapshot again with the first command, without `--stop-after`, completes it.
4. Check also that the save file did not keep a half snapshot: the window shows the previous plan, not the incomplete one.

### The Esc-menu pause

1. In single-player, open the Esc menu and stay there for more than 30 s. Send `udp_sender.py ping` during it (the datagram waits in the socket).
2. Close the menu: the hello arrives within a second, and **Disconnected** does not appear because of the pause (silence is counted in game ticks).
3. Repeat with `udp_sender.py send contract/fixtures/small.json` sent while paused: the snapshot is stored once the game resumes.

### The unknown-id display

1. With the base game only, send `contract/fixtures/seablock-edge-cases.json` (its ids are Seablock's). The ack carries a count above 0.
2. The window shows a red line "N ids of this plan are not in this game" and a scrolling list `Item: <id>`, `Fluid: ...`, `Recipe: ...`, `Machine: ...`; none is hidden.
3. In the table, a missing recipe, machine or item is a red slot button with no icon, and its tooltip says `<id> (not in this game)`; an id the game has shows its icon, and its tooltip the localised name.
4. Quick hook: a synthetic row (mining, offshore, power) shows its product's icon, with its kind and product in the tooltip; a power row making electricity shows the `utility/electricity_icon` with **Power: Electricity** in the tooltip, and `electricity` is **not** in the missing list.
5. Edit a fixture copy so a `kind: "mining"` row has no `product`: the row's recipe cell is a button with no icon and the tooltip `Unknown (Mining)` in orange; nothing raises.
6. Add a mod that adds a recipe id used by a fixture, restart: the unknown-id count in the next `hello` is lower (it is recomputed on a configuration change).

### The production table

Send `contract/fixtures/seablock-groups.json`. Its ids are Seablock's: with the Kompetenz Seablock mod set every item below applies as written. With the base game only, edit a copy first: `bob-assembling-machine-6` to `assembling-machine-2`, `bob-electric-chemical-mixing-furnace-2` to `electric-furnace`, and keep `bob-solar-panel-large`, which then stands for a building the game lacks.

1. **(unverified API)** Slot buttons, side by side with Factory Planner's compact view: with flib loaded the dark `flib_slot_button_default`, green ingredients (`flib_slot_button_green`), and red for a missing id; without flib the lighter `slot_sized_button` family; if one of those is missing, the plain `slot_button`. All are 36 pixels (`style.size`), inside the `inside_deep_frame` inset.
2. **(unverified API)** The drop-down's items show the block's colour swatch as a coloured square (rich text in drop-down items), and `selected_index` follows the block shown. Its tooltip names the data set.
3. **(unverified API)** The `number` on the machine, beacon and item buttons: the machine count (`1`, `2`, `238`), the beacon total (`8`) and the rates per minute (`120`, `14,267.94` shown in the game's short form). A row the solve did not value (the failed block of `seablock-edge-cases.json`) shows its icons with no number; that block's solver message shows under the drop-down.
4. No electricity anywhere among the item buttons, in the generator rows and the sub-factory headers included. There is no line above the first row: the table starts with the first recipe.
5. The levels: the top level has three lines, the gears row, **Plates and cables** and the pipe row. The **Plates and cables** line has a checkbox, a blue icon of iron plate, no machine and no beacon, its net products and its net ingredients in green; its tooltip names it and says to left click. There is no button next to the drop-down. Click the icon: the window shows the plates row, a line for **Power** and the cables row, the **Up a level** button shows at the right of the drop-down (tooltip: leaving **Plates and cables** for the block's name), and the table is back at the top. Click **Power**'s icon: its two solar rows. **Up a level** twice is back at the top level, and the button is gone. Open a sub-factory, then pick another block in the drop-down: its top level shows.
6. **(unverified API)** The look of the navigation row: the drop-down on the left at its usual width, the button on the right edge, and the row does not change height when the button shows or hides. A long sub-factory name (edit a copy: 80 characters) only shows in tooltips, so no line grows with it.
7. Modules: the furnace row's machine tooltip lists `2 × Speed module`; the cables row's beacon tooltip lists `8 per machine`, `8 in all` and `2 × Speed module`. No module is drawn as a button of its own.
8. **(unverified API)** Tick a row's checkbox: its icons turn grayscale (`style.draw_grayscale_picture`), the green of its ingredients goes, and its buttons stay clickable. Open **Plates and cables** and tick **Power**'s line: both solar rows are ticked and the line shows grayscale icons. Untick one row inside **Power**, go up: the line of **Plates and cables** is not ticked. Tick the **Plates and cables** line at the top level: every row under it, nested ones included, is ticked.
9. Scroll the table down (shrink the game window if the plan fits), tick a checkbox near the bottom: the table keeps its scroll position (**unverified**: that the game keeps it when the table is rebuilt in the same scroll pane).
10. Save, load: the ticks are still there. Send a copy of the fixture with another data-set name (so it has another id; the sender's id is a hash of the bytes): the ticks are kept. Rename a sub-factory in a copy and send it: its rows' ticks are dropped, the others stay, and a window that had that sub-factory open shows the top level. Send the same plan again with a sub-factory open: it stays open.
11. **(unverified API)** Stripes: every other line has the lighter background (`finished_game_table`) across the whole frame, also with few columns; the machine and product columns are left-aligned, not right-aligned; the scroll bar, when there is one, does not cover the last column. The checkbox sits beside the recipe icon, centred on it.

### A building into the cursor

Same fixture and setup as above. Each click is a plain left click on the icon; a right or middle click does nothing (`mouse_button_filter`). The window stays open throughout.

1. **(unverified API)** A crafter: click the gears row's machine. The cursor holds a one-building blueprint in paste mode (`add_to_clipboard`, `activate_paste`), with the recipe set; place it, and the ghost has the gears recipe. Nothing is left in the inventory (no blueprint item), and `factorio-current.log` has no error.
2. **(unverified API)** A crafter with modules: on a copy, give the gears row `"modules": [{"id": "speed-module", "count": 2}]`. The pasted ghost has the recipe and asks for two speed modules (`crafter_modules` inventory).
3. **(unverified API)** A furnace with modules: click the plates row's machine. The pasted ghost has no recipe and two speed modules. Check that the building sits on the grid where the cursor shows it (the blueprint centres odd-sized buildings on a tile, `tile_width` and `tile_height`).
4. **(unverified API)** A beacon: click the cables row's beacon. The pasted ghost is a beacon holding two speed modules (`beacon_modules`).
5. **(unverified API)** A plain building: click a solar row's machine. The cursor holds a ghost of the solar panel item (`cursor_ghost`), not a blueprint.
6. A building that cannot be placed: with the base game, click the `bob-solar-panel-large` row's machine: a short flying text at the cursor, "Cannot put this building in the cursor: this game does not have it", and the cursor is unchanged. **(unverified API)** `create_local_flying_text` with `create_at_cursor`.
7. Hold a stack of items in the cursor with a full inventory, click a machine: the flying text says the cursor cannot be emptied, and the stack stays in the cursor.
8. With a blueprint in paste mode from a click, paste it into the world several times with the window open, open the inventory with E and close it again: the window stays, nothing is logged.

### Settings

1. **Settings > Mod settings > Map**: "Planner bridge port" (default 34199) and "Planner viewer: debug log" are listed with their descriptions.
2. Start `udp_sender.py ping --bridge-port 40000` after changing the setting to 40000 in game: the hello arrives on 40000, not 34199.
3. Switch the debug log on, send a ping: `factorio-current.log` gets a `send_udp FP01 H.. took ...` line. Note the figure here: the plan's open question asks for the real cost of a `send_udp` call (the plan assumes about 20 ms).

### Window and GUI

1. **(unverified API)** The button is a square with the black **P** icon, in the frame in the top left corner (`mod-gui`, so it sits next to the buttons of other mods and does not float on its own), after a new game, after loading a save, and for a player who joins later. Its tooltip names the current indicator. Pressing it opens the window and lights the button; pressing it again, or the window's X, closes the window and the button goes dark. A save that had the old plain **Plan** button no longer shows it once loaded, and no `Unknown key` text shows anywhere.
2. The window opens at the top left, under the top left button, in the same place and at the same width as Factory Planner's compact view at its default width setting (also at a small resolution, with a long plan: the table scrolls inside the window, whose height stays on screen, at most 80 % of the screen). Nothing is cut off at the right edge, also with a beacon column, sub-factories and rows with many items: the buttons wrap instead. Dragged away, it stays where it was put through ticks and new snapshots. Changing the resolution or the UI scale moves it back and resizes it (a closed window stays closed). It can be dragged by its title bar, and closes with the X button and again with the top button. E and Esc do **not** close it: it is not the player's opened GUI, so the inventory opens with E while it stays shown. **(unverified API)** the styles `frame_title`, `draggable_space_header`, `frame_action_button`: if one is missing, the mod still works but looks plain.
3. A very long plan (Seablock, tens of blocks, tens of rows): opening, selecting a block and ticking a checkbox do not stall the game visibly.
4. A block name with rich-text brackets (for example `[item=iron-plate] smelting`) shows the icon, which is accepted; a name that opens a tag without closing it does not break the window.
5. Locale: nothing in the window shows `Unknown key`.

### No effect on the game

1. The mod adds no item, recipe or entity: the New Game screen and the Map editor show nothing new.
2. Whether `--enable-lua-udp` or the mod disables achievements is open (the plan's U4): note what the main menu says.

### Not supported

Multiplayer is out of scope for the first version. Do not report problems there.
