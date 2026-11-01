//! Throwaway spike (Phase 0 step 2): plays the bridge's part against udp-spike/mod.
//! Usage: udp-echo [--game-port 34198] [--port 34199] <command> [options]; see README.md.
use std::collections::HashMap;
use std::net::UdpSocket;
use std::time::{Duration, Instant};
use std::{env, fs, thread};

fn adler32(d: &[u8]) -> u32 {
    let (mut a, mut b) = (1u32, 0u32);
    for &x in d {
        a = (a + x as u32) % 65521;
        b = (b + a) % 65521;
    }
    (b << 16) | a
}

struct Ctx {
    sock: UdpSocket,
    game: String,
}

impl Ctx {
    fn send(&self, d: &[u8]) {
        if let Err(e) = self.sock.send_to(d, &self.game) {
            eprintln!("send of {} B failed: {e}", d.len());
        }
    }
    fn recv(&self, wait: Duration) -> Option<Vec<u8>> {
        self.sock.set_read_timeout(Some(wait.max(Duration::from_millis(1)))).unwrap();
        let mut buf = vec![0u8; 70000];
        match self.sock.recv_from(&mut buf) {
            Ok((n, _)) => {
                buf.truncate(n);
                Some(buf)
            }
            Err(_) => None,
        }
    }
    /// Wait for a reply whose header starts with `kind|`, printing any other datagram.
    fn expect(&self, kind: &str, wait: Duration) -> Option<String> {
        let end = Instant::now() + wait;
        while Instant::now() < end {
            if let Some(d) = self.recv(end - Instant::now()) {
                let s = String::from_utf8_lossy(&d).to_string();
                if s.starts_with(&format!("{kind}|")) {
                    return Some(s);
                }
                show(&d);
            }
        }
        None
    }
}

fn show(d: &[u8]) {
    let head: String = String::from_utf8_lossy(&d[..d.len().min(60)]).lines().next().unwrap_or("").to_string();
    println!("  <- {} B: {head}", d.len());
}

fn opt<T: std::str::FromStr>(args: &[String], name: &str, default: T) -> T {
    args.iter().position(|a| a == name).and_then(|i| args.get(i + 1)).and_then(|v| v.parse().ok()).unwrap_or(default)
}

fn opt_s(args: &[String], name: &str) -> Option<String> {
    args.iter().position(|a| a == name).and_then(|i| args.get(i + 1)).cloned()
}

fn padded(head: &str, size: usize, fill: u8) -> Vec<u8> {
    let mut v = format!("{head}\n").into_bytes();
    while v.len() < size {
        v.push(fill);
    }
    v
}

fn cmd_size(c: &Ctx, args: &[String]) {
    let sizes: Vec<usize> = opt_s(args, "--sizes")
        .unwrap_or("100,1000,4000,8000,16000,32000,60000,65000,65507".into())
        .split(',')
        .map(|s| s.parse().unwrap())
        .collect();
    for (i, n) in sizes.iter().enumerate() {
        let d = padded(&format!("size|{i}"), *n, b'x');
        c.send(&d);
        match c.expect("size", Duration::from_secs(3)) {
            Some(r) => {
                let f: Vec<&str> = r.split('|').collect();
                let ok = f[2] == d.len().to_string() && f[3] == adler32(&d).to_string();
                println!("{n:>6} B -> mod saw {} B, checksum {}", f[2], if ok { "OK" } else { "MISMATCH" });
            }
            None => println!("{n:>6} B -> no reply in 3 s (dropped, or mod not polling)"),
        }
    }
}

fn cmd_bin(c: &Ctx) {
    let mut xs = 12345u64;
    let mut rnd = |n: usize| -> Vec<u8> {
        (0..n)
            .map(|_| {
                xs ^= xs << 13;
                xs ^= xs >> 7;
                xs ^= xs << 17;
                xs as u8
            })
            .collect()
    };
    let cases: Vec<(&str, Vec<u8>)> = vec![
        ("all 256 byte values", (0..=255u8).collect()),
        ("NUL bytes", vec![0u8; 64]),
        ("UTF-8 text", "héllo ☃ 日本語 🏭".as_bytes().to_vec()),
        ("invalid UTF-8", vec![0xff, 0xfe, 0xc3, 0x28, 0xa0, 0xa1, 0xf8, 0x88]),
        ("random 1 KB", rnd(1024)),
        ("random 8 KB", rnd(8192)),
    ];
    for (i, (label, body)) in cases.iter().enumerate() {
        let mut d = format!("bin|{i}\n").into_bytes();
        d.extend_from_slice(body);
        c.send(&d);
        match c.expect("bin", Duration::from_secs(3)) {
            Some(r) => {
                let f: Vec<&str> = r.split('|').collect();
                let ok = f[2] == d.len().to_string() && f[3] == adler32(&d).to_string();
                println!("{label:<22} sent {} B, mod saw {} B: {}", d.len(), f[2], if ok { "OK" } else { "MISMATCH" });
            }
            None => println!("{label:<22} no reply (dropped?)"),
        }
    }
}

fn cmd_seq(c: &Ctx, args: &[String]) {
    let count: usize = opt(args, "--count", 10000);
    let rate: usize = opt(args, "--rate", 0); // datagrams per second, 0 = unthrottled
    let size: usize = opt(args, "--size", 100);
    let start = Instant::now();
    for i in 0..count {
        c.send(&padded(&format!("seq|{i}"), size, b's'));
        if rate > 0 {
            let due = start + Duration::from_secs_f64((i + 1) as f64 / rate as f64);
            if let Some(d) = due.checked_duration_since(Instant::now()) {
                thread::sleep(d);
            }
        }
    }
    println!("sent {count} x {size} B in {:?}", start.elapsed());
    thread::sleep(Duration::from_secs(1));
    c.send(b"seqend|0");
    match c.expect("seqres", Duration::from_secs(10)) {
        Some(r) => {
            let f: Vec<&str> = r.split('|').collect();
            let got: usize = f[2].parse().unwrap();
            println!("mod got {got}/{count} (lost {}), out of order {}, duplicates {}, ticks {}..{}", count - got.min(count), f[3], f[4], f[5], f[6]);
        }
        None => println!("no seqres (end marker lost, or mod not polling)"),
    }
}

fn cmd_flood(c: &Ctx, args: &[String]) {
    let count: usize = opt(args, "--count", 100);
    let size: usize = opt(args, "--size", 8000);
    for i in 0..count {
        c.send(&padded(&format!("seq|{i}"), size, b'f'));
    }
    println!("sent {count} x {size} B = {} B. Now run /probe once, wait, then /probe stats in game.", count * size);
    if let Some(r) = c.expect("stats", Duration::from_secs(opt(args, "--wait", 120))) {
        println!("{r}   (packets|bytes|first tick|last tick|bad)");
    }
}

fn cmd_ping(c: &Ctx, args: &[String]) {
    let count: usize = opt(args, "--count", 20);
    let interval: u64 = opt(args, "--interval-ms", 1000);
    let mut sent: HashMap<usize, Instant> = HashMap::new();
    let t0 = Instant::now();
    let mut next = Instant::now();
    let mut got = 0;
    while got < count || t0.elapsed() < Duration::from_millis(interval * count as u64 + 3000) {
        if sent.len() < count && Instant::now() >= next {
            let i = sent.len();
            sent.insert(i, Instant::now());
            c.send(format!("ping|{i}").as_bytes());
            next += Duration::from_millis(interval);
        }
        if let Some(d) = c.recv(Duration::from_millis(5)) {
            let s = String::from_utf8_lossy(&d).to_string();
            if let Some(rest) = s.strip_prefix("pong|") {
                let f: Vec<&str> = rest.split('|').collect();
                let i: usize = f[0].parse().unwrap();
                println!("ping {i:>3} sent at {:>6} ms, reply at {:>6} ms, rtt {:>5} ms, mod tick {}", sent[&i].duration_since(t0).as_millis(), t0.elapsed().as_millis(), sent[&i].elapsed().as_millis(), f[1]);
                got += 1;
            } else {
                show(&d);
            }
        }
        if got >= count {
            break;
        }
    }
}

fn cmd_listen(c: &Ctx) {
    println!("listening on {}; UPS is derived from the mod's tick|<n> messages (every 600 ticks)", c.sock.local_addr().unwrap());
    let mut last: Option<(Instant, u64, String)> = None;
    loop {
        if let Some(d) = c.recv(Duration::from_secs(3600)) {
            let s = String::from_utf8_lossy(&d);
            if let Some(rest) = s.strip_prefix("tick|") {
                let mut f = rest.split('|');
                let t: u64 = f.next().and_then(|x| x.parse().ok()).unwrap_or(0);
                let poll = f.next().unwrap_or("?").to_string();
                // A window that spans a poll change mixes two settings; ignore the first line after a change.
                if let Some((at, tick, prev)) = &last {
                    let ups = (t - tick) as f64 / at.elapsed().as_secs_f64();
                    let note = if *prev == poll { "" } else { "  (poll changed in this window, ignore)" };
                    println!("tick {t}: poll {poll:>2}: {ups:.1} UPS{note}");
                }
                last = Some((Instant::now(), t, poll));
            } else {
                show(&d);
            }
        }
    }
}

/// Chunk a snapshot, pace it, then resend what the mod reports missing.
fn cmd_full(c: &Ctx, args: &[String]) {
    let path = opt_s(args, "--file").expect("--file <snapshot.json>");
    let data = fs::read(&path).unwrap();
    assert!(data.is_ascii(), "snapshot must be ASCII so a byte split is safe");
    let chunk: usize = opt(args, "--chunk", 60000);
    let per_batch: usize = opt(args, "--per-batch", 2); // chunks per pause
    let pause: u64 = opt(args, "--pause-ms", 50);
    let id: usize = opt(args, "--id", 1);
    let chunks: Vec<&[u8]> = data.chunks(chunk).collect();
    let send_chunk = |i: usize| {
        let mut d = format!("chunk|{id}|{i}|{}|{}\n", chunks.len(), adler32(chunks[i])).into_bytes();
        d.extend_from_slice(chunks[i]);
        c.send(&d);
    };
    println!("{} B in {} chunks of up to {chunk} B, {per_batch} per {pause} ms; adler32 {}", data.len(), chunks.len(), adler32(&data));
    let t0 = Instant::now();
    for i in 0..chunks.len() {
        send_chunk(i);
        if (i + 1) % per_batch == 0 {
            thread::sleep(Duration::from_millis(pause));
        }
    }
    for round in 0..5 {
        thread::sleep(Duration::from_millis(500));
        c.send(format!("chunkend|{id}").as_bytes());
        match c.expect("ack", Duration::from_secs(30)) {
            Some(r) => {
                let f: Vec<&str> = r.split('|').collect();
                match f[2] {
                    "ok" => {
                        println!("ack after {:?} (round {round}): mod len {} (sent {}), checksum {} (sent {}), blocks {}, rows {}, re-encoded {} B, encode_string {} B, decode_string round trip {}", t0.elapsed(), f[3], data.len(), if f[4] == adler32(&data).to_string() { "OK" } else { "MISMATCH" }, adler32(&data), f[5], f[6], f[7], f[8], f[9]);
                        println!("see /probe timings (decode, encode) in the game chat and factorio-current.log");
                        return;
                    }
                    "missing" => {
                        let miss: Vec<usize> = f[3].split(',').filter_map(|x| x.parse().ok()).collect();
                        println!("round {round}: mod is missing {} chunks {:?}; resending", miss.len(), miss);
                        for i in miss {
                            send_chunk(i);
                            thread::sleep(Duration::from_millis(pause));
                        }
                    }
                    other => {
                        println!("ack status {other}: {r}");
                        return;
                    }
                }
            }
            None => println!("round {round}: no ack in 30 s"),
        }
    }
}

fn main() {
    let args: Vec<String> = env::args().skip(1).collect();
    let game_port: u16 = opt(&args, "--game-port", 34198);
    let port: u16 = opt(&args, "--port", 34199);
    let sock = UdpSocket::bind(("127.0.0.1", port)).unwrap_or_else(|e| panic!("cannot bind {port}: {e}"));
    let c = Ctx { sock, game: format!("127.0.0.1:{game_port}") };
    let cmd = args.first().cloned().unwrap_or("listen".into());
    match cmd.as_str() {
        "size" => cmd_size(&c, &args),
        "bin" => cmd_bin(&c),
        "seq" => cmd_seq(&c, &args),
        "flood" => cmd_flood(&c, &args),
        "ping" => cmd_ping(&c, &args),
        "full" => cmd_full(&c, &args),
        "reset" => c.send(b"reset|0"),
        "listen" => cmd_listen(&c),
        other => {
            eprintln!("unknown command {other:?}; use size, bin, seq, flood, ping, full, reset or listen");
            std::process::exit(2);
        }
    }
}
