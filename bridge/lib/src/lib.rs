//! The bridge of the in-game viewer, without its sockets: the wire protocol between the planner, the bridge and the Factorio mod,
//! and the session logic that delivers a snapshot.
//!
//! - [`protocol`]: UDP datagram encode and decode, and the protocol's constants.
//! - [`ws`]: the planner-facing messages (snapshot envelope, `announce`, `error`) as bytes and text.
//! - [`status`]: the `status` message.
//! - [`bridge`]: [`Bridge`], the session state machine. It does no I/O and reads no clock.
//! - [`cli`] and [`server`]: the command line and the sockets the binary runs: the WebSocket endpoint for planners and the UDP socket to the mod.
//! - [`driver`]: a small synchronous glue between a [`Bridge`] and a [`driver::Transport`], with a UDP transport.
//!
//! The snapshot itself stays opaque: the bridge reads a 32-byte envelope and cuts the rest into chunks.
//! The authoritative description of the protocol is `initiatives/in-game-viewer/protocol.md`.

pub mod bridge;
pub mod cli;
pub mod driver;
pub mod protocol;
pub mod server;
pub mod status;
pub mod ws;

pub use bridge::{Bridge, Phase, SnapshotError};
pub use protocol::SnapshotId;
pub use status::{Link, Status, TransferState};
