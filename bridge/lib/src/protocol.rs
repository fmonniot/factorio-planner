//! The UDP wire formats between the bridge and the mod, and the constants shared by every layer.
//!
//! The authoritative description is `spec/in-game-viewer-protocol.md` and the shared fixtures in `contract/datagrams/`.
//! Bridge-to-mod datagrams are fixed-width ASCII headers (see [`BridgeMessage`]); mod-to-bridge datagrams are short space-separated
//! ASCII strings (see [`ModMessage`]). Both directions have an encoder and a strict parser: a parser returns `None` for anything
//! that breaks the rules, and the caller drops it without changing state.
//!
//! The bridge only needs the mod-to-bridge parser and the bridge-to-mod encoders. The other two halves exist so that tests can play
//! the mod (`parse_bridge_datagram`) and check the encoders against the fixtures (`ModMessage::encode`).

use std::fmt;
use std::str::FromStr;
use std::time::Duration;

use serde::{Deserialize, Deserializer, Serialize, Serializer};

/// The protocol version spoken by this crate, written `FP01` on the wire.
pub const PROTOCOL_VERSION: u8 = 1;
/// The six bytes every datagram starts with (`FP`, version digits, space, type letter).
pub const PREFIX_LEN: usize = 6;

/// The largest payload of a chunk.
pub const CHUNK_PAYLOAD: usize = 8_000;
/// The header of a chunk datagram.
pub const CHUNK_HEADER: usize = 42;
/// A full chunk datagram, and the size of every probe.
pub const MAX_DATAGRAM: usize = CHUNK_HEADER + CHUNK_PAYLOAD;
/// The part of a probe a reader looks at; the rest is padding.
pub const PROBE_HEADER: usize = 37;
/// A ping.
pub const PING_BYTES: usize = 23;
/// An end-of-window datagram.
pub const EOW_BYTES: usize = 33;
/// The envelope in front of a snapshot in a WebSocket frame.
pub const WS_ENVELOPE: usize = 32;

/// Chunks in one window.
pub const WINDOW_CHUNKS: usize = 24;
/// Chunks sent per pacing slot.
pub const PACE_CHUNKS: usize = 4;
/// Time between pacing slots.
pub const PACE_INTERVAL: Duration = Duration::from_millis(20);
/// Most chunks a snapshot may have.
pub const MAX_CHUNKS: u16 = 1_000;
/// Largest snapshot, in bytes.
pub const MAX_SNAPSHOT_BYTES: usize = 8_000_000;
/// Largest WebSocket frame the bridge must accept.
pub const MAX_FRAME_BYTES: usize = WS_ENVELOPE + 9_999_999;
/// Most ranges in a missing report.
pub const MAX_REPORT_RANGES: usize = 12;
/// Largest unknown-id count; it saturates here.
pub const MAX_UNKNOWN_IDS: u16 = 9_999;

/// Time between probes of one burst.
pub const PROBE_INTERVAL: Duration = Duration::from_millis(250);
/// Probes in one burst.
pub const PROBE_BURST: u8 = 3;
/// A hello heard longer after the last probe than this refills the probe budget.
pub const PROBE_REFILL_AFTER: Duration = Duration::from_millis(1_000);
/// Base ping interval.
pub const PING_INTERVAL: Duration = Duration::from_secs(5);
/// Longest ping interval.
pub const PING_INTERVAL_MAX: Duration = Duration::from_secs(300);
/// The ping interval is the silence divided by this, within the two limits above.
pub const PING_BACKOFF_DIVISOR: u32 = 16;
/// A mod that has not spoken for this long is `quiet`.
pub const QUIET_AFTER: Duration = Duration::from_secs(15);
/// Fruitless reports (or unanswered probe bursts) in a row before the bridge gives up.
pub const NO_PROGRESS_LIMIT: u32 = 8;

/// The chunk count of a snapshot of `bytes` bytes cut every `chunk_size` bytes.
///
/// # Panics
/// If `chunk_size` is 0.
#[must_use]
pub fn chunk_count(bytes: usize, chunk_size: usize) -> usize {
    bytes.div_ceil(chunk_size)
}

/// A snapshot id: 16 lowercase hexadecimal characters.
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
pub struct SnapshotId([u8; 16]);

impl SnapshotId {
    /// Reads an id from exactly 16 bytes of `0-9a-f`.
    #[must_use]
    pub fn parse(bytes: &[u8]) -> Option<Self> {
        let array: [u8; 16] = bytes.try_into().ok()?;
        array
            .iter()
            .all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
            .then_some(Self(array))
    }

    /// The id as the 16 ASCII bytes it is written with.
    #[must_use]
    pub fn as_bytes(&self) -> &[u8; 16] {
        &self.0
    }

    /// The id as text.
    #[must_use]
    pub fn as_str(&self) -> &str {
        // The bytes were checked to be ASCII in `parse`.
        std::str::from_utf8(&self.0).expect("a snapshot id is ASCII")
    }
}

impl fmt::Display for SnapshotId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

impl fmt::Debug for SnapshotId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "SnapshotId({})", self.as_str())
    }
}

/// The text is not a snapshot id.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BadSnapshotId;

impl fmt::Display for BadSnapshotId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("a snapshot id is 16 characters of 0-9a-f")
    }
}

impl std::error::Error for BadSnapshotId {}

impl FromStr for SnapshotId {
    type Err = BadSnapshotId;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        Self::parse(s.as_bytes()).ok_or(BadSnapshotId)
    }
}

impl Serialize for SnapshotId {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(self.as_str())
    }
}

impl<'de> Deserialize<'de> for SnapshotId {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let text = String::deserialize(deserializer)?;
        text.parse().map_err(serde::de::Error::custom)
    }
}

const NO_ID: &[u8; 16] = b"----------------";

fn push_id_field(out: &mut Vec<u8>, id: Option<&SnapshotId>) {
    out.extend_from_slice(id.map_or(NO_ID.as_slice(), |id| id.as_bytes()));
}

/// An id field: an id, or the sixteen dashes of the no-id value (`Some(None)`).
fn parse_id_field(bytes: &[u8]) -> Option<Option<SnapshotId>> {
    if bytes == NO_ID {
        Some(None)
    } else {
        SnapshotId::parse(bytes).map(Some)
    }
}

/// Exactly `width` ASCII digits, zero padding allowed.
fn padded_number(bytes: &[u8], width: usize) -> Option<u32> {
    if bytes.len() != width || !bytes.iter().all(u8::is_ascii_digit) {
        return None;
    }
    Some(bytes.iter().fold(0, |n, d| n * 10 + u32::from(d - b'0')))
}

/// Up to seven ASCII digits with no leading zero (except `0` itself).
fn plain_number(bytes: &[u8]) -> Option<u32> {
    if bytes.is_empty() || bytes.len() > 7 || !bytes.iter().all(u8::is_ascii_digit) {
        return None;
    }
    if bytes.len() > 1 && bytes[0] == b'0' {
        return None;
    }
    Some(bytes.iter().fold(0, |n, d| n * 10 + u32::from(d - b'0')))
}

fn push_padded(out: &mut Vec<u8>, value: u32, width: usize) {
    out.extend_from_slice(format!("{value:0width$}").as_bytes());
}

/// `FP`, two digits, a space and an uppercase letter: the version and the type letter.
fn parse_prefix(datagram: &[u8]) -> Option<(u8, u8)> {
    let prefix = datagram.get(..PREFIX_LEN)?;
    if &prefix[..2] != b"FP" || prefix[4] != b' ' || !prefix[5].is_ascii_uppercase() {
        return None;
    }
    let version = padded_number(&prefix[2..4], 2)?;
    Some((u8::try_from(version).ok()?, prefix[5]))
}

fn push_prefix(out: &mut Vec<u8>, letter: u8) {
    out.extend_from_slice(b"FP");
    push_padded(out, u32::from(PROTOCOL_VERSION), 2);
    out.push(b' ');
    out.push(letter);
}

// ---------------------------------------------------------------------------------------------
// Bridge to mod
// ---------------------------------------------------------------------------------------------

/// A datagram the bridge sends to the mod, as a reader sees it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BridgeMessage<'a> {
    /// `P`: the planner's newest id, or none.
    Ping { newest: Option<SnapshotId> },
    /// `W`: names the snapshot to assemble; always [`MAX_DATAGRAM`] bytes on the wire.
    Probe { id: SnapshotId, count: u16, bytes: u32 },
    /// `C`: one chunk.
    Chunk {
        id: SnapshotId,
        index: u16,
        count: u16,
        bytes: u32,
        payload: &'a [u8],
    },
    /// `E`: end of window.
    EndOfWindow { id: SnapshotId, round: u16, upto: u16 },
}

/// What a mod makes of a datagram that begins like one of ours.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BridgeInbound<'a> {
    /// A valid datagram of this protocol version.
    Message(BridgeMessage<'a>),
    /// A datagram of another version: nothing after the six prefix bytes is read.
    OtherVersion(u8),
}

/// A ping: 23 bytes.
#[must_use]
pub fn encode_ping(newest: Option<&SnapshotId>) -> Vec<u8> {
    let mut out = Vec::with_capacity(PING_BYTES);
    push_prefix(&mut out, b'P');
    out.push(b' ');
    push_id_field(&mut out, newest);
    out
}

/// A probe: always [`MAX_DATAGRAM`] bytes, padded with dots.
#[must_use]
pub fn encode_probe(id: &SnapshotId, count: u16, bytes: u32) -> Vec<u8> {
    let mut out = Vec::with_capacity(MAX_DATAGRAM);
    push_prefix(&mut out, b'W');
    out.push(b' ');
    push_id_field(&mut out, Some(id));
    out.push(b' ');
    push_padded(&mut out, u32::from(count), 4);
    out.push(b' ');
    push_padded(&mut out, bytes, 7);
    out.push(b' ');
    out.resize(MAX_DATAGRAM, b'.');
    out
}

/// A chunk: 42 bytes of header and the payload.
#[must_use]
pub fn encode_chunk(id: &SnapshotId, index: u16, count: u16, bytes: u32, payload: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(CHUNK_HEADER + payload.len());
    push_prefix(&mut out, b'C');
    out.push(b' ');
    push_id_field(&mut out, Some(id));
    out.push(b' ');
    push_padded(&mut out, u32::from(index), 4);
    out.push(b' ');
    push_padded(&mut out, u32::from(count), 4);
    out.push(b' ');
    push_padded(&mut out, bytes, 7);
    out.push(b' ');
    out.extend_from_slice(payload);
    out
}

/// An end-of-window datagram: 33 bytes.
#[must_use]
pub fn encode_end_of_window(id: &SnapshotId, round: u16, upto: u16) -> Vec<u8> {
    let mut out = Vec::with_capacity(EOW_BYTES);
    push_prefix(&mut out, b'E');
    out.push(b' ');
    push_id_field(&mut out, Some(id));
    out.push(b' ');
    push_padded(&mut out, u32::from(round), 4);
    out.push(b' ');
    push_padded(&mut out, u32::from(upto), 4);
    out
}

/// `count` and `bytes` agree: `count` <= `bytes` <= `count` * [`CHUNK_PAYLOAD`].
fn count_and_bytes(count: u32, bytes: u32) -> Option<(u16, u32)> {
    let max_bytes = u32::try_from(MAX_SNAPSHOT_BYTES).ok()?;
    let count_u16 = u16::try_from(count).ok()?;
    let payload_cap = u64::from(count) * CHUNK_PAYLOAD as u64;
    if !(1..=u32::from(MAX_CHUNKS)).contains(&count)
        || !(1..=max_bytes).contains(&bytes)
        || bytes < count
        || u64::from(bytes) > payload_cap
    {
        return None;
    }
    Some((count_u16, bytes))
}

/// Reads a datagram the way the mod does. Returns `None` for anything the mod would drop.
///
/// A datagram of another version that begins with a valid prefix comes back as [`BridgeInbound::OtherVersion`], whatever its type.
#[must_use]
pub fn parse_bridge_datagram(datagram: &[u8]) -> Option<BridgeInbound<'_>> {
    let (version, letter) = parse_prefix(datagram)?;
    if version != PROTOCOL_VERSION {
        return Some(BridgeInbound::OtherVersion(version));
    }
    let message = match letter {
        b'P' => {
            if datagram.len() != PING_BYTES || datagram[6] != b' ' {
                return None;
            }
            BridgeMessage::Ping {
                newest: parse_id_field(&datagram[7..23])?,
            }
        }
        b'W' => {
            if datagram.len() < PROBE_HEADER
                || datagram[6] != b' '
                || datagram[23] != b' '
                || datagram[28] != b' '
                || datagram[36] != b' '
            {
                return None;
            }
            let id = SnapshotId::parse(&datagram[7..23])?;
            let count = padded_number(&datagram[24..28], 4)?;
            let bytes = padded_number(&datagram[29..36], 7)?;
            let (count, bytes) = count_and_bytes(count, bytes)?;
            BridgeMessage::Probe { id, count, bytes }
        }
        b'C' => {
            if datagram.len() <= CHUNK_HEADER
                || datagram.len() > MAX_DATAGRAM
                || datagram[6] != b' '
                || datagram[23] != b' '
                || datagram[28] != b' '
                || datagram[33] != b' '
                || datagram[41] != b' '
            {
                return None;
            }
            let id = SnapshotId::parse(&datagram[7..23])?;
            let index = padded_number(&datagram[24..28], 4)?;
            let count = padded_number(&datagram[29..33], 4)?;
            let bytes = padded_number(&datagram[34..41], 7)?;
            let (count, bytes) = count_and_bytes(count, bytes)?;
            if index >= u32::from(count) {
                return None;
            }
            BridgeMessage::Chunk {
                id,
                index: u16::try_from(index).ok()?,
                count,
                bytes,
                payload: &datagram[CHUNK_HEADER..],
            }
        }
        b'E' => {
            if datagram.len() != EOW_BYTES || datagram[6] != b' ' || datagram[23] != b' ' || datagram[28] != b' ' {
                return None;
            }
            let id = SnapshotId::parse(&datagram[7..23])?;
            let round = padded_number(&datagram[24..28], 4)?;
            let upto = padded_number(&datagram[29..33], 4)?;
            if !(1..=u32::from(MAX_CHUNKS)).contains(&upto) {
                return None;
            }
            BridgeMessage::EndOfWindow {
                id,
                round: u16::try_from(round).ok()?,
                upto: u16::try_from(upto).ok()?,
            }
        }
        _ => return None,
    };
    Some(BridgeInbound::Message(message))
}

// ---------------------------------------------------------------------------------------------
// Mod to bridge
// ---------------------------------------------------------------------------------------------

/// A datagram the mod sends to the bridge.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ModMessage {
    /// `H`: the mod's whole state.
    Hello {
        stored: Option<SnapshotId>,
        unknown_ids: u16,
        assembling: Option<SnapshotId>,
    },
    /// `R`: the mod took this snapshot as its reassembly target.
    Ready { id: SnapshotId },
    /// `M`: the chunks not yet held below the end-of-window's `upto`, as inclusive `(first, last)` ranges; empty means none.
    Missing {
        id: SnapshotId,
        round: u16,
        ranges: Vec<(u16, u16)>,
    },
    /// `A`: the mod stores this snapshot.
    Ack { id: SnapshotId, unknown_ids: u16 },
    /// `N`: the mod finished reassembling this snapshot and refused it; `reason` is a lowercase word.
    Refusal { id: SnapshotId, reason: String },
}

/// What the bridge makes of a datagram from the mod.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Inbound {
    /// A valid message of this protocol version.
    Mod(ModMessage),
    /// A hello of another version: it counts as hearing the mod, and nothing after the six prefix bytes is read.
    OtherVersionHello(u8),
}

impl ModMessage {
    /// The bytes the mod sends. Useful for fakes and for checking the parser against the fixtures.
    #[must_use]
    pub fn encode(&self) -> Vec<u8> {
        let mut out = Vec::new();
        match self {
            Self::Hello {
                stored,
                unknown_ids,
                assembling,
            } => {
                push_prefix(&mut out, b'H');
                out.push(b' ');
                push_id_field(&mut out, stored.as_ref());
                out.extend_from_slice(format!(" {unknown_ids} ").as_bytes());
                push_id_field(&mut out, assembling.as_ref());
            }
            Self::Ready { id } => {
                push_prefix(&mut out, b'R');
                out.push(b' ');
                push_id_field(&mut out, Some(id));
            }
            Self::Missing { id, round, ranges } => {
                push_prefix(&mut out, b'M');
                out.push(b' ');
                push_id_field(&mut out, Some(id));
                out.push(b' ');
                push_padded(&mut out, u32::from(*round), 4);
                out.push(b' ');
                if ranges.is_empty() {
                    out.push(b'-');
                }
                for (i, (first, last)) in ranges.iter().enumerate() {
                    if i > 0 {
                        out.push(b',');
                    }
                    if first == last {
                        out.extend_from_slice(first.to_string().as_bytes());
                    } else {
                        out.extend_from_slice(format!("{first}-{last}").as_bytes());
                    }
                }
            }
            Self::Ack { id, unknown_ids } => {
                push_prefix(&mut out, b'A');
                out.push(b' ');
                push_id_field(&mut out, Some(id));
                out.extend_from_slice(format!(" {unknown_ids}").as_bytes());
            }
            Self::Refusal { id, reason } => {
                push_prefix(&mut out, b'N');
                out.push(b' ');
                push_id_field(&mut out, Some(id));
                out.extend_from_slice(format!(" {reason}").as_bytes());
            }
        }
        out
    }
}

fn parse_unknown_ids(field: &[u8]) -> Option<u16> {
    let n = plain_number(field)?;
    if n > u32::from(MAX_UNKNOWN_IDS) {
        return None;
    }
    u16::try_from(n).ok()
}

fn parse_chunk_index(field: &[u8]) -> Option<u16> {
    let n = plain_number(field)?;
    if n >= u32::from(MAX_CHUNKS) {
        return None;
    }
    u16::try_from(n).ok()
}

/// `-`, or comma-separated entries (`7` or `3-5`), ascending, apart from each other, at most [`MAX_REPORT_RANGES`] of them.
fn parse_ranges(field: &[u8]) -> Option<Vec<(u16, u16)>> {
    if field == b"-" {
        return Some(Vec::new());
    }
    let mut ranges: Vec<(u16, u16)> = Vec::new();
    for entry in field.split(|&c| c == b',') {
        let (first, last) = match entry.iter().position(|&c| c == b'-') {
            None => {
                let n = parse_chunk_index(entry)?;
                (n, n)
            }
            Some(dash) => {
                let first = parse_chunk_index(&entry[..dash])?;
                let last = parse_chunk_index(&entry[dash + 1..])?;
                if last <= first {
                    return None;
                }
                (first, last)
            }
        };
        if let Some(&(_, previous_last)) = ranges.last()
            && first <= previous_last + 1
        {
            return None;
        }
        ranges.push((first, last));
        if ranges.len() > MAX_REPORT_RANGES {
            return None;
        }
    }
    Some(ranges)
}

fn parse_reason(field: &[u8]) -> Option<String> {
    if field.is_empty() || field.len() > 16 || !field.iter().all(u8::is_ascii_lowercase) {
        return None;
    }
    String::from_utf8(field.to_vec()).ok()
}

/// Reads a datagram the way the bridge does. Returns `None` for anything the bridge drops.
#[must_use]
pub fn parse_mod_datagram(datagram: &[u8]) -> Option<Inbound> {
    let (version, letter) = parse_prefix(datagram)?;
    if version != PROTOCOL_VERSION {
        return (letter == b'H').then_some(Inbound::OtherVersionHello(version));
    }
    let rest = datagram[PREFIX_LEN..].strip_prefix(b" ")?;
    let fields: Vec<&[u8]> = rest.split(|&c| c == b' ').collect();
    let message = match (letter, fields.as_slice()) {
        (b'H', [stored, unknown, assembling]) => ModMessage::Hello {
            stored: parse_id_field(stored)?,
            unknown_ids: parse_unknown_ids(unknown)?,
            assembling: parse_id_field(assembling)?,
        },
        (b'R', [id]) => ModMessage::Ready {
            id: SnapshotId::parse(id)?,
        },
        (b'M', [id, round, ranges]) => ModMessage::Missing {
            id: SnapshotId::parse(id)?,
            round: u16::try_from(padded_number(round, 4)?).ok()?,
            ranges: parse_ranges(ranges)?,
        },
        (b'A', [id, unknown]) => ModMessage::Ack {
            id: SnapshotId::parse(id)?,
            unknown_ids: parse_unknown_ids(unknown)?,
        },
        (b'N', [id, reason]) => ModMessage::Refusal {
            id: SnapshotId::parse(id)?,
            reason: parse_reason(reason)?,
        },
        _ => return None,
    };
    Some(Inbound::Mod(message))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn id() -> SnapshotId {
        "9b3b078dbd018b94".parse().unwrap()
    }

    #[test]
    fn ids_are_sixteen_lowercase_hex_characters() {
        assert!("9b3b078dbd018b94".parse::<SnapshotId>().is_ok());
        assert!("9B3B078DBD018B94".parse::<SnapshotId>().is_err());
        assert!("9b3b078dbd018b9".parse::<SnapshotId>().is_err());
        assert!("----------------".parse::<SnapshotId>().is_err());
    }

    #[test]
    fn encoders_have_the_documented_sizes() {
        assert_eq!(encode_ping(None).len(), PING_BYTES);
        assert_eq!(encode_ping(Some(&id())).len(), PING_BYTES);
        assert_eq!(encode_probe(&id(), 5, 586).len(), MAX_DATAGRAM);
        assert_eq!(encode_end_of_window(&id(), 1, 5).len(), EOW_BYTES);
        assert_eq!(encode_chunk(&id(), 0, 1, 3, b"abc").len(), CHUNK_HEADER + 3);
    }

    #[test]
    fn a_round_trip_keeps_every_message() {
        let probe = encode_probe(&id(), 5, 586);
        assert_eq!(
            parse_bridge_datagram(&probe),
            Some(BridgeInbound::Message(BridgeMessage::Probe {
                id: id(),
                count: 5,
                bytes: 586
            }))
        );
        let chunk = encode_chunk(&id(), 2, 5, 586, b"payload\0\xff");
        assert_eq!(
            parse_bridge_datagram(&chunk),
            Some(BridgeInbound::Message(BridgeMessage::Chunk {
                id: id(),
                index: 2,
                count: 5,
                bytes: 586,
                payload: b"payload\0\xff"
            }))
        );
        let report = ModMessage::Missing {
            id: id(),
            round: 7,
            ranges: vec![(1, 1), (3, 5), (9, 9)],
        };
        assert_eq!(report.encode(), b"FP01 M 9b3b078dbd018b94 0007 1,3-5,9");
        assert_eq!(parse_mod_datagram(&report.encode()), Some(Inbound::Mod(report)));
    }

    #[test]
    fn a_hello_of_another_version_is_read_only_up_to_its_prefix() {
        assert_eq!(
            parse_mod_datagram(b"FP02 H whatever follows"),
            Some(Inbound::OtherVersionHello(2))
        );
        assert_eq!(parse_mod_datagram(b"FP02 H"), Some(Inbound::OtherVersionHello(2)));
        assert_eq!(parse_mod_datagram(b"FP02 R 9b3b078dbd018b94"), None);
    }

    #[test]
    fn numbers_with_leading_zeros_or_signs_are_dropped() {
        assert!(parse_mod_datagram(b"FP01 A 9b3b078dbd018b94 02").is_none());
        assert!(parse_mod_datagram(b"FP01 A 9b3b078dbd018b94 +2").is_none());
        assert!(parse_mod_datagram(b"FP01 A 9b3b078dbd018b94 0x2").is_none());
        assert!(parse_mod_datagram(b"FP01 A 9b3b078dbd018b94 10000").is_none());
        assert!(parse_mod_datagram(b"FP01 A 9b3b078dbd018b94 9999").is_some());
    }

    #[test]
    fn ranges_must_be_ascending_apart_and_at_most_twelve() {
        assert!(parse_ranges(b"1,3").is_some());
        assert!(parse_ranges(b"1,2").is_none(), "touching entries should be one range");
        assert!(parse_ranges(b"3-3").is_none());
        assert!(parse_ranges(b"5-3").is_none());
        assert!(parse_ranges(b"1000").is_none());
        let twelve = (0..12).map(|i| (i * 2).to_string()).collect::<Vec<_>>().join(",");
        assert_eq!(parse_ranges(twelve.as_bytes()).unwrap().len(), 12);
        let thirteen = (0..13).map(|i| (i * 2).to_string()).collect::<Vec<_>>().join(",");
        assert!(parse_ranges(thirteen.as_bytes()).is_none());
    }
}
