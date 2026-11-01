# UDP spike (Phase 0 steps 2 and 3)

Throwaway. `mod/` is the Factorio mod, `echo/` is a std-only Rust program that plays the bridge. Datagrams are `<kind>|<field>|...\n<body>`. The mod listens on the game port and replies to the echo port; results also go to the chat and `factorio-current.log`.

Ports: game `34198` (`--enable-lua-udp`), echo `34199` (mod setting `udp-spike-echo-port`).

## Setup

```sh
ln -s "$PWD/mod" ~/Library/Application\ Support/factorio/mods/udp-spike_0.0.1   # a folder named {mod}_{version} works unzipped
cd echo && cargo build --release
```

The 229 KB test payload `spike/snapshot-10x.json` is already generated (from the repo root: `node initiatives/in-game-viewer/spike/scale-snapshot.mjs initiatives/in-game-viewer/spike` regenerates it).

Launch Factorio with `--enable-lua-udp 34198` (Steam launch option). Use a new minimal save with only `udp-spike` enabled (step 2); the Seablock save is step 3. Write the Factorio build (Help → About, or the log header) next to every result.

**macOS limit, and what it means:** `net.inet.udp.maxdgram` defaults to 9216, so the OS refuses larger sends ("Message too long"). We do not ask players to change system settings, so the design budget is **datagrams of at most 9,216 bytes including the header** (use 8,000 B of payload). The `size` probe still tries larger sizes; on macOS the echo will report the send failure, which is the expected result. Only macOS is tested; Linux and Windows are best effort, and the 9,216-byte budget is conservative enough to hold there too. Test chunked delivery with `--chunk 8000`.

In the echo, run `udp-echo listen` in one terminal to watch unsolicited messages (`up`, `tick` → UPS, `stats`); the other commands print their own replies. Run the commands from a second terminal, one at a time (they share port 34199, so stop `listen` first, or use `--port` for the commands and set the mod's setting to match).

## Probes (in game: `/probe ...`)

All results are on factorio 2.0.77 (build 84539) with only the udp-spike mod enabled (no space age)

### 1. Largest datagram, bridge→mod

Do:

```sh
udp-echo size   # sizes above 9,216 fail to send on macOS by design; --sizes a,b,c to choose
```

Read: per size: OK, MISMATCH or no reply

Result:

```
Run 1, fresh game start (log: 43.6 s "Increasing size of socket buffer to 8192"):
   100 B -> OK
  1000 B -> OK
  4000 B -> OK
  8000 B -> no reply in 3 s
  (16000 B and above: "Message too long", the macOS sender limit)

Run 2, same session (log: 135.5 s "Increasing size of socket buffer to 16384"):
  4000 B -> OK
  8000 B -> OK
  8000 B -> OK
  9000 B -> no reply in 3 s
  9000 B -> OK
  9000 B -> OK
```

Finding: Factorio's receive buffer starts small and doubles when a datagram does not fit (8192, then 16384); **the datagram that triggers the growth is lost**, and later ones of that size pass. A bridge cannot rely on the first large datagram arriving.

Factorio log (`factorio-current.log`, same session; the "Increasing size" lines are the only trace of the lost datagrams, there is no warning or error):

```
15.272 Info UDPSocket.cpp:38: Opening socket at (IP ADDR:({127.0.0.1:34198}))
43.622 Info UDPSocket.cpp:560: Increasing size of socket buffer to 8192
135.471 Info UDPSocket.cpp:560: Increasing size of socket buffer to 16384
```

A failed bind shows up as `Game.cpp:68: Opening Lua UDP Socket failed: Binding IPv4 socket failed: Address already in use` right after the "Opening socket" line (seen when a stray process held 34198; the game then runs with no UDP at all and `send_udp` / `recv_udp` do nothing, silently).

### 2. Largest datagram, mod→bridge

Do:

```sh
udp-echo listen            # terminal
/probe up 1000 8000 9000   # in game
```

Read: received lengths

Result:

```
target/release/udp-echo listen
listening; UPS is derived from the mod's tick|<n> messages (every 600 ticks)
  <- 1000 B: up|1000
  <- 8000 B: up|8000
  <- 9000 B: up|9000
tick 28800: 58.7 UPS
```

Factorio log: only the mod's own lines, no warnings.

```
186.783 [udp-spike] sent up 1000
186.803 [udp-spike] sent up 8000
186.822 [udp-spike] sent up 9000
```

### 3. Binary safety

Do:

```sh
udp-echo bin
```

Read: OK or MISMATCH per case

Result:

```
target/release/udp-echo bin
  <- 21 B: size|0|262|2768863600
all 256 byte values    no reply (dropped?)
  <- 20 B: size|1|70|2218197489
  <- 10 B: tick|32400
NUL bytes              no reply (dropped?)
  <- 20 B: size|2|31|4011397301
UTF-8 text             no reply (dropped?)
  <- 19 B: size|3|14|850528156
invalid UTF-8          no reply (dropped?)
  <- 22 B: size|4|1030|2005069030
random 1 KB            no reply (dropped?)
  <- 22 B: size|5|8198|3618229976
  <- 10 B: tick|33000
random 8 KB            no reply (dropped?)
```

The "no reply" lines are a spike bug, not loss: the mod answered `size|...` where the echo waited for `bin|...` (fixed in `mod/control.lua`, which needs a game restart to reload). Each reply's length and checksum were compared by hand against the bytes `udp-echo bin` sends (same generator, in Python): all six cases match. `payload` is therefore binary-safe in bridge→mod, including NUL, invalid UTF-8 and bytes 0 to 255, so snapshots need no base64.


### 4. Loss and reordering

Do:

```sh
/probe reset
udp-echo seq --count 10000 --rate 100
# then --rate 1000, then --rate 0; run /probe reset between runs
# repeat with /probe poll 1, 10 and 60
```

Read: lost, out of order, duplicates

Result (poll 1):

```
$ target/release/udp-echo seq --count 10000 --rate 100
sent 10000 x 100 B in 100.001758792s
  <- 10 B: tick|39000
  <- 10 B: tick|39600
  <- 10 B: tick|40200
  <- 10 B: tick|40800
  <- 10 B: tick|41400
  <- 10 B: tick|42000
  <- 10 B: tick|42600
  <- 10 B: tick|43200
  <- 10 B: tick|43800
  <- 10 B: tick|44400
mod got 10000/10000 (lost 0), out of order 0, duplicates 0, ticks 38730..44658

$ target/release/udp-echo seq --count 10000 --rate 1000
sent 10000 x 100 B in 10.000189s
  <- 10 B: tick|46200
  <- 10 B: tick|46800
mod got 10000/10000 (lost 0), out of order 0, duplicates 0, ticks 46183..46783

$ target/release/udp-echo seq --count 10000 --rate 0
sent 10000 x 100 B in 62.529375ms
mod got 8535/10000 (lost 1465), out of order 0, duplicates 0, ticks 48059..48059
```

Result (poll 10):

```
$ target/release/udp-echo seq --count 10000 --rate 100
sent 10000 x 100 B in 100.000876042s
  <- 10 B: tick|54600
  <- 10 B: tick|55200
  <- 10 B: tick|55800
  <- 10 B: tick|56400
  <- 10 B: tick|57000
  <- 10 B: tick|57600
  <- 10 B: tick|58200
  <- 10 B: tick|58800
  <- 10 B: tick|59400
  <- 10 B: tick|60000
mod got 10000/10000 (lost 0), out of order 0, duplicates 0, ticks 54491..60491

$ target/release/udp-echo seq --count 10000 --rate 1000
sent 10000 x 100 B in 10.000233083s
  <- 10 B: tick|61800
mod got 10000/10000 (lost 0), out of order 0, duplicates 0, ticks 61551..62151

$ target/release/udp-echo seq --count 10000 --rate 0
sent 10000 x 100 B in 59.621709ms
mod got 1366/10000 (lost 8634), out of order 0, duplicates 0, ticks 63031..63031
```


Result (poll 60):

```
$ target/release/udp-echo seq --count 10000 --rate 100
target/release/udp-echo seq --count 10000 --rate 100
sent 10000 x 100 B in 100.000226125s
  <- 10 B: tick|64800
  <- 10 B: tick|65400
  <- 10 B: tick|66000
  <- 10 B: tick|66600
  <- 10 B: tick|67200
  <- 10 B: tick|67800
  <- 10 B: tick|68400
  <- 10 B: tick|69000
  <- 10 B: tick|69600
  <- 10 B: tick|70200
mod got 10000/10000 (lost 0), out of order 0, duplicates 0, ticks 64261..70261

$ target/release/udp-echo seq --count 10000 --rate 1000
sent 10000 x 100 B in 10.000217083s
  <- 10 B: tick|71400
mod got 10000/10000 (lost 0), out of order 0, duplicates 0, ticks 71221..71821

$ target/release/udp-echo seq --count 10000 --rate 0
sent 10000 x 100 B in 59.698958ms
  <- 10 B: tick|72600
mod got 1366/10000 (lost 8634), out of order 0, duplicates 0, ticks 72601..72601
```

### 5. 256 KB buffer

Do:

```sh
/probe poll 0
/probe reset
udp-echo flood --count 100 --size 8000   # 800 KB
/probe once
# wait a second
/probe stats
```

Read: packets and bytes the mod saw: whole datagrams dropped or truncated?

Result:

```
target/release/udp-echo flood --count 100 --size 8000
sent 100 x 8000 B = 800000 B. Now run /probe once, wait, then /probe stats in game.
  <- 10 B: tick|86400
stats|32|256000|86267|86267|0   (packets|bytes|first tick|last tick|bad)
```

Finding: of 100 datagrams of 8000 B (800 KB), exactly **32 arrived** (256,000 B), as whole datagrams: the byte count is an exact multiple of 8000, so none was truncated. The rest were dropped without any log line. Both burst probes fit one model: the buffer holds 262,144 B and each datagram costs its payload plus about 92 B of overhead (32 × 8,092 = 258,944 fits and a 33rd does not; 1,366 × 192 = 262,272 for the 100 B datagrams of probe 4). The overhead figure is inferred from two data points, not documented.

Factorio log for the working run (the first run, with the `food` typo, shows `stats|0|0|-1|-1|0` because nothing was sent). The dropped datagrams leave no line:

```
1156.261 [udp-spike] poll every 0 ticks
1158.578 [udp-spike] reset
1167.713 [udp-spike] recv_udp called at tick 86266; run /probe stats in a second
1174.061 [udp-spike] stats|32|256000|86267|86267|0
```

### 6. Pause

Do:

```sh
/probe poll 1
udp-echo ping --count 90 --interval-ms 1000   # a 90 s run
# 0-10 s play, 10-20 s Esc menu open, 20-40 s play, 40-70 s Esc menu open, 70-90 s play
# (the Esc menu pauses single-player; do not go back to the title screen, that unloads the mod)
```

Read: pongs after resume (burst? lost?) and the mod tick values

(started around 16:47:10 local)

Result:

```
$ target/release/udp-echo ping --count 90 --interval-ms 1000
ping   0 sent at      0 ms, reply at     39 ms, rtt    39 ms, mod tick 102383
ping   1 sent at   1002 ms, reply at   1055 ms, rtt    53 ms, mod tick 102444
ping   2 sent at   2000 ms, reply at   2040 ms, rtt    40 ms, mod tick 102503
ping   3 sent at   3005 ms, reply at   3057 ms, rtt    52 ms, mod tick 102564
  <- 11 B: tick|102600
ping   4 sent at   4002 ms, reply at   4056 ms, rtt    53 ms, mod tick 102624
ping   5 sent at   5005 ms, reply at   5056 ms, rtt    51 ms, mod tick 102674
ping   6 sent at   6005 ms, reply at   6058 ms, rtt    53 ms, mod tick 102734
ping   7 sent at   7003 ms, reply at   7060 ms, rtt    57 ms, mod tick 102794
ping   8 sent at   8001 ms, reply at   8043 ms, rtt    42 ms, mod tick 102853
ping   9 sent at   9000 ms, reply at   9044 ms, rtt    43 ms, mod tick 102913
ping  10 sent at  10001 ms, reply at  10039 ms, rtt    38 ms, mod tick 102973
^[ping  11 sent at  11002 ms, reply at  11060 ms, rtt    57 ms, mod tick 103034
ping  12 sent at  12003 ms, reply at  22719 ms, rtt 10716 ms, mod tick 103059
ping  13 sent at  13003 ms, reply at  22738 ms, rtt  9735 ms, mod tick 103059
ping  14 sent at  14002 ms, reply at  22755 ms, rtt  8753 ms, mod tick 103059
ping  15 sent at  15002 ms, reply at  22774 ms, rtt  7771 ms, mod tick 103059
ping  16 sent at  16000 ms, reply at  22792 ms, rtt  6791 ms, mod tick 103059
ping  17 sent at  17002 ms, reply at  22810 ms, rtt  5808 ms, mod tick 103059
ping  18 sent at  18001 ms, reply at  22831 ms, rtt  4830 ms, mod tick 103059
ping  19 sent at  19004 ms, reply at  22853 ms, rtt  3848 ms, mod tick 103059
ping  20 sent at  20000 ms, reply at  22873 ms, rtt  2872 ms, mod tick 103059
ping  21 sent at  21001 ms, reply at  22893 ms, rtt  1892 ms, mod tick 103059
ping  22 sent at  22002 ms, reply at  22915 ms, rtt   912 ms, mod tick 103059
ping  23 sent at  23004 ms, reply at  23056 ms, rtt    52 ms, mod tick 103070
ping  24 sent at  24001 ms, reply at  24688 ms, rtt   686 ms, mod tick 103097
ping  25 sent at  25002 ms, reply at  25056 ms, rtt    54 ms, mod tick 103119
ping  26 sent at  26001 ms, reply at  26041 ms, rtt    40 ms, mod tick 103178
  <- 11 B: tick|103200
ping  27 sent at  27004 ms, reply at  27055 ms, rtt    51 ms, mod tick 103238
ping  28 sent at  28000 ms, reply at  28039 ms, rtt    38 ms, mod tick 103297
ping  29 sent at  29005 ms, reply at  29062 ms, rtt    57 ms, mod tick 103358
ping  30 sent at  30001 ms, reply at  30039 ms, rtt    37 ms, mod tick 103417
ping  31 sent at  31001 ms, reply at  31049 ms, rtt    47 ms, mod tick 103477
ping  32 sent at  32001 ms, reply at  32041 ms, rtt    39 ms, mod tick 103537
ping  33 sent at  33003 ms, reply at  33056 ms, rtt    52 ms, mod tick 103598
ping  34 sent at  34004 ms, reply at  34056 ms, rtt    51 ms, mod tick 103658
ping  35 sent at  35000 ms, reply at  35041 ms, rtt    40 ms, mod tick 103717
ping  36 sent at  36002 ms, reply at  36040 ms, rtt    38 ms, mod tick 103777
  <- 11 B: tick|103800
ping  37 sent at  37003 ms, reply at  37056 ms, rtt    53 ms, mod tick 103838
ping  38 sent at  38000 ms, reply at  38039 ms, rtt    38 ms, mod tick 103896
ping  39 sent at  39005 ms, reply at  39057 ms, rtt    51 ms, mod tick 103957
ping  40 sent at  40002 ms, reply at  40039 ms, rtt    36 ms, mod tick 104016
ping  41 sent at  41005 ms, reply at  41057 ms, rtt    52 ms, mod tick 104076
ping  42 sent at  42001 ms, reply at  71776 ms, rtt 29774 ms, mod tick 104100
ping  43 sent at  43004 ms, reply at  71795 ms, rtt 28791 ms, mod tick 104100
ping  44 sent at  44002 ms, reply at  71814 ms, rtt 27811 ms, mod tick 104100
ping  45 sent at  45002 ms, reply at  71834 ms, rtt 26832 ms, mod tick 104100
ping  46 sent at  46003 ms, reply at  71853 ms, rtt 25850 ms, mod tick 104100
ping  47 sent at  47000 ms, reply at  71873 ms, rtt 24872 ms, mod tick 104100
ping  48 sent at  48000 ms, reply at  71894 ms, rtt 23893 ms, mod tick 104100
ping  49 sent at  49005 ms, reply at  71914 ms, rtt 22908 ms, mod tick 104100
ping  50 sent at  50002 ms, reply at  71936 ms, rtt 21933 ms, mod tick 104100
ping  51 sent at  51003 ms, reply at  71957 ms, rtt 20954 ms, mod tick 104100
ping  52 sent at  52002 ms, reply at  71977 ms, rtt 19974 ms, mod tick 104100
ping  53 sent at  53002 ms, reply at  71997 ms, rtt 18995 ms, mod tick 104100
ping  54 sent at  54000 ms, reply at  72018 ms, rtt 18017 ms, mod tick 104100
ping  55 sent at  55002 ms, reply at  72037 ms, rtt 17035 ms, mod tick 104100
ping  56 sent at  56002 ms, reply at  72058 ms, rtt 16055 ms, mod tick 104100
ping  57 sent at  57004 ms, reply at  72077 ms, rtt 15073 ms, mod tick 104100
ping  58 sent at  58003 ms, reply at  72093 ms, rtt 14089 ms, mod tick 104100
ping  59 sent at  59002 ms, reply at  72110 ms, rtt 13107 ms, mod tick 104100
ping  60 sent at  60003 ms, reply at  72132 ms, rtt 12128 ms, mod tick 104100
ping  61 sent at  61001 ms, reply at  72154 ms, rtt 11152 ms, mod tick 104100
ping  62 sent at  62002 ms, reply at  72171 ms, rtt 10169 ms, mod tick 104100
ping  63 sent at  63004 ms, reply at  72188 ms, rtt  9183 ms, mod tick 104100
ping  64 sent at  64000 ms, reply at  72206 ms, rtt  8206 ms, mod tick 104100
ping  65 sent at  65002 ms, reply at  72229 ms, rtt  7227 ms, mod tick 104100
ping  66 sent at  66002 ms, reply at  72247 ms, rtt  6245 ms, mod tick 104100
ping  67 sent at  67004 ms, reply at  72266 ms, rtt  5261 ms, mod tick 104100
ping  68 sent at  68002 ms, reply at  72287 ms, rtt  4284 ms, mod tick 104100
ping  69 sent at  69001 ms, reply at  72304 ms, rtt  3303 ms, mod tick 104100
ping  70 sent at  70001 ms, reply at  72324 ms, rtt  2323 ms, mod tick 104100
ping  71 sent at  71003 ms, reply at  72353 ms, rtt  1350 ms, mod tick 104100
ping  72 sent at  72003 ms, reply at  72374 ms, rtt   371 ms, mod tick 104101
ping  73 sent at  73003 ms, reply at  73641 ms, rtt   638 ms, mod tick 104108
ping  74 sent at  74004 ms, reply at  74060 ms, rtt    55 ms, mod tick 104133
ping  75 sent at  75001 ms, reply at  75039 ms, rtt    38 ms, mod tick 104192
ping  76 sent at  76002 ms, reply at  76055 ms, rtt    53 ms, mod tick 104253
ping  77 sent at  77002 ms, reply at  77056 ms, rtt    54 ms, mod tick 104313
ping  78 sent at  78005 ms, reply at  78057 ms, rtt    52 ms, mod tick 104373
  <- 11 B: tick|104400
ping  79 sent at  79002 ms, reply at  79056 ms, rtt    54 ms, mod tick 104433
ping  80 sent at  80004 ms, reply at  80058 ms, rtt    53 ms, mod tick 104493
ping  81 sent at  81000 ms, reply at  81038 ms, rtt    38 ms, mod tick 104552
ping  82 sent at  82003 ms, reply at  82054 ms, rtt    51 ms, mod tick 104613
ping  83 sent at  83003 ms, reply at  83057 ms, rtt    53 ms, mod tick 104673
ping  84 sent at  84000 ms, reply at  84040 ms, rtt    40 ms, mod tick 104732
ping  85 sent at  85001 ms, reply at  85043 ms, rtt    42 ms, mod tick 104792
ping  86 sent at  86001 ms, reply at  86046 ms, rtt    44 ms, mod tick 104852
ping  87 sent at  87003 ms, reply at  87057 ms, rtt    53 ms, mod tick 104913
ping  88 sent at  88003 ms, reply at  88058 ms, rtt    54 ms, mod tick 104973
  <- 11 B: tick|105000
ping  89 sent at  89002 ms, reply at  89070 ms, rtt    68 ms, mod tick 105033
```

### 7. Poll cost

Do:

```sh
udp-echo listen
/probe poll 0   # then 1, 10, 60, a minute each
```

Read: UPS lines

Result:

```
target/release/udp-echo listen
listening; UPS is derived from the mod's tick|<n> messages (every 600 ticks)
tick 109200: poll  0: 60.0 UPS
tick 109800: poll  0: 59.9 UPS
tick 110400: poll  0: 59.9 UPS
tick 111000: poll  0: 60.0 UPS
tick 111600: poll  1: 53.7 UPS  (poll changed in this window, ignore)
tick 112200: poll  1: 52.6 UPS
tick 112800: poll  1: 60.0 UPS
tick 113400: poll  1: 58.9 UPS
tick 114000: poll  1: 60.0 UPS
tick 114600: poll 10: 59.0 UPS  (poll changed in this window, ignore)
tick 115200: poll 10: 54.2 UPS
tick 115800: poll 10: 59.9 UPS
tick 116400: poll 10: 58.6 UPS
tick 117000: poll 60: 53.8 UPS  (poll changed in this window, ignore)
tick 117600: poll 60: 60.0 UPS
tick 118200: poll 60: 59.6 UPS
tick 118800: poll 60: 60.0 UPS
tick 119400: poll 60: 59.8 UPS
```

### 8. Latency

Do:

```sh
/probe poll 1
udp-echo ping --count 50 --interval-ms 100
# repeat with /probe poll 10
```

Read: rtt

Result (poll 1):

```
$ target/release/udp-echo ping --count 50 --interval-ms 100
ping   0 sent at      0 ms, reply at     49 ms, rtt    49 ms, mod tick 120953
ping   1 sent at    100 ms, reply at    147 ms, rtt    47 ms, mod tick 120959
ping   2 sent at    203 ms, reply at    249 ms, rtt    45 ms, mod tick 120965
ping   3 sent at    300 ms, reply at    350 ms, rtt    49 ms, mod tick 120971
ping   4 sent at    400 ms, reply at    449 ms, rtt    48 ms, mod tick 120977
ping   5 sent at    500 ms, reply at    549 ms, rtt    49 ms, mod tick 120983
ping   6 sent at    600 ms, reply at    651 ms, rtt    50 ms, mod tick 120989
ping   7 sent at    702 ms, reply at    751 ms, rtt    49 ms, mod tick 120995
ping   8 sent at    801 ms, reply at    852 ms, rtt    50 ms, mod tick 121001
ping   9 sent at    902 ms, reply at    953 ms, rtt    50 ms, mod tick 121007
ping  10 sent at   1004 ms, reply at   1047 ms, rtt    43 ms, mod tick 121013
ping  11 sent at   1103 ms, reply at   1149 ms, rtt    46 ms, mod tick 121019
ping  12 sent at   1200 ms, reply at   1250 ms, rtt    50 ms, mod tick 121025
ping  13 sent at   1301 ms, reply at   1350 ms, rtt    49 ms, mod tick 121031
ping  14 sent at   1401 ms, reply at   1452 ms, rtt    50 ms, mod tick 121037
ping  15 sent at   1502 ms, reply at   1551 ms, rtt    48 ms, mod tick 121043
ping  16 sent at   1601 ms, reply at   1651 ms, rtt    49 ms, mod tick 121049
ping  17 sent at   1700 ms, reply at   1749 ms, rtt    48 ms, mod tick 121055
ping  18 sent at   1804 ms, reply at   1851 ms, rtt    46 ms, mod tick 121061
ping  19 sent at   1901 ms, reply at   1947 ms, rtt    45 ms, mod tick 121067
ping  20 sent at   2003 ms, reply at   2048 ms, rtt    45 ms, mod tick 121073
ping  21 sent at   2100 ms, reply at   2149 ms, rtt    48 ms, mod tick 121079
ping  22 sent at   2201 ms, reply at   2251 ms, rtt    50 ms, mod tick 121085
ping  23 sent at   2301 ms, reply at   2351 ms, rtt    49 ms, mod tick 121091
ping  24 sent at   2401 ms, reply at   2450 ms, rtt    48 ms, mod tick 121097
ping  25 sent at   2501 ms, reply at   2550 ms, rtt    49 ms, mod tick 121103
ping  26 sent at   2601 ms, reply at   2650 ms, rtt    49 ms, mod tick 121109
ping  27 sent at   2701 ms, reply at   2750 ms, rtt    49 ms, mod tick 121115
ping  28 sent at   2801 ms, reply at   2851 ms, rtt    50 ms, mod tick 121121
ping  29 sent at   2901 ms, reply at   2953 ms, rtt    51 ms, mod tick 121127
ping  30 sent at   3005 ms, reply at   3051 ms, rtt    45 ms, mod tick 121133
ping  31 sent at   3101 ms, reply at   3151 ms, rtt    49 ms, mod tick 121139
ping  32 sent at   3202 ms, reply at   3248 ms, rtt    46 ms, mod tick 121145
ping  33 sent at   3304 ms, reply at   3349 ms, rtt    45 ms, mod tick 121151
ping  34 sent at   3400 ms, reply at   3451 ms, rtt    51 ms, mod tick 121157
ping  35 sent at   3502 ms, reply at   3553 ms, rtt    50 ms, mod tick 121163
ping  36 sent at   3603 ms, reply at   3650 ms, rtt    46 ms, mod tick 121169
ping  37 sent at   3701 ms, reply at   3750 ms, rtt    49 ms, mod tick 121175
ping  38 sent at   3801 ms, reply at   3851 ms, rtt    50 ms, mod tick 121181
ping  39 sent at   3902 ms, reply at   3950 ms, rtt    47 ms, mod tick 121187
ping  40 sent at   4000 ms, reply at   4050 ms, rtt    50 ms, mod tick 121193
ping  41 sent at   4102 ms, reply at   4151 ms, rtt    49 ms, mod tick 121199
  <- 13 B: tick|121200|1
ping  42 sent at   4204 ms, reply at   4253 ms, rtt    49 ms, mod tick 121205
ping  43 sent at   4303 ms, reply at   4349 ms, rtt    46 ms, mod tick 121211
ping  44 sent at   4405 ms, reply at   4450 ms, rtt    44 ms, mod tick 121217
ping  45 sent at   4500 ms, reply at   4550 ms, rtt    49 ms, mod tick 121223
ping  46 sent at   4600 ms, reply at   4650 ms, rtt    50 ms, mod tick 121229
ping  47 sent at   4701 ms, reply at   4751 ms, rtt    49 ms, mod tick 121235
ping  48 sent at   4801 ms, reply at   4852 ms, rtt    50 ms, mod tick 121241
ping  49 sent at   4902 ms, reply at   4950 ms, rtt    48 ms, mod tick 121247
```

Result (poll 10): 

```
$ target/release/udp-echo ping --count 50 --interval-ms 100
ping   0 sent at      0 ms, reply at     44 ms, rtt    44 ms, mod tick 123861
ping   1 sent at    100 ms, reply at    218 ms, rtt   117 ms, mod tick 123871
ping   2 sent at    203 ms, reply at    380 ms, rtt   177 ms, mod tick 123881
ping   3 sent at    302 ms, reply at    399 ms, rtt    97 ms, mod tick 123881
ping   4 sent at    400 ms, reply at    547 ms, rtt   147 ms, mod tick 123891
ping   5 sent at    501 ms, reply at    568 ms, rtt    67 ms, mod tick 123891
ping   6 sent at    602 ms, reply at    713 ms, rtt   110 ms, mod tick 123901
ping   7 sent at    702 ms, reply at    881 ms, rtt   178 ms, mod tick 123911
ping   8 sent at    803 ms, reply at    902 ms, rtt    99 ms, mod tick 123911
ping   9 sent at    902 ms, reply at   1045 ms, rtt   143 ms, mod tick 123921
ping  10 sent at   1004 ms, reply at   1064 ms, rtt    60 ms, mod tick 123921
ping  11 sent at   1105 ms, reply at   1227 ms, rtt   121 ms, mod tick 123931
ping  12 sent at   1202 ms, reply at   1397 ms, rtt   194 ms, mod tick 123941
ping  13 sent at   1300 ms, reply at   1416 ms, rtt   116 ms, mod tick 123941
ping  14 sent at   1403 ms, reply at   1563 ms, rtt   160 ms, mod tick 123951
ping  15 sent at   1501 ms, reply at   1582 ms, rtt    80 ms, mod tick 123951
ping  16 sent at   1604 ms, reply at   1733 ms, rtt   129 ms, mod tick 123961
ping  17 sent at   1705 ms, reply at   1897 ms, rtt   192 ms, mod tick 123971
ping  18 sent at   1801 ms, reply at   1919 ms, rtt   118 ms, mod tick 123971
ping  19 sent at   1903 ms, reply at   2063 ms, rtt   159 ms, mod tick 123981
ping  20 sent at   2000 ms, reply at   2083 ms, rtt    82 ms, mod tick 123981
ping  21 sent at   2100 ms, reply at   2230 ms, rtt   130 ms, mod tick 123991
ping  22 sent at   2201 ms, reply at   2396 ms, rtt   195 ms, mod tick 124001
ping  23 sent at   2305 ms, reply at   2414 ms, rtt   109 ms, mod tick 124001
ping  24 sent at   2402 ms, reply at   2560 ms, rtt   158 ms, mod tick 124011
ping  25 sent at   2504 ms, reply at   2578 ms, rtt    74 ms, mod tick 124011
ping  26 sent at   2601 ms, reply at   2729 ms, rtt   128 ms, mod tick 124021
ping  27 sent at   2702 ms, reply at   2896 ms, rtt   193 ms, mod tick 124031
ping  28 sent at   2802 ms, reply at   2915 ms, rtt   112 ms, mod tick 124031
ping  29 sent at   2902 ms, reply at   3065 ms, rtt   163 ms, mod tick 124041
ping  30 sent at   3004 ms, reply at   3085 ms, rtt    80 ms, mod tick 124041
ping  31 sent at   3102 ms, reply at   3231 ms, rtt   128 ms, mod tick 124051
ping  32 sent at   3203 ms, reply at   3400 ms, rtt   197 ms, mod tick 124061
ping  33 sent at   3304 ms, reply at   3420 ms, rtt   116 ms, mod tick 124061
ping  34 sent at   3400 ms, reply at   3561 ms, rtt   160 ms, mod tick 124071
ping  35 sent at   3505 ms, reply at   3583 ms, rtt    77 ms, mod tick 124071
ping  36 sent at   3605 ms, reply at   3729 ms, rtt   124 ms, mod tick 124081
ping  37 sent at   3700 ms, reply at   3898 ms, rtt   198 ms, mod tick 124091
ping  38 sent at   3803 ms, reply at   3916 ms, rtt   113 ms, mod tick 124091
ping  39 sent at   3903 ms, reply at   4063 ms, rtt   159 ms, mod tick 124101
ping  40 sent at   4000 ms, reply at   4084 ms, rtt    84 ms, mod tick 124101
ping  41 sent at   4101 ms, reply at   4229 ms, rtt   128 ms, mod tick 124111
ping  42 sent at   4203 ms, reply at   4400 ms, rtt   197 ms, mod tick 124121
ping  43 sent at   4302 ms, reply at   4421 ms, rtt   118 ms, mod tick 124121
ping  44 sent at   4400 ms, reply at   4563 ms, rtt   162 ms, mod tick 124131
ping  45 sent at   4500 ms, reply at   4583 ms, rtt    83 ms, mod tick 124131
ping  46 sent at   4600 ms, reply at   4732 ms, rtt   132 ms, mod tick 124141
ping  47 sent at   4701 ms, reply at   4897 ms, rtt   195 ms, mod tick 124151
ping  48 sent at   4804 ms, reply at   4917 ms, rtt   112 ms, mod tick 124151
ping  49 sent at   4903 ms, reply at   5063 ms, rtt   159 ms, mod tick 124161
```

### 9. Full-size delivery and decode cost

Do:

```sh
/probe reset
udp-echo full --file ../../snapshot-10x.json --chunk 8000 --per-batch 4 --pause-ms 20
# vary batch and pause until it passes; try /probe poll 1 and 10
```

Read: the ack line (length, checksum, blocks 40, rows 1360) and the profiler lines in the chat or factorio-current.log (adler32, json_to_table, table_to_json, encode_string, decode_string)

Result (poll 10):

```
$ target/release/udp-echo full --file ../../snapshot-10x.json --chunk 8000 --per-batch 4 --pause-ms 20
228548 B in 29 chunks of up to 8000 B, 4 per 20 ms; adler32 1966927422
ack after 833.529ms (round 0): mod len 228548 (sent 228548), checksum OK (sent 1966927422), blocks 40, rows 1360, re-encoded 352008 B, encode_string 8724 B, decode_string round trip true
```

Mod timings from factorio-current.log (same run):

```
adler32 of 228548 B: 41.46 ms   (test checksum only)
json_to_table 228548 B: 12.89 ms
table_to_json: 20.45 ms (output 352,008 B, 54 % larger than the input)
encode_string: 2.33 ms (8,724 B; the 10 copies are identical, real data compresses about 6:1)
decode_string: 0.74 ms
```


Result (poll 1):

```
target/release/udp-echo full --file ../../snapshot-10x.json --chunk 8000 --per-batch 4 --pause-ms 20
228548 B in 29 chunks of up to 8000 B, 4 per 20 ms; adler32 1966927422
ack after 799.305042ms (round 0): mod len 228548 (sent 228548), checksum OK (sent 1966927422), blocks 40, rows 1360, re-encoded 352008 B, encode_string 8724 B, decode_string round trip true
see /probe timings (decode, encode) in the game chat and factorio-current.log
```

Mod timings from factorio-current.log (same run):

```
adler32 of 228548 B: 47.79 ms   (test checksum only)
json_to_table 228548 B: 12.34 ms
table_to_json: 20.38 ms
encode_string: 2.41 ms
decode_string: 0.78 ms
```

### 10. for_player

Do (`listen` and `ping` both bind echo port 34199, so they cannot run at the same time; run them one after the other in the same terminal):

1. Game: `/probe forplayer on`
2. Terminal: `udp-echo listen`
3. Game: `/probe up 1000`. This tests `send_udp` with a player index. `up|1000` (a 1000 B line) should appear in the terminal.
4. Terminal: Ctrl+C to stop `listen`.
5. Terminal: `udp-echo ping --count 5 --interval-ms 500`. This tests `recv_udp` with a player index and the pong send. Expect 5 pong lines.
6. Game: `/probe forplayer off`

Read: what still works

Result:

```
$ target/release/udp-echo listen
listening; UPS is derived from the mod's tick|<n> messages (every 600 ticks)
  <- 1000 B: up|1000
tick 157800: poll  1: 58.8 UPS
^C⏎                                                                                                
$ target/release/udp-echo ping --count 6 --interval-ms 500
ping   0 sent at      0 ms, reply at     48 ms, rtt    48 ms, mod tick 158924
ping   1 sent at    500 ms, reply at    548 ms, rtt    48 ms, mod tick 158954
ping   2 sent at   1004 ms, reply at   1047 ms, rtt    43 ms, mod tick 158984
  <- 13 B: tick|159000|1
ping   3 sent at   1503 ms, reply at   1547 ms, rtt    44 ms, mod tick 159014
ping   4 sent at   2004 ms, reply at   2046 ms, rtt    42 ms, mod tick 159044
ping   5 sent at   2505 ms, reply at   2547 ms, rtt    42 ms, mod tick 159074
```

Factorio log: no error, no warning. The pings are not logged by the mod; their results are the echo output above.

```
235.610 [udp-spike] for_player true
246.138 [udp-spike] sent up 1000
279.610 [udp-spike] for_player false
```

Conclusion: `send_udp(port, data, 1)` and `recv_udp(1)` both work in single-player, with the same round trip (42 to 48 ms) as without a player index. The mod can omit the argument.

### 11. Port in use

Do (the echo takes the game's port 34198 for itself, so the game cannot open its socket):

1. Quit Factorio completely.
2. Terminal: `udp-echo listen --port 34198` (leave it running)
3. Launch Factorio with `--enable-lua-udp 34198` and load the save.
4. Game: `/probe poll 1`, then `/probe up 1000` (this makes the mod call `recv_udp` and `send_udp`, the case S5 reports crashing in 2.0.60).
5. Note whether the game crashes, shows an error, or stays silent, and read `factorio-current.log` (I can do that).
6. Terminal: Ctrl+C. Quit Factorio. Relaunch it without the echo to get back to normal.

Read: crash or error text

Result:

```
$ udp-echo listen --port 34198      (held the game's port)

15.738 Info UDPSocket.cpp:38: Opening socket at (IP ADDR:({127.0.0.1:34198}))
15.738 Info UDPSocket.cpp:238: Closing socket
15.738 Info UDPSocket.cpp:268: Socket closed
15.739 Warning Game.cpp:68: Opening Lua UDP Socket failed: Binding IPv4 socket failed: Address already in use
28.341 [udp-spike] poll every 1 ticks
38.223 [udp-spike] sent up 1000
```

Result: no crash (S5's 2.0.60 crash does not reproduce on 2.0.77). The game logs one warning at load and continues with no UDP socket; `recv_udp` every tick and `send_udp` both ran without error for over a minute, and do nothing. Nothing is shown in game, so the failure is silent: a mod cannot tell it from "no bridge". The only trace is the warning in `factorio-current.log`.

### 12. Sprite paths

Do:

```sh
/probe sprite
```

Read: is recipe/iron-plate valid? (S7)

Result:

```
474.911 [udp-spike] item/iron-plate valid=true
474.912 [udp-spike] recipe/iron-plate valid=true
474.912 [udp-spike] entity/assembling-machine-2 valid=true
```

Output is from `factorio-current.log` (`/probe sprite` only calls `helpers.is_valid_sprite_path`, and prints to the chat and the log). `recipe/<name>` is accepted by the game, which S7 left unverified.

### 13. Storage

Do:

```sh
# after a full run: save, reload
/probe storage
```

Read: present or absent

Result:

```
526.279 [udp-spike] chunk 0 of 29 received (8000 B)
526.998 [udp-spike] json_to_table 228548 B: Duration: 6.85 ms
536.743 [udp-spike] storage.snapshot is present
```

Not yet a result for the question asked: the log has a single `Loading map` line (at 17.6 s, game start), so the save was not reloaded between the `full` run and `/probe storage`. It shows only that the decoded table can be assigned to `storage` in the same session. Still to do: save, load the save from the main menu, run `/probe storage` again, and record present or absent. (Warm `json_to_table` on the same 229 KB took 6.85 ms this time, against 12 to 13 ms on the first runs.)

After saving and loading the save from the main menu (same Factorio process, no restart):

```
567.531 Info UDPSocket.cpp:238: Closing socket
567.574 Loading map .../saves/_autosave3.zip: 3545725 bytes.
567.700 Loading script.dat: 273000 bytes.
567.729 Info UDPSocket.cpp:38: Opening socket at (IP ADDR:({127.0.0.1:34198}))
573.593 Info UDPSocket.cpp:560: Increasing size of socket buffer to 8192
588.711 Info UDPSocket.cpp:238: Closing socket
588.743 Loading map .../saves/test.zip: 3540217 bytes.
588.866 Loading script.dat: 273000 bytes.
588.891 Info UDPSocket.cpp:38: Opening socket at (IP ADDR:({127.0.0.1:34198}))
590.876 [udp-spike] storage.snapshot is present
```

Result: present. `script.dat` grew from 1,222 B (game start) to 273,000 B, which is the stored 229 KB snapshot, so a snapshot survives save and load. The UDP socket is closed and reopened on every load, and the buffer-growth line reappears after a load (573.6 s), so the first large datagram after any load can be lost, not only after a game start.

### 14. Multiplayer and achievements

Skipped: multiplayer is out of scope, and nothing in the planner depends on achievements.

After a `seq` or `flood`, run `/probe reset` before the next one.

## Step 3 — coexistence with the Seablock save

Goal: the same round trip as step 2, with Seablock's mod set loaded, to catch conflicts (Lua errors, a clash on the `/probe` command, a slower load, UPS) and to see whether the numbers change. Everything below is run by you; tell me when each part is done and I read `factorio-current.log`.

### 3.0 Prepare

1. Stop anything holding the game's port: `lsof -nP -iUDP | grep 34198` must print nothing (a `udp-echo` left over from probe 11 makes the game fail to open its socket; the log then shows `Address already in use`).
2. The `udp-spike` symlink from the Setup section must still be in the mods folder. Quit Factorio if it is running.
3. Launch Factorio with the usual launch option (`--enable-lua-udp 34198`).
4. Main menu → Mods: tick `udp-spike`, apply, and let Factorio restart if it asks. Check the mod list shows Seablock's mods and `udp-spike` as enabled.
5. Write the Factorio build and the Seablock mod count (Mods screen) next to the results.

### 3.1 Load and look for conflicts

1. Load your Seablock save as usual. Do not save over it: quit without saving, or let it autosave only if you are fine with that. Stay out of other menus while it loads.
2. When it is loaded, do nothing else yet. Tell me: I read the log for `Opening socket at ... 34198` with no `Address already in use` warning, any `Error` or `Failed` lines naming `udp-spike` or another mod, and the load time (from the `Loading map` line to the first line after it).
3. Game: `/probe poll 10`. If the command is unknown or another mod answers it, record that.

Load time (from the log) and conflicts:

```
Seablock save KompetenzAirbag-Seablock-Preview-26.zip (5,575,394 B; level.dat 26.6 MB, script.dat 11.8 MB), first attempt:
27.382 Info UDPSocket.cpp:38: Opening socket at (IP ADDR:({127.0.0.1:34198}))
27.383 Warning Game.cpp:68: Opening Lua UDP Socket failed: Binding IPv4 socket failed: Address already in use
(cause: a udp-echo from probe 11 was still bound to 34198; map load 26.4 s to 28.5 s, about 2 s)

Second attempt, nothing holding the port:
34.396 Loading map .../KompetenzAirbag-Seablock-Preview-26.zip: 5575394 bytes.
34.916 Loading script.dat: 11782551 bytes.
34.969 Checksum for script __udp-spike__/control.lua: 524391301
35.267 Info UDPSocket.cpp:38: Opening socket at (IP ADDR:({127.0.0.1:34198}))
36.295 Script @__Milestones__/scripts/presets_loader.lua:159: New list of valid presets: ...   (last line of the load)
```

Result: no error or warning names `udp-spike`; the only `Error` lines in the log are Seablock's own `settings-updates.lua: Error: missing setting angels-*, bobmods-*, sct-connect-science` at start-up, before our mod loads. The socket opens cleanly on the second attempt (`lsof` shows factorio on 127.0.0.1:34198). Load time is about 1.9 s (34.4 s to 36.3 s). The `/probe` command check passed in 3.2 (`/probe poll` ran).

### 3.2 Round trip

Terminal, in this order, one at a time (they all use echo port 34199; `listen` cannot run at the same time as the others). Run `/probe reset` in game before each command that is marked with a star.

1. Warm-up for the buffer growth (the first large datagram after a load can be lost): `udp-echo size --sizes 9000,9000`
2. `udp-echo size --sizes 100,4000,8000,9000`
3. `udp-echo bin`
4. \* `udp-echo full --file ../../snapshot-10x.json --chunk 8000 --per-batch 4 --pause-ms 20` at `/probe poll 10`
5. \* The same `full` command again after `/probe poll 1`
6. The `ping` check: `udp-echo ping --count 20 --interval-ms 500`

Paste each terminal output. Then tell me, and I read the mod's timings (json_to_table, table_to_json, encode_string, decode_string) from the log.

Results:

```
$ target/release/udp-echo size --sizes 9000,9000
  9000 B -> no reply in 3 s (dropped, or mod not polling)
  9000 B -> no reply in 3 s (dropped, or mod not polling)
$ target/release/udp-echo size --sizes 100,4000,8000,9000
   100 B -> mod saw 100 B, checksum OK
  4000 B -> mod saw 4000 B, checksum OK
  8000 B -> mod saw 8000 B, checksum OK
  9000 B -> mod saw 9000 B, checksum OK
$ target/release/udp-echo bin  17:24:54
all 256 byte values    sent 262 B, mod saw 262 B: OK
NUL bytes              sent 70 B, mod saw 70 B: OK
UTF-8 text             sent 31 B, mod saw 31 B: OK
invalid UTF-8          sent 14 B, mod saw 14 B: OK
random 1 KB            sent 1030 B, mod saw 1030 B: OK
random 8 KB            sent 8198 B, mod saw 8198 B: OK
$ target/release/udp-echo full --file ../../snapshot-10x.json --chunk 8000 --per-batch 4 --pause-ms 20
228548 B in 29 chunks of up to 8000 B, 4 per 20 ms; adler32 1966927422
ack after 801.389208ms (round 0): mod len 228548 (sent 228548), checksum OK (sent 1966927422), blocks 40, rows 1360, re-encoded 352008 B, encode_string 8724 B, decode_string round trip true
see /probe timings (decode, encode) in the game chat and factorio-current.log
$ target/release/udp-echo full --file ../../snapshot-10x.json --chunk 8000 --per-batch 4 --pause-ms 20
228548 B in 29 chunks of up to 8000 B, 4 per 20 ms; adler32 1966927422
ack after 757.963833ms (round 0): mod len 228548 (sent 228548), checksum OK (sent 1966927422), blocks 40, rows 1360, re-encoded 352008 B, encode_string 8724 B, decode_string round trip true
see /probe timings (decode, encode) in the game chat and factorio-current.log
$ target/release/udp-echo ping --count 20 --interval-ms 500
ping   0 sent at      0 ms, reply at     45 ms, rtt    45 ms, mod tick 6490783
  <- 14 B: tick|6490800|1
ping   1 sent at    503 ms, reply at    544 ms, rtt    41 ms, mod tick 6490813
ping   2 sent at   1005 ms, reply at   1042 ms, rtt    37 ms, mod tick 6490843
ping   3 sent at   1503 ms, reply at   1568 ms, rtt    65 ms, mod tick 6490873
ping   4 sent at   2004 ms, reply at   2044 ms, rtt    39 ms, mod tick 6490901
ping   5 sent at   2500 ms, reply at   2542 ms, rtt    42 ms, mod tick 6490931
ping   6 sent at   3002 ms, reply at   3044 ms, rtt    42 ms, mod tick 6490961
ping   7 sent at   3504 ms, reply at   3546 ms, rtt    41 ms, mod tick 6490991
ping   8 sent at   4001 ms, reply at   4050 ms, rtt    48 ms, mod tick 6491021
ping   9 sent at   4500 ms, reply at   4546 ms, rtt    45 ms, mod tick 6491051
ping  10 sent at   5001 ms, reply at   5046 ms, rtt    44 ms, mod tick 6491081
ping  11 sent at   5504 ms, reply at   5545 ms, rtt    40 ms, mod tick 6491111
ping  12 sent at   6002 ms, reply at   6048 ms, rtt    46 ms, mod tick 6491141
ping  13 sent at   6501 ms, reply at   6549 ms, rtt    48 ms, mod tick 6491171
ping  14 sent at   7003 ms, reply at   7049 ms, rtt    45 ms, mod tick 6491201
ping  15 sent at   7504 ms, reply at   7547 ms, rtt    43 ms, mod tick 6491231
ping  16 sent at   8003 ms, reply at   8046 ms, rtt    43 ms, mod tick 6491261
ping  17 sent at   8501 ms, reply at   8546 ms, rtt    44 ms, mod tick 6491291
ping  18 sent at   9000 ms, reply at   9042 ms, rtt    42 ms, mod tick 6491321
ping  19 sent at   9503 ms, reply at   9545 ms, rtt    41 ms, mod tick 6491351
```

Factorio log for 3.2 (Seablock, `factorio-current.log`):

```
81.700 Info UDPSocket.cpp:560: Increasing size of socket buffer to 8192
84.700 Info UDPSocket.cpp:560: Increasing size of socket buffer to 16384
114.519 [udp-spike] poll every 10 ticks
124.518 [udp-spike] chunk 0 of 29 received (8000 B)
125.198 [udp-spike] adler32 of 228548 B: Duration: 14.53 ms
125.212 [udp-spike] json_to_table 228548 B: Duration: 13.47 ms
125.234 [udp-spike] table_to_json: Duration: 21.83 ms
125.237 [udp-spike] encode_string: Duration: 2.91 ms
125.237 [udp-spike] decode_string: Duration: 0.84 ms
130.350 [udp-spike] poll every 1 ticks
132.951 [udp-spike] chunk 0 of 29 received (8000 B)
133.633 [udp-spike] adler32 of 228548 B: Duration: 16.16 ms
133.643 [udp-spike] json_to_table 228548 B: Duration: 9.74 ms
133.662 [udp-spike] table_to_json: Duration: 19.33 ms
133.665 [udp-spike] encode_string: Duration: 2.76 ms
133.666 [udp-spike] decode_string: Duration: 0.85 ms
```

Result: everything that passed in step 2 passes with Seablock's mod set. The warm-up pair of 9000 B datagrams was lost (two lines in the log: the buffer grew 8192, then 16384, one lost datagram per growth step), and every later datagram passed. `size` up to 9000 B, `bin` (6 of 6) and `full` (checksum OK, 40 blocks, 1360 rows, no resend) all passed, at `poll 10` (ack 801 ms) and `poll 1` (ack 758 ms). Mod timings match step 2 (`json_to_table` 13.5 and 9.7 ms against 12 to 13 ms). Round trip 37 to 65 ms (median about 43) at `poll 1`, as in step 2. `/probe poll` worked, so the command is not taken by another mod.

Design consequence: after a fresh socket the buffer needs one lost datagram per doubling step to reach the chunk size, so a warm-up must send at least two chunk-sized datagrams (more if the chunk size grows) and the bridge must not count them as snapshot loss.

### 3.3 UPS with Seablock

1. Terminal: `udp-echo listen`
2. Game: `/probe poll 0`, wait about 40 s. Then `/probe poll 1`, wait about 40 s. Then `/probe poll 10`, wait about 40 s. Seablock's base UPS may be lower than 60 on this machine; what matters is the difference between the settings, so look at the `poll 0` lines as the baseline.
3. Ctrl+C. Paste the output.

Result:

```
$ target/release/udp-echo listen
listening on 127.0.0.1:34199; UPS is derived from the mod's tick|<n> messages (every 600 ticks)
tick 6497400: poll  0: 53.6 UPS
tick 6498000: poll  0: 59.9 UPS
tick 6498600: poll  0: 56.7 UPS
tick 6499200: poll  0: 60.0 UPS
tick 6499800: poll  1: 59.9 UPS  (poll changed in this window, ignore)
tick 6500400: poll  1: 59.9 UPS
tick 6501000: poll  1: 60.0 UPS
tick 6501600: poll  1: 59.9 UPS
tick 6502200: poll 10: 59.9 UPS  (poll changed in this window, ignore)
tick 6502800: poll 10: 59.9 UPS
tick 6503400: poll 10: 59.9 UPS
tick 6504000: poll 10: 59.9 UPS
```

Factorio log (the poll changes, to line up the windows above):

```
244.567 [udp-spike] poll every 0 ticks
286.943 [udp-spike] poll every 1 ticks
329.317 [udp-spike] poll every 10 ticks
```

Result: no measurable polling cost with Seablock loaded. The Seablock save runs at 60 UPS here. Clean windows: `poll 0` (baseline) 53.6, 59.9, 56.7, 60.0; `poll 1` 59.9, 60.0, 59.9; `poll 10` 59.9, 59.9, 59.9. The only dips are in the no-polling baseline, so they are noise and not caused by `recv_udp`. As in step 2, a poll interval can be chosen for latency and buffer headroom, not UPS.

### 3.4 Sprite paths with Seablock names (optional)

Game, one command (the ids come from the planner's Seablock sample plan, so they exist in this mod set; the three vanilla paths are checked as well):

```sh
/probe sprite recipe/angels-plate-iron-2 recipe/sb-thermal-bore-water item/bob-basic-circuit-board item/bob-glass fluid/angels-gas-nitrogen
```

Read: all five extra lines should say `valid=true`; the point is `recipe/` with a modded recipe. A `valid=false` on the `fluid/` line would be about the path form (fluids are not items), not about modded prototypes.

Result:

```
453.200 [udp-spike] item/iron-plate valid=true
453.200 [udp-spike] recipe/iron-plate valid=true
453.200 [udp-spike] entity/assembling-machine-2 valid=true
453.200 [udp-spike] recipe/angels-plate-iron-2 valid=true
453.201 [udp-spike] recipe/sb-thermal-bore-water valid=true
453.201 [udp-spike] item/bob-basic-circuit-board valid=true
453.201 [udp-spike] item/bob-glass valid=true
453.201 [udp-spike] fluid/angels-gas-nitrogen valid=true
```

Result: all eight paths are valid, including `recipe/` with modded recipes (Angel's, Seablock) and `fluid/` for a modded fluid. The mod can render any of these ids as sprites from the plan.

### 3.5 Clean up

Ctrl+C the echo. Quit without saving over the Seablock save. Untick `udp-spike` in the Mods menu when the spike is done.
