//! The bridge's session state: the transfer state machine, the probe budget and the ping schedule.
//!
//! [`Bridge`] does no I/O and never reads a clock. Time comes in as an [`Instant`] argument, datagrams come in as slices, and
//! datagrams to send come out of [`Bridge::poll_transmit`]. A caller drives it with three calls:
//!
//! 1. feed it events: [`Bridge::receive_snapshot`], [`Bridge::announce`], [`Bridge::handle_datagram`];
//! 2. call [`Bridge::handle_timeout`] when [`Bridge::poll_timeout`] has passed;
//! 3. drain [`Bridge::poll_transmit`] and send every datagram, and send [`Bridge::poll_status`] to the planners.
//!
//! The state table in `spec/in-game-viewer-protocol.md` ("Transfer state") is the definition; comments here quote its rows.
//! Nothing resends on a timer except the probes, and those only within their budget.

use std::collections::VecDeque;
use std::time::{Duration, Instant};

use crate::protocol::{
    CHUNK_PAYLOAD, Inbound, MAX_CHUNKS, MAX_SNAPSHOT_BYTES, ModMessage, NO_PROGRESS_LIMIT, PACE_CHUNKS, PACE_INTERVAL,
    PING_BACKOFF_DIVISOR, PING_INTERVAL, PING_INTERVAL_MAX, PROBE_BURST, PROBE_INTERVAL, PROBE_REFILL_AFTER,
    PROTOCOL_VERSION, QUIET_AFTER, SnapshotId, WINDOW_CHUNKS, chunk_count, encode_chunk, encode_end_of_window,
    encode_ping, encode_probe, parse_mod_datagram,
};
use crate::status::{Link, ModStatus, Status, TransferState, TransferStatus};

/// The reason word for a transfer that stopped making progress.
pub const NO_PROGRESS_REASON: &str = "no-progress";

/// Reports are numbered with four digits; the counter wraps.
const ROUND_MODULUS: u16 = 10_000;

/// Where the transfer of the held snapshot stands. `Idle` is the phase before the first snapshot.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Phase {
    /// No snapshot held yet.
    Idle,
    /// Holding a snapshot with no mod to take it.
    Waiting,
    /// Sending probes until the mod is ready.
    Probing,
    /// Sending a window, paced.
    Sending,
    /// A window is out; waiting for the mod's report.
    Awaiting,
    /// The mod stores the snapshot.
    Delivered,
    /// The mod refused the snapshot.
    Rejected,
    /// The bridge gave up.
    Failed,
}

/// Why [`Bridge::receive_snapshot`] refused a snapshot.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SnapshotError {
    /// No bytes.
    Empty,
    /// Above `MAX_SNAPSHOT_BYTES`, or more chunks than `MAX_CHUNKS` at the bridge's chunk size.
    TooLarge,
}

impl std::fmt::Display for SnapshotError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Self::Empty => "a snapshot has at least one byte",
            Self::TooLarge => "the snapshot is too large",
        })
    }
}

impl std::error::Error for SnapshotError {}

type Ranges = Vec<(u16, u16)>;

struct Transfer {
    id: SnapshotId,
    bytes: Vec<u8>,
    count: u16,
    phase: Phase,
    /// Chunks sent at least once, as reported to the planner.
    sent: u16,
    reason: Option<String>,
    /// The round of the current window, `None` until the first window is built.
    round: Option<u16>,
    /// Every chunk with an index below this has been sent at least once.
    upto: u16,
    window: Vec<u16>,
    cursor: usize,
    next_slot: Instant,
    /// The previous report's ranges and the `upto` of the window it answered.
    previous_report: Option<(Ranges, u16)>,
    run: u32,
    /// Probe bursts sent to completion in this `Probing` stay.
    bursts: u32,
}

impl Transfer {
    fn new(id: SnapshotId, bytes: Vec<u8>, count: u16, now: Instant) -> Self {
        Self {
            id,
            bytes,
            count,
            phase: Phase::Waiting,
            sent: 0,
            reason: None,
            round: None,
            upto: 0,
            window: Vec::new(),
            cursor: 0,
            next_slot: now,
            previous_report: None,
            run: 0,
            bursts: 0,
        }
    }

    fn drop_window(&mut self) {
        self.window.clear();
        self.cursor = 0;
    }

    /// Ends the current window and moves to a phase that sends nothing, with the reason the planner is shown (if any).
    fn stop(&mut self, phase: Phase, reason: Option<String>) {
        self.drop_window();
        self.phase = phase;
        self.reason = reason;
    }
}

/// The session: one mod, one held snapshot, the ping schedule and the probe budget.
pub struct Bridge {
    version: String,
    chunk_size: usize,
    started: Instant,

    last_heard: Option<Instant>,
    mismatch: Option<u8>,
    mod_protocol: Option<u8>,
    mod_stored: Option<SnapshotId>,
    mod_unknown_ids: u16,

    newest: Option<SnapshotId>,

    next_ping: Instant,
    last_nudge: Option<Instant>,

    probes_left: u8,
    last_probe: Option<Instant>,

    transfer: Option<Transfer>,
    out: VecDeque<Vec<u8>>,
    last_status: Option<Status>,
    quiet_after: Duration,
}

impl Bridge {
    /// A bridge that starts at `now`. The first ping is ready to send.
    #[must_use]
    pub fn new(now: Instant) -> Self {
        Self::with_chunk_size(now, CHUNK_PAYLOAD)
    }

    /// Like [`Bridge::new`], with a smaller chunk size. The shared fixtures cut chunks smaller to cover more cases;
    /// the release bridge always uses `CHUNK_PAYLOAD`.
    ///
    /// # Panics
    /// If `chunk_size` is 0 or above `CHUNK_PAYLOAD`.
    #[must_use]
    pub fn with_chunk_size(now: Instant, chunk_size: usize) -> Self {
        assert!((1..=CHUNK_PAYLOAD).contains(&chunk_size), "chunk size out of range");
        let mut bridge = Self {
            version: env!("CARGO_PKG_VERSION").to_owned(),
            chunk_size,
            started: now,
            last_heard: None,
            mismatch: None,
            mod_protocol: None,
            mod_stored: None,
            mod_unknown_ids: 0,
            newest: None,
            next_ping: now,
            last_nudge: None,
            probes_left: PROBE_BURST,
            last_probe: None,
            transfer: None,
            out: VecDeque::new(),
            last_status: None,
            quiet_after: QUIET_AFTER,
        };
        bridge.send_scheduled_ping(now);
        bridge
    }

    /// Changes how long the mod may stay silent before the link is `quiet` (`QUIET_AFTER`, 15 s). For tests, which cannot wait
    /// that long; the release bridge keeps the protocol's value.
    pub fn set_quiet_after(&mut self, quiet_after: Duration) {
        self.quiet_after = quiet_after;
    }

    // -----------------------------------------------------------------------------------------
    // Inputs
    // -----------------------------------------------------------------------------------------

    /// A `snapshot` message from a planner ("Receiving a snapshot").
    ///
    /// # Errors
    /// If the snapshot is empty or too large; nothing changes then.
    pub fn receive_snapshot(&mut self, now: Instant, id: SnapshotId, bytes: Vec<u8>) -> Result<(), SnapshotError> {
        if bytes.is_empty() {
            return Err(SnapshotError::Empty);
        }
        let count = chunk_count(bytes.len(), self.chunk_size);
        if bytes.len() > MAX_SNAPSHOT_BYTES || count > usize::from(MAX_CHUNKS) {
            return Err(SnapshotError::TooLarge);
        }
        let count = u16::try_from(count).map_err(|_| SnapshotError::TooLarge)?;

        // 1. `newest` becomes X, and the nudge goes out if it is due.
        self.newest = Some(id);
        self.nudge(now);

        // 2. The same snapshot, already in progress or delivered: the no-op.
        if let Some(t) = &self.transfer
            && t.id == id
            && matches!(
                t.phase,
                Phase::Waiting | Phase::Probing | Phase::Sending | Phase::Awaiting | Phase::Delivered
            )
        {
            return Ok(());
        }

        // 3. The target becomes these bytes; the old window and bytes are dropped with the old transfer.
        self.transfer = Some(Transfer::new(id, bytes, count, now));

        // 4. The mod already stores it.
        if self.mismatch.is_none() && self.mod_stored == Some(id) {
            self.set_delivered();
        // 5. The mod can take it now.
        } else if self.link(now) == Link::Connected {
            self.enter_probing(now);
        }
        // 6. Otherwise the transfer stays `Waiting` (the phase `Transfer::new` gives) until a hello.
        Ok(())
    }

    /// An `announce` message: sets `newest` and nothing else.
    pub fn announce(&mut self, id: SnapshotId) {
        self.newest = Some(id);
    }

    /// A datagram from the mod. Anything that breaks the wire rules is dropped without a trace.
    pub fn handle_datagram(&mut self, now: Instant, datagram: &[u8]) {
        let Some(inbound) = parse_mod_datagram(datagram) else {
            return;
        };

        // Any valid datagram counts as hearing the mod, and pulls the next ping back to PING_INTERVAL.
        self.last_heard = Some(now);
        self.next_ping = self.next_ping.min(now + PING_INTERVAL);

        match inbound {
            Inbound::OtherVersionHello(version) => {
                self.mismatch = Some(version);
                self.mod_protocol = Some(version);
                self.mod_stored = None;
                self.mod_unknown_ids = 0;
                // Waiting, Probing, Sending, Awaiting: the link is a mismatch and the transfer waits.
                if let Some(t) = &mut self.transfer
                    && matches!(t.phase, Phase::Probing | Phase::Sending | Phase::Awaiting)
                {
                    t.stop(Phase::Waiting, None);
                }
            }
            Inbound::Mod(message) => {
                self.mismatch = None;
                self.mod_protocol = Some(PROTOCOL_VERSION);
                self.handle_message(now, message);
            }
        }
    }

    fn handle_message(&mut self, now: Instant, message: ModMessage) {
        // The probe budget refills on M, A, N and on a hello long after the last probe; R does not refill it.
        let refill = match &message {
            ModMessage::Missing { .. } | ModMessage::Ack { .. } | ModMessage::Refusal { .. } => true,
            ModMessage::Hello { .. } => self
                .last_probe
                .is_none_or(|t| now.saturating_duration_since(t) > PROBE_REFILL_AFTER),
            ModMessage::Ready { .. } => false,
        };
        let refilled_from_empty = refill && self.probes_left == 0;
        if refill {
            self.probes_left = PROBE_BURST;
        }

        match message {
            ModMessage::Hello {
                stored,
                unknown_ids,
                assembling,
            } => {
                self.mod_stored = stored;
                self.mod_unknown_ids = if stored.is_some() { unknown_ids } else { 0 };
                self.on_hello(now, stored, assembling);
            }
            ModMessage::Ready { id } => self.on_ready(now, id),
            ModMessage::Missing { id, round, ranges } => self.on_missing(now, id, round, &ranges),
            ModMessage::Ack { id, unknown_ids } => {
                if self.transfer.as_ref().is_some_and(|t| t.id == id) {
                    self.mod_stored = Some(id);
                    self.mod_unknown_ids = unknown_ids;
                    if matches!(self.phase(), Phase::Probing | Phase::Sending | Phase::Awaiting) {
                        self.set_delivered();
                    }
                }
            }
            ModMessage::Refusal { id, reason } => {
                if let Some(t) = &mut self.transfer
                    && t.id == id
                    && matches!(t.phase, Phase::Probing | Phase::Sending | Phase::Awaiting)
                {
                    t.stop(Phase::Rejected, Some(reason));
                }
            }
        }

        // Eight probe bursts in a row with no R: the mod is up and answering hello, but never takes the snapshot.
        if refilled_from_empty
            && let Some(t) = &mut self.transfer
            && t.phase == Phase::Probing
            && t.bursts >= NO_PROGRESS_LIMIT
        {
            t.phase = Phase::Failed;
            t.reason = Some(NO_PROGRESS_REASON.to_owned());
        }

        // Entering `Probing` or finishing a report may leave something to send at once.
        self.probe_tick(now);
    }

    fn on_hello(&mut self, now: Instant, stored: Option<SnapshotId>, assembling: Option<SnapshotId>) {
        let Some((phase, id)) = self.transfer.as_ref().map(|t| (t.phase, t.id)) else {
            return;
        };
        let holds_target = stored == Some(id);
        let assembles_target = assembling == Some(id);
        match phase {
            Phase::Idle => unreachable!("a held transfer is never idle"),
            Phase::Waiting => {
                if holds_target {
                    self.set_delivered();
                } else {
                    self.enter_probing(now);
                }
            }
            Phase::Probing => {
                if holds_target {
                    self.set_delivered();
                }
            }
            Phase::Sending | Phase::Awaiting => {
                if holds_target {
                    self.set_delivered();
                } else if !assembles_target {
                    // The mod lost the transfer (a load or a restart): drop the window and start again.
                    self.enter_probing(now);
                } else if phase == Phase::Awaiting
                    && let Some(t) = &self.transfer
                    && let Some(round) = t.round
                {
                    // A lost end-of-window or a lost report: ask again, for the same round.
                    self.out.push_back(encode_end_of_window(&t.id, round, t.upto));
                }
            }
            Phase::Delivered => {
                if !holds_target {
                    self.enter_probing(now);
                }
            }
            Phase::Rejected | Phase::Failed => {
                if holds_target {
                    self.set_delivered();
                }
            }
        }
    }

    fn on_ready(&mut self, now: Instant, id: SnapshotId) {
        let Some(t) = &mut self.transfer else {
            return;
        };
        if t.id == id && t.phase == Phase::Probing {
            t.phase = Phase::Sending;
            Self::build_window(t, &[], now);
            self.send_slot(now);
        }
    }

    fn on_missing(&mut self, now: Instant, id: SnapshotId, round: u16, ranges: &[(u16, u16)]) {
        let Some(t) = &mut self.transfer else {
            return;
        };
        if t.id != id || t.phase != Phase::Awaiting || t.round != Some(round) {
            return;
        }
        // A report naming an index at or above `upto` is invalid: a correct mod never sends one. It starts no window and
        // does not replace the previous report, but it counts as fruitless, so a mod that keeps sending one still ends in
        // `Failed` instead of being asked again at every ping forever.
        if ranges.iter().any(|&(_, last)| last >= t.upto) {
            t.run += 1;
            if t.run >= NO_PROGRESS_LIMIT {
                t.stop(Phase::Failed, Some(NO_PROGRESS_REASON.to_owned()));
            }
            return;
        }
        // A report is fruitless when its ranges and the `upto` of the window it answers repeat the previous report's.
        let fruitless = t
            .previous_report
            .as_ref()
            .is_some_and(|(previous_ranges, previous_upto)| previous_ranges == ranges && *previous_upto == t.upto);
        t.run = if fruitless { t.run + 1 } else { 1 };
        t.previous_report = Some((ranges.to_vec(), t.upto));
        if t.run >= NO_PROGRESS_LIMIT {
            t.stop(Phase::Failed, Some(NO_PROGRESS_REASON.to_owned()));
            return;
        }
        // If the window comes out empty, which a correct mod never causes, the bridge stays in `Awaiting`.
        if Self::build_window(t, ranges, now) {
            t.phase = Phase::Sending;
            self.send_slot(now);
        }
    }

    // -----------------------------------------------------------------------------------------
    // Transfer steps
    // -----------------------------------------------------------------------------------------

    fn enter_probing(&mut self, now: Instant) {
        if let Some(t) = &mut self.transfer {
            t.phase = Phase::Probing;
            t.round = None;
            t.upto = 0;
            t.sent = 0;
            t.drop_window();
            t.previous_report = None;
            t.run = 0;
            t.bursts = 0;
            t.reason = None;
        }
        self.probe_tick(now);
    }

    fn set_delivered(&mut self) {
        if let Some(t) = &mut self.transfer {
            t.stop(Phase::Delivered, None);
            t.sent = t.count;
        }
    }

    /// Sends a probe if the transfer is probing, the budget has one left and `PROBE_INTERVAL` has passed.
    fn probe_tick(&mut self, now: Instant) {
        let Some(t) = &mut self.transfer else {
            return;
        };
        if t.phase != Phase::Probing || self.probes_left == 0 {
            return;
        }
        if self.last_probe.is_some_and(|last| now < last + PROBE_INTERVAL) {
            return;
        }
        let bytes = u32::try_from(t.bytes.len()).expect("a snapshot is below 4 GiB");
        self.out.push_back(encode_probe(&t.id, t.count, bytes));
        self.last_probe = Some(now);
        self.probes_left -= 1;
        if self.probes_left == 0 {
            t.bursts += 1;
        }
    }

    /// Builds the next window from a report's ranges. Returns false if it came out empty.
    fn build_window(t: &mut Transfer, ranges: &[(u16, u16)], now: Instant) -> bool {
        let mut window: Vec<u16> = Vec::with_capacity(WINDOW_CHUNKS);
        'ranges: for &(first, last) in ranges {
            for index in first..=last {
                if window.len() == WINDOW_CHUNKS {
                    break 'ranges;
                }
                window.push(index);
            }
        }
        let mut upto = t.upto;
        while window.len() < WINDOW_CHUNKS && upto < t.count {
            window.push(upto);
            upto += 1;
        }
        if window.is_empty() {
            return false;
        }
        t.upto = upto;
        t.round = Some(t.round.map_or(0, |round| (round + 1) % ROUND_MODULUS));
        t.window = window;
        t.cursor = 0;
        t.next_slot = now;
        true
    }

    /// One pacing slot: up to `PACE_CHUNKS` chunks, and after the last of the window, the end-of-window datagram.
    fn send_slot(&mut self, now: Instant) {
        let Some(t) = &mut self.transfer else {
            return;
        };
        if t.phase != Phase::Sending {
            return;
        }
        let total = u32::try_from(t.bytes.len()).expect("a snapshot is below 4 GiB");
        for _ in 0..PACE_CHUNKS {
            let Some(&index) = t.window.get(t.cursor) else {
                break;
            };
            let start = usize::from(index) * self.chunk_size;
            let end = (start + self.chunk_size).min(t.bytes.len());
            self.out
                .push_back(encode_chunk(&t.id, index, t.count, total, &t.bytes[start..end]));
            t.cursor += 1;
        }
        if t.cursor >= t.window.len() {
            let round = t.round.expect("a window has a round");
            self.out.push_back(encode_end_of_window(&t.id, round, t.upto));
            t.phase = Phase::Awaiting;
            t.sent = t.upto;
        } else {
            t.next_slot = now + PACE_INTERVAL;
        }
    }

    // -----------------------------------------------------------------------------------------
    // Pings
    // -----------------------------------------------------------------------------------------

    /// A scheduled ping, and the due time of the next one: `clamp(silence / 16, 5 s, 300 s)` after this one, with the
    /// silence measured now.
    fn send_scheduled_ping(&mut self, now: Instant) {
        self.out.push_back(encode_ping(self.newest.as_ref()));
        let interval = (self.silence(now) / PING_BACKOFF_DIVISOR).clamp(PING_INTERVAL, PING_INTERVAL_MAX);
        self.next_ping = now + interval;
    }

    /// A ping at once, carrying the new `newest`, unless one was nudged within `PING_INTERVAL`. It leaves the schedule alone.
    fn nudge(&mut self, now: Instant) {
        if self
            .last_nudge
            .is_none_or(|last| now.saturating_duration_since(last) >= PING_INTERVAL)
        {
            self.out.push_back(encode_ping(self.newest.as_ref()));
            self.last_nudge = Some(now);
        }
    }

    // -----------------------------------------------------------------------------------------
    // Time and output
    // -----------------------------------------------------------------------------------------

    /// When [`Bridge::handle_timeout`] next has something to do. There is always a next time: the ping schedule never stops. A time in the past means "now".
    #[must_use]
    pub fn poll_timeout(&self, now: Instant) -> Instant {
        let mut due = self.next_ping;
        if let Some(t) = &self.transfer {
            match t.phase {
                Phase::Sending => due = due.min(t.next_slot),
                Phase::Probing if self.probes_left > 0 => {
                    if let Some(last) = self.last_probe {
                        due = due.min(last + PROBE_INTERVAL);
                    }
                }
                _ => {}
            }
        }
        // The link turns `quiet` at this moment, which changes the status.
        if self.mismatch.is_none()
            && let Some(heard) = self.last_heard
            && heard + self.quiet_after > now
        {
            due = due.min(heard + self.quiet_after);
        }
        due
    }

    /// Does what is due at `now`: the scheduled ping, a pacing slot, a probe.
    pub fn handle_timeout(&mut self, now: Instant) {
        if now >= self.next_ping {
            self.send_scheduled_ping(now);
        }
        match self.phase() {
            Phase::Sending if self.transfer.as_ref().is_some_and(|t| now >= t.next_slot) => self.send_slot(now),
            Phase::Probing => self.probe_tick(now),
            _ => {}
        }
    }

    /// The next datagram to send to the mod, if any.
    pub fn poll_transmit(&mut self) -> Option<Vec<u8>> {
        self.out.pop_front()
    }

    /// The transfer phase.
    #[must_use]
    pub fn phase(&self) -> Phase {
        self.transfer.as_ref().map_or(Phase::Idle, |t| t.phase)
    }

    /// The reason of a rejected or failed transfer.
    #[must_use]
    pub fn reason(&self) -> Option<&str> {
        self.transfer.as_ref().and_then(|t| t.reason.as_deref())
    }

    /// The link, derived from the time since the mod was last heard.
    #[must_use]
    pub fn link(&self, now: Instant) -> Link {
        if self.mismatch.is_some() {
            return Link::Mismatch;
        }
        match self.last_heard {
            None => Link::None,
            Some(heard) if now.saturating_duration_since(heard) < self.quiet_after => Link::Connected,
            Some(_) => Link::Quiet,
        }
    }

    /// The whole status, as a planner receives it.
    #[must_use]
    pub fn status(&self, now: Instant) -> Status {
        let link = self.link(now);
        let stored = self.mod_stored.filter(|_| self.mismatch.is_none());
        Status {
            protocol: PROTOCOL_VERSION,
            bridge: self.version.clone(),
            newest: self.newest,
            module: ModStatus {
                link,
                protocol: self.mod_protocol,
                stored,
                unknown_ids: stored.map(|_| self.mod_unknown_ids),
            },
            transfer: self.transfer.as_ref().map(|t| TransferStatus {
                id: t.id,
                state: match t.phase {
                    Phase::Idle | Phase::Waiting => TransferState::Waiting,
                    Phase::Probing | Phase::Sending | Phase::Awaiting => {
                        if link == Link::Quiet {
                            TransferState::Stalled
                        } else {
                            TransferState::Sending
                        }
                    }
                    Phase::Delivered => TransferState::Delivered,
                    Phase::Rejected => TransferState::Rejected,
                    Phase::Failed => TransferState::Failed,
                },
                sent: t.sent,
                count: t.count,
                reason: t.reason.clone(),
            }),
        }
    }

    /// The status, if it differs from the one this method returned last.
    pub fn poll_status(&mut self, now: Instant) -> Option<Status> {
        let status = self.status(now);
        if self.last_status.as_ref() == Some(&status) {
            return None;
        }
        self.last_status = Some(status.clone());
        Some(status)
    }

    /// The silence since the mod was last heard, or since the bridge started.
    #[must_use]
    pub fn silence(&self, now: Instant) -> Duration {
        now.saturating_duration_since(self.last_heard.unwrap_or(self.started))
    }

    /// The id the planner last announced or sent.
    #[must_use]
    pub fn newest(&self) -> Option<SnapshotId> {
        self.newest
    }
}
