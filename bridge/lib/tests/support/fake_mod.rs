//! A fake Factorio mod: a UDP socket on loopback that plays the mod's part of `spec/in-game-viewer-protocol.md`, and the game around it.
//!
//! The mod side follows the Reassembly tables and the answer slot. The game side models what the spike measured:
//!
//! - a fresh socket loses the first datagram larger than its buffer, once per doubling ([`FakeMod::growth_losses`]);
//! - the receive buffer holds about 262,144 B and each datagram costs about 92 B on top of its size; what does not fit is dropped
//!   whole and silently, until the next `recv_udp` ([`FakeMod::capacity`], [`FakeMod::fill`]);
//! - a paused game does not poll, so its buffer only grows ([`FakeMod::pause`]);
//! - a save load reopens the socket and loses the reassembly but keeps `storage` ([`FakeMod::reload`]);
//! - packets can arrive in another order ([`FakeMod::reorder`]).
//!
//! Time is virtual: the test passes `now` to every call, and the mod polls every 166 ms (10 ticks) and flushes its answer
//! slot 33 ms (2 ticks) after the poll.

use std::collections::VecDeque;
use std::net::{SocketAddr, UdpSocket};
use std::time::{Duration, Instant};

use bridge_lib::protocol::{
    BridgeInbound, BridgeMessage, MAX_REPORT_RANGES, ModMessage, SnapshotId, parse_bridge_datagram,
};

pub const POLL: Duration = Duration::from_millis(166);
pub const FLUSH_AFTER: Duration = Duration::from_millis(33);
/// The buffer cost of a datagram on top of its own size, from the two bursts of the spike.
pub const OVERHEAD: usize = 92;
/// What a small datagram may cost instead: the only small-datagram measurement is 192 B per 100 B datagram.
pub const PESSIMISTIC_OVERHEAD: usize = 192;
pub const BUFFER: usize = 262_144;

struct Assembly {
    id: SnapshotId,
    count: u16,
    bytes: u32,
    chunks: Vec<Option<Vec<u8>>>,
}

pub struct FakeMod {
    socket: UdpSocket,
    bridge: SocketAddr,

    // The game around the mod.
    buffered: VecDeque<Vec<u8>>,
    buffered_bytes: usize,
    /// The buffer size in bytes; shrink it to force overflows.
    pub capacity: usize,
    /// The buffer cost of each datagram on top of its size: [`OVERHEAD`] or [`PESSIMISTIC_OVERHEAD`].
    pub overhead: usize,
    /// Datagrams above 4 KiB that a fresh socket still loses (one per doubling: 1 is the optimistic reading, 2 the pessimistic).
    pub growth_losses: usize,
    growth_left: usize,
    pub paused: bool,
    /// Swap neighbouring datagrams of a poll's batch at random, with this seed.
    pub reorder: Option<u64>,
    next_poll: Instant,
    flush_at: Option<Instant>,

    // The mod.
    pub stored: Option<(SnapshotId, u16)>,
    /// The accepted snapshot bytes (a stand-in for `storage`).
    pub stored_bytes: Option<Vec<u8>>,
    assembling: Option<Assembly>,
    slot: Option<Vec<u8>>,
    pub newest: Option<SnapshotId>,
    /// What the id check finds missing in an accepted snapshot.
    pub unknown_ids: u16,

    // What happened, for assertions.
    pub lost_to_growth: usize,
    pub lost_to_overflow: usize,
    pub duplicates: usize,
    pub probes_seen: usize,
    pub chunks_taken: usize,
    pub sent: Vec<char>,
    pub polls: usize,
    rng: u64,
}

impl FakeMod {
    pub fn new(bridge: SocketAddr, now: Instant) -> Self {
        let socket = UdpSocket::bind("127.0.0.1:0").expect("bind the game's socket");
        socket.set_nonblocking(true).unwrap();
        Self {
            socket,
            bridge,
            buffered: VecDeque::new(),
            buffered_bytes: 0,
            capacity: BUFFER,
            overhead: OVERHEAD,
            growth_losses: 1,
            growth_left: 1,
            paused: false,
            reorder: None,
            next_poll: now,
            flush_at: None,
            stored: None,
            stored_bytes: None,
            assembling: None,
            slot: None,
            newest: None,
            unknown_ids: 0,
            lost_to_growth: 0,
            lost_to_overflow: 0,
            duplicates: 0,
            probes_seen: 0,
            chunks_taken: 0,
            sent: Vec::new(),
            polls: 0,
            rng: 0,
        }
    }

    /// The port the bridge sends to.
    pub fn game_addr(&self) -> SocketAddr {
        self.socket.local_addr().unwrap()
    }

    pub fn pause(&mut self) {
        self.paused = true;
    }

    pub fn resume(&mut self, now: Instant) {
        self.paused = false;
        self.next_poll = now;
    }

    /// A save load: the socket reopens (small again, empty), the reassembly and the slot are lost, `storage` stays.
    pub fn reload(&mut self, now: Instant) {
        self.buffered.clear();
        self.buffered_bytes = 0;
        self.growth_left = self.growth_losses;
        self.assembling = None;
        self.slot = None;
        self.newest = None;
        self.flush_at = None;
        self.next_poll = now;
    }

    pub fn buffered_bytes(&self) -> usize {
        self.buffered_bytes
    }

    pub fn is_assembling(&self) -> bool {
        self.assembling.is_some()
    }

    pub fn have(&self) -> Vec<u16> {
        self.assembling.as_ref().map_or_else(Vec::new, |a| {
            a.chunks
                .iter()
                .enumerate()
                .filter(|(_, c)| c.is_some())
                .map(|(i, _)| u16::try_from(i).unwrap())
                .collect()
        })
    }

    pub fn is_stale(&self) -> bool {
        match (&self.stored, &self.newest) {
            (Some((stored, _)), Some(newest)) => stored != newest,
            _ => false,
        }
    }

    pub fn next_wakeup(&self) -> Option<Instant> {
        if self.paused {
            return None;
        }
        Some(self.flush_at.map_or(self.next_poll, |f| f.min(self.next_poll)))
    }

    /// One step at `now`: the kernel hands over `expect` datagrams the bridge sent (the test knows how many), the game's
    /// socket takes or loses them, and the mod polls and flushes when due. Returns how many datagrams the mod sent.
    pub fn step(&mut self, now: Instant, expect: usize) -> usize {
        self.take_from_socket(expect);
        let mut sent = 0;
        if !self.paused && now >= self.next_poll {
            self.poll(now);
        }
        if !self.paused
            && let Some(at) = self.flush_at
            && now >= at
        {
            self.flush_at = None;
            if let Some(answer) = self.slot.take() {
                self.sent.push(char::from(answer[5]));
                self.socket.send_to(&answer, self.bridge).expect("send to the bridge");
                sent = 1;
            }
        }
        sent
    }

    fn take_from_socket(&mut self, expect: usize) {
        let mut buffer = vec![0_u8; 65_536];
        let mut received = 0;
        loop {
            if received < expect {
                self.socket.set_nonblocking(false).unwrap();
                self.socket.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
            } else {
                self.socket.set_nonblocking(true).unwrap();
            }
            match self.socket.recv_from(&mut buffer) {
                Ok((n, _)) => {
                    received += 1;
                    self.arrive(buffer[..n].to_vec());
                }
                Err(e) if matches!(e.kind(), std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut) => {
                    assert!(
                        received >= expect,
                        "the bridge sent {expect} datagrams but only {received} arrived"
                    );
                    break;
                }
                Err(e) => panic!("the game's socket failed: {e}"),
            }
        }
        self.socket.set_nonblocking(true).unwrap();
    }

    /// A datagram reaches the game's socket.
    fn arrive(&mut self, datagram: Vec<u8>) {
        if self.growth_left > 0 && datagram.len() > 4_096 {
            self.growth_left -= 1;
            self.lost_to_growth += 1;
            return;
        }
        if self.buffered_bytes + datagram.len() + self.overhead > self.capacity {
            self.lost_to_overflow += 1;
            return;
        }
        self.buffered_bytes += datagram.len() + self.overhead;
        self.buffered.push_back(datagram);
    }

    /// `recv_udp`: the whole buffer is handed to the handler, then emptied.
    fn poll(&mut self, now: Instant) {
        self.polls += 1;
        self.next_poll = now + POLL;
        let mut batch: Vec<Vec<u8>> = self.buffered.drain(..).collect();
        self.buffered_bytes = 0;
        if let Some(seed) = self.reorder {
            for i in 1..batch.len() {
                self.rng = self
                    .rng
                    .wrapping_mul(6_364_136_223_846_793_005)
                    .wrapping_add(1_442_695_040_888_963_407 ^ seed);
                if (self.rng >> 33) & 1 == 1 {
                    batch.swap(i - 1, i);
                }
            }
        }
        for datagram in &batch {
            self.handle(datagram);
        }
        self.flush_at = Some(now + FLUSH_AFTER);
    }

    // -----------------------------------------------------------------------------------------
    // The packet handler: the Reassembly tables of spec/in-game-viewer-protocol.md
    // -----------------------------------------------------------------------------------------

    fn answer(&mut self, message: &ModMessage) {
        self.slot = Some(message.encode());
    }

    fn hello(&mut self) {
        if self.slot.is_none() {
            let hello = ModMessage::Hello {
                stored: self.stored.map(|(id, _)| id),
                unknown_ids: self.stored.map_or(0, |(_, n)| n),
                assembling: self.assembling.as_ref().map(|a| a.id),
            };
            self.answer(&hello);
        }
    }

    fn ack(&mut self, id: SnapshotId) {
        let unknown_ids = self.stored.map_or(0, |(_, n)| n);
        self.answer(&ModMessage::Ack { id, unknown_ids });
    }

    fn handle(&mut self, datagram: &[u8]) {
        match parse_bridge_datagram(datagram) {
            None => {}
            Some(BridgeInbound::OtherVersion(_)) => self.hello(),
            Some(BridgeInbound::Message(message)) => match message {
                BridgeMessage::Ping { newest } => {
                    self.newest = newest;
                    self.hello();
                }
                BridgeMessage::Probe { id, count, bytes } => self.on_probe(id, count, bytes),
                BridgeMessage::Chunk {
                    id,
                    index,
                    count,
                    bytes,
                    payload,
                } => self.on_chunk(id, index, count, bytes, payload),
                BridgeMessage::EndOfWindow { id, round, upto } => self.on_end_of_window(id, round, upto),
            },
        }
    }

    fn on_probe(&mut self, id: SnapshotId, count: u16, bytes: u32) {
        self.probes_seen += 1;
        if self.stored.is_some_and(|(stored, _)| stored == id) {
            self.assembling = None;
            self.ack(id);
        } else if self.assembling.as_ref().is_some_and(|a| a.id == id) {
            self.answer(&ModMessage::Ready { id });
        } else {
            self.assembling = Some(Assembly {
                id,
                count,
                bytes,
                chunks: vec![None; usize::from(count)],
            });
            self.answer(&ModMessage::Ready { id });
        }
    }

    fn on_chunk(&mut self, id: SnapshotId, index: u16, count: u16, bytes: u32, payload: &[u8]) {
        let Some(assembly) = &mut self.assembling else {
            return;
        };
        if assembly.id != id || assembly.count != count || assembly.bytes != bytes {
            return;
        }
        let slot = &mut assembly.chunks[usize::from(index)];
        if slot.is_some() {
            self.duplicates += 1;
            return;
        }
        *slot = Some(payload.to_vec());
        self.chunks_taken += 1;
        if assembly.chunks.iter().all(Option::is_some) {
            self.finish();
        }
    }

    fn finish(&mut self) {
        let assembly = self.assembling.take().expect("finishing needs an assembly");
        let joined: Vec<u8> = assembly.chunks.into_iter().flatten().flatten().collect();
        let id = assembly.id;
        let refuse = |this: &mut Self, reason: &str| {
            this.answer(&ModMessage::Refusal {
                id,
                reason: reason.to_owned(),
            });
        };
        if joined.len() != assembly.bytes as usize {
            return refuse(self, "length");
        }
        // The fake's stand-in for `json_to_table`: a snapshot is a JSON object.
        if joined.first() != Some(&b'{') || joined.last() != Some(&b'}') {
            return refuse(self, "json");
        }
        self.stored = Some((id, self.unknown_ids));
        self.stored_bytes = Some(joined);
        self.ack(id);
    }

    fn on_end_of_window(&mut self, id: SnapshotId, round: u16, upto: u16) {
        if self.stored.is_some_and(|(stored, _)| stored == id) {
            self.ack(id);
            return;
        }
        let Some(assembly) = &self.assembling else {
            return;
        };
        if assembly.id != id || upto > assembly.count {
            return;
        }
        let mut ranges: Vec<(u16, u16)> = Vec::new();
        for index in 0..upto {
            if assembly.chunks[usize::from(index)].is_some() {
                continue;
            }
            if let Some((_, last)) = ranges.last_mut()
                && *last + 1 == index
            {
                *last = index;
            } else if ranges.len() == MAX_REPORT_RANGES {
                break;
            } else {
                ranges.push((index, index));
            }
        }
        self.answer(&ModMessage::Missing { id, round, ranges });
    }
}

/// A snapshot-shaped payload of `len` bytes: a JSON object, filled with bytes that vary so that a misplaced chunk shows.
pub fn snapshot_bytes(len: usize, seed: u8) -> Vec<u8> {
    assert!(len >= 2);
    let mut bytes = Vec::with_capacity(len);
    bytes.push(b'{');
    let mut state = u32::from(seed) + 1;
    while bytes.len() < len - 1 {
        state = state.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
        bytes.push(b'a' + u8::try_from((state >> 24) % 26).unwrap());
    }
    bytes.push(b'}');
    bytes
}
