# Manual checklist: the mod in Factorio 2.0.77

CI never starts the game, so everything that touches the Factorio API (`control.lua`, `gui.lua`, `settings.lua`, the locale file) is checked here, once per release and after any change to those files. The pure Lua modules are covered by the busted specs, and `glue_spec.lua` runs the glue against a fake runtime, which catches plain Lua mistakes and nothing about the real API.

Run it on **Factorio 2.0.77 only**, on a **throwaway save** (the mod writes the received snapshot into the save). Tick each item, and write down what was seen in the PR or release notes. A failure of an item marked **(unverified API)** is expected to be a one-line fix in the file named; the list of such calls is in the PR that added them.

## Setup

1. Put the mod in the game's `mods/` folder as `factorio-planner-viewer_0.1.0/`, holding `info.json`, `control.lua`, `settings.lua`, `lib/`, `scripts/` and `locale/` (a copy or a symlink of `mod/` is enough, `spec/`, `tools/` and the rest are ignored by the game).
2. Start the game with `--enable-lua-udp 34198` (Steam launch option, or on the command line). Load the throwaway save.
3. The bridge does not exist yet; `mod/tools/udp_sender.py` stands in for it (`python3 mod/tools/udp_sender.py --help`). It sends datagrams to the game's port and prints the mod's answers, which the mod sends to the bridge port 34199.
4. After loading, `factorio-current.log` must show no Lua error from `factorio-planner-viewer`.

## Checks

### The game launched without the flag

1. Quit, start the game **without** `--enable-lua-udp`, load the save.
2. No error, no crash, in the first minute and after opening the window. The top bar shows the **Plan** button; the window shows **Disconnected** with the text about the launch option and `factorio-current.log`.
3. Run `python3 mod/tools/udp_sender.py ping`: nothing is answered, the indicator stays Disconnected, and the log has at most one `recv_udp failed` / `send_udp failed` line each if the game raises there.

### Handshake and the indicator

1. With the flag, load the save, open the window: **Disconnected** (no datagram yet).
2. `udp_sender.py ping`: the sender prints `FP01 H ---------------- 0 ----------------` within about a second, and the indicator clears within a poll (the window is rebuilt, no longer showing Disconnected). The window says no plan has arrived yet.
3. Leave the sender silent for 18 s of game time (1,080 ticks at speed 1, which is 18 s of wall clock): **Disconnected** returns. Then set `/c game.speed = 8` and send a ping. At speed 8 the game runs 480 ticks per wall-clock second and the mod scales the threshold to 1,080 x 8 = 8,640 ticks, so **Disconnected** must return after about 18 s of wall clock again (time it). It must not come back after about 2.3 s of wall clock, which is what an unscaled 1,080-tick threshold would give. Set `/c game.speed = 1` afterwards.
4. `udp_sender.py raw 'FP02 P ----------------'`: **Protocol mismatch** shows, and the answer is a `FP01 H` hello. A normal ping clears it.

### Delivering a snapshot

1. `udp_sender.py send contract/fixtures/small.json`. Expected replies: `FP01 R <id>`, then `FP01 A <id> <n>` (the sender sends probe, chunks and end of window together, and the mod answers once per poll, so the last answer is what counts). With a base-game install the ids of the Seablock fixture are missing, so `<n>` is above 0: see the unknown-id check below.
2. Open the window from the top bar: the block list shows **Gears** with its colour swatch; the right side lists products (with rates per minute), recipes (recipe, machine, machines to place, power), imports and totals.
3. Save and load the game **without** sending anything: the window, once opened, still shows the plan (it is read from the save), with **Disconnected** until the first ping.
4. `udp_sender.py ping 0000000000000000`: the indicator shows **Stale** (the planner's newest differs from the stored id). `udp_sender.py ping <the stored id>` clears it.
5. `udp_sender.py send contract/fixtures/seablock-areas.json --chunk 700`: a multi-chunk delivery. The window shows blocks with an **Area** column.
6. Click each block in the list: the right side follows and scrolls back to the top; the selected block's button is highlighted. Nothing else in the window is editable. With a plan of more blocks than fit (Seablock), scroll the list down, click a block near the bottom: the list stays where it was. Scroll the details pane down, then send a new snapshot: the panes keep their scroll position (**unverified**: that the game keeps a scroll position when a pane's children are cleared and added again).
7. Send a snapshot with the same blocks in another order: the window keeps showing the block of the same name, wherever it moved.

### A non-ASCII block name

1. `udp_sender.py send contract/fixtures/unicode.json --chunk 1000` (the cut falls inside multi-byte characters).
2. The log shows no error; the reply is an ack (`FP01 A`), not `FP01 N ... json`.
3. The block list shows `Fonderie à fer – été`, `鉄工場 (歯車)` and `Électricité ⚡🏭 « Ünï»` as written (a glyph the game's font lacks may show as a box; that is the font's doing, not the mod's).

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
3. In the block details, a missing recipe or machine is written as red text `<id> (not in this game)`, not as an icon; an id the game has shows its icon and localised name.
4. Quick hook: a synthetic row (mining, offshore, power) shows its kind and product; the `electricity` product shows **Electricity** (with an icon when `utility/electricity_icon` exists) and is **not** in the missing list.
5. Edit a fixture copy so a `kind: "mining"` row has no `product`: the row shows `Unknown (Mining)` in orange, nothing raises.
6. Add a mod that adds a recipe id used by a fixture, restart: the unknown-id count in the next `hello` is lower (it is recomputed on a configuration change).

### Settings

1. **Settings > Mod settings > Map**: "Planner bridge port" (default 34199) and "Planner viewer: debug log" are listed with their descriptions.
2. Start `udp_sender.py ping --bridge-port 40000` after changing the setting to 40000 in game: the hello arrives on 40000, not 34199.
3. Switch the debug log on, send a ping: `factorio-current.log` gets a `send_udp FP01 H.. took ...` line. Note the figure here: the plan's open question asks for the real cost of a `send_udp` call (the plan assumes about 20 ms).

### Window and GUI

1. The top-bar button **Plan** is visible after a new game, after loading a save, and for a player who joins later. Its tooltip names the current indicator.
2. The window opens centred on the screen at its full size (also at a small resolution, with a long plan), can be dragged by its title bar, closes with the X button, with E and with Esc, and again with the top button. **(unverified API)** the styles `frame_title`, `draggable_space_header`, `frame_action_button`: if one is missing, the mod still works but looks plain.
3. A very long plan (Seablock, tens of blocks, tens of rows): opening and selecting a block does not stall the game visibly.
4. A block name with rich-text brackets (for example `[item=iron-plate] smelting`) shows the icon, which is accepted; a name that opens a tag without closing it does not break the window.
5. Locale: nothing in the window shows `Unknown key`.

### No effect on the game

1. The mod adds no item, recipe or entity: the New Game screen and the Map editor show nothing new.
2. Whether `--enable-lua-udp` or the mod disables achievements is open (the plan's U4): note what the main menu says.

### Not supported

Multiplayer is out of scope for the first version. Do not report problems there.
