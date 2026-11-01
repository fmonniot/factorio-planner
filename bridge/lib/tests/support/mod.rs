//! Helpers shared by the integration tests: the contract fixtures, a manual clock and a way to read what the bridge sent.
#![allow(dead_code)]

pub mod fake_mod;

use std::path::PathBuf;
use std::time::{Duration, Instant};

use bridge_lib::Bridge;
use bridge_lib::protocol::{BridgeInbound, BridgeMessage, SnapshotId, parse_bridge_datagram};
use serde_json::Value;

pub fn hex_decode(text: &str) -> Vec<u8> {
    assert!(text.len().is_multiple_of(2), "odd hexadecimal length");
    (0..text.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&text[i..i + 2], 16).expect("hexadecimal"))
        .collect()
}

pub fn datagram_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../contract/datagrams")
}

pub fn read_json(name: &str) -> Value {
    let path = datagram_dir().join(name);
    let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
    serde_json::from_str(&text).unwrap_or_else(|e| panic!("{}: {e}", path.display()))
}

pub fn id(text: &str) -> SnapshotId {
    text.parse().unwrap_or_else(|_| panic!("bad id {text}"))
}

/// A clock the test moves by hand.
#[derive(Clone, Copy)]
pub struct Clock {
    pub now: Instant,
}

impl Clock {
    pub fn new() -> Self {
        Self { now: Instant::now() }
    }

    pub fn advance(&mut self, by: Duration) -> Instant {
        self.now += by;
        self.now
    }

    pub fn ms(&mut self, ms: u64) -> Instant {
        self.advance(Duration::from_millis(ms))
    }

    pub fn secs(&mut self, s: u64) -> Instant {
        self.advance(Duration::from_secs(s))
    }
}

/// What the bridge sent, sorted by kind.
#[derive(Debug, Default, Clone, PartialEq)]
pub struct Sent {
    pub pings: Vec<Option<SnapshotId>>,
    pub probes: Vec<(SnapshotId, u16, u32)>,
    /// `(index, payload length)` of each chunk, in send order.
    pub chunks: Vec<(u16, usize)>,
    /// `(round, upto)` of each end-of-window.
    pub eows: Vec<(u16, u16)>,
    /// Every datagram in order, for tests that care about the interleaving: one letter each.
    pub order: String,
    pub raw: Vec<Vec<u8>>,
}

pub fn drain(bridge: &mut Bridge) -> Sent {
    let mut sent = Sent::default();
    while let Some(datagram) = bridge.poll_transmit() {
        sent.absorb(datagram);
    }
    sent
}

impl Sent {
    pub fn absorb(&mut self, datagram: Vec<u8>) {
        match parse_bridge_datagram(&datagram) {
            Some(BridgeInbound::Message(BridgeMessage::Ping { newest })) => {
                self.pings.push(newest);
                self.order.push('P');
            }
            Some(BridgeInbound::Message(BridgeMessage::Probe { id, count, bytes })) => {
                assert_eq!(datagram.len(), 8_042, "a probe is always a full datagram");
                self.probes.push((id, count, bytes));
                self.order.push('W');
            }
            Some(BridgeInbound::Message(BridgeMessage::Chunk { index, payload, .. })) => {
                self.chunks.push((index, payload.len()));
                self.order.push('C');
            }
            Some(BridgeInbound::Message(BridgeMessage::EndOfWindow { round, upto, .. })) => {
                self.eows.push((round, upto));
                self.order.push('E');
            }
            other => panic!("the bridge sent something a mod would drop: {other:?}"),
        }
        self.raw.push(datagram);
    }

    pub fn merge(&mut self, other: Sent) {
        self.pings.extend(other.pings);
        self.probes.extend(other.probes);
        self.chunks.extend(other.chunks);
        self.eows.extend(other.eows);
        self.order.push_str(&other.order);
        self.raw.extend(other.raw);
    }

    pub fn chunk_indices(&self) -> Vec<u16> {
        self.chunks.iter().map(|&(i, _)| i).collect()
    }

    pub fn is_empty(&self) -> bool {
        self.raw.is_empty()
    }
}
