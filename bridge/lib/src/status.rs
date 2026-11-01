//! The bridge's `status` message for the planner: the bridge's whole state as one object.

use serde::{Deserialize, Serialize};

use crate::protocol::SnapshotId;

/// How the bridge sees the mod.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Link {
    /// No mod has been heard since the bridge started.
    None,
    /// The mod spoke within `QUIET_AFTER`.
    Connected,
    /// The mod spoke before, but not within `QUIET_AFTER`: paused, saving, at the title screen or closed.
    Quiet,
    /// The last `hello` had another protocol version.
    Mismatch,
}

/// Where the delivery of the held snapshot stands.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TransferState {
    /// The bridge holds the snapshot and no mod is reachable to take it.
    Waiting,
    /// Probing, sending a window or waiting for a report, with the mod speaking.
    Sending,
    /// The same, with the link `quiet`. It resumes on its own.
    Stalled,
    /// The mod stores this id.
    Delivered,
    /// The mod refused it; `reason` says why.
    Rejected,
    /// The bridge gave up after `NO_PROGRESS_LIMIT` attempts.
    Failed,
}

/// The mod, as far as the bridge knows.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ModStatus {
    /// The link.
    pub link: Link,
    /// The protocol version in the last `hello`, once heard.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub protocol: Option<u8>,
    /// The id the mod holds, once heard, if it stores a snapshot.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stored: Option<SnapshotId>,
    /// How many of the stored snapshot's ids the running game lacks; present with `stored`.
    #[serde(default, rename = "unknownIds", skip_serializing_if = "Option::is_none")]
    pub unknown_ids: Option<u16>,
}

/// The delivery of the snapshot the bridge holds.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TransferStatus {
    /// Its id.
    pub id: SnapshotId,
    /// Where the delivery stands.
    pub state: TransferState,
    /// Chunks sent at least once; changes when a window ends.
    pub sent: u16,
    /// Its chunk count.
    pub count: u16,
    /// The mod's reason word, or `no-progress`, when `rejected` or `failed`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

/// The `status` message. It is sent once on connection and again whenever a field changes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Status {
    /// The bridge's `PROTOCOL_VERSION`.
    pub protocol: u8,
    /// The bridge's release version, for display.
    pub bridge: String,
    /// The id set by the last `snapshot` or `announce`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub newest: Option<SnapshotId>,
    /// The mod.
    #[serde(rename = "mod")]
    pub module: ModStatus,
    /// The delivery of the held snapshot, when the bridge holds one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub transfer: Option<TransferStatus>,
}

#[derive(Serialize)]
struct Tagged<'a> {
    #[serde(rename = "type")]
    kind: &'static str,
    #[serde(flatten)]
    status: &'a Status,
}

impl Status {
    /// The JSON text frame the planner receives.
    #[must_use]
    pub fn to_json(&self) -> String {
        serde_json::to_string(&Tagged {
            kind: "status",
            status: self,
        })
        .expect("a status always serializes")
    }
}
