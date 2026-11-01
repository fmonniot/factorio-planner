//! The planner-facing messages, as bytes and text: the snapshot envelope, `announce`, and `error`.
//!
//! This is only the codec. The WebSocket endpoint, the `Origin` check and the frame limit
//! ([`MAX_FRAME_BYTES`](crate::protocol::MAX_FRAME_BYTES)) belong to the binary.
//! The bridge never parses the snapshot: it reads the 32-byte envelope and hands the rest on as opaque bytes.

use serde::Deserialize;

use crate::protocol::{MAX_SNAPSHOT_BYTES, PROTOCOL_VERSION, SnapshotId, WS_ENVELOPE};

/// The code of an `error` message.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ErrorCode {
    /// A binary frame whose envelope is malformed or whose length disagrees.
    BadEnvelope,
    /// A well-formed envelope above `MAX_SNAPSHOT_BYTES`.
    TooLarge,
    /// A binary frame or an `announce` of another protocol version.
    ProtocolMismatch,
    /// A text frame that is not JSON, has an unknown `type`, or has a bad id.
    BadMessage,
}

impl ErrorCode {
    /// The code as written in the `error` message.
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::BadEnvelope => "bad-envelope",
            Self::TooLarge => "too-large",
            Self::ProtocolMismatch => "protocol-mismatch",
            Self::BadMessage => "bad-message",
        }
    }

    /// The code named by `code`, as written in an `error` message.
    #[must_use]
    pub fn from_code(code: &str) -> Option<Self> {
        [
            Self::BadEnvelope,
            Self::TooLarge,
            Self::ProtocolMismatch,
            Self::BadMessage,
        ]
        .into_iter()
        .find(|c| c.as_str() == code)
    }

    /// The JSON text frame that carries the code.
    #[must_use]
    pub fn to_json(self) -> String {
        format!(r#"{{"type":"error","code":"{}"}}"#, self.as_str())
    }
}

/// A `snapshot` frame, decoded from its envelope alone.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SnapshotFrame<'a> {
    /// The id the planner computed.
    pub id: SnapshotId,
    /// The snapshot bytes, opaque to the bridge.
    pub bytes: &'a [u8],
}

fn envelope_layout_ok(frame: &[u8]) -> bool {
    frame.len() >= WS_ENVELOPE
        && frame[..4] == *format!("FP{PROTOCOL_VERSION:02}").as_bytes()
        && frame[4] == b' '
        && frame[5] == b'S'
        && frame[6] == b' '
        && frame[23] == b' '
        && frame[31] == b' '
}

/// Reads a binary frame. Decides from the envelope alone, in the order the protocol gives:
/// another version, a malformed envelope or a length of 0, a length above the guard, a frame of the wrong length.
///
/// # Errors
/// The [`ErrorCode`] to answer with; the bridge's state does not change.
pub fn parse_snapshot_frame(frame: &[u8]) -> Result<SnapshotFrame<'_>, ErrorCode> {
    let version_digits = frame.get(2..4).filter(|d| d.iter().all(u8::is_ascii_digit));
    if frame.len() >= 4
        && &frame[..2] == b"FP"
        && let Some(digits) = version_digits
        && digits != format!("{PROTOCOL_VERSION:02}").as_bytes()
    {
        return Err(ErrorCode::ProtocolMismatch);
    }
    if !envelope_layout_ok(frame) {
        return Err(ErrorCode::BadEnvelope);
    }
    let id = SnapshotId::parse(&frame[7..23]).ok_or(ErrorCode::BadEnvelope)?;
    let length_field = &frame[24..31];
    if !length_field.iter().all(u8::is_ascii_digit) {
        return Err(ErrorCode::BadEnvelope);
    }
    let length = length_field.iter().fold(0_usize, |n, d| n * 10 + usize::from(d - b'0'));
    if length == 0 {
        return Err(ErrorCode::BadEnvelope);
    }
    if length > MAX_SNAPSHOT_BYTES {
        return Err(ErrorCode::TooLarge);
    }
    if frame.len() != WS_ENVELOPE + length {
        return Err(ErrorCode::BadEnvelope);
    }
    Ok(SnapshotFrame {
        id,
        bytes: &frame[WS_ENVELOPE..],
    })
}

/// The binary frame a planner sends: the envelope, then the snapshot bytes. Used by tests and tools that play the planner.
///
/// # Panics
/// If `bytes` is longer than the envelope's 7 digits can state.
#[must_use]
pub fn encode_snapshot_frame(id: &SnapshotId, bytes: &[u8]) -> Vec<u8> {
    assert!(bytes.len() <= 9_999_999, "the length field has 7 digits");
    let mut frame = format!("FP{PROTOCOL_VERSION:02} S {id} {:07} ", bytes.len()).into_bytes();
    frame.extend_from_slice(bytes);
    frame
}

/// The text frame a planner sends to name its current plan without sending it.
#[must_use]
pub fn encode_announce(id: &SnapshotId) -> String {
    format!(r#"{{"type":"announce","protocol":{PROTOCOL_VERSION},"id":"{id}"}}"#)
}

/// A text frame from the planner.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PlannerText {
    /// "This is the id of the current plan, which I have not sent."
    Announce {
        /// The planner's newest id.
        id: SnapshotId,
    },
}

#[derive(Deserialize)]
struct RawText {
    #[serde(rename = "type")]
    kind: String,
    protocol: Option<serde_json::Value>,
    id: Option<serde_json::Value>,
}

/// Reads a text frame.
///
/// # Errors
/// [`ErrorCode::BadMessage`] for text that is not JSON, has an unknown `type` or a bad id,
/// and [`ErrorCode::ProtocolMismatch`] for an `announce` of another protocol version.
pub fn parse_text_frame(text: &str) -> Result<PlannerText, ErrorCode> {
    let raw: RawText = serde_json::from_str(text).map_err(|_| ErrorCode::BadMessage)?;
    if raw.kind != "announce" {
        return Err(ErrorCode::BadMessage);
    }
    match raw.protocol.as_ref().and_then(serde_json::Value::as_u64) {
        Some(v) if v == u64::from(PROTOCOL_VERSION) => {}
        Some(_) => return Err(ErrorCode::ProtocolMismatch),
        None => return Err(ErrorCode::BadMessage),
    }
    let id = raw
        .id
        .as_ref()
        .and_then(serde_json::Value::as_str)
        .and_then(|s| s.parse().ok())
        .ok_or(ErrorCode::BadMessage)?;
    Ok(PlannerText::Announce { id })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn error_codes_round_trip_through_their_names() {
        for code in [
            ErrorCode::BadEnvelope,
            ErrorCode::TooLarge,
            ErrorCode::ProtocolMismatch,
            ErrorCode::BadMessage,
        ] {
            assert_eq!(ErrorCode::from_code(code.as_str()), Some(code));
        }
        assert_eq!(ErrorCode::from_code("nope"), None);
    }
}
