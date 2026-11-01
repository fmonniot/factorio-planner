//! The rows of the protocol's state table, the probe budget and the ping schedule, with a clock the tests move by hand.
//!
//! The shared fixtures do not exercise every row (they never wait for time to pass), so this file covers the rest.

mod support;

use std::time::{Duration, Instant};

use bridge_lib::protocol::NO_PROGRESS_LIMIT;
use bridge_lib::{Bridge, Link, Phase, SnapshotError, TransferState};
use support::{Clock, Sent, drain, id};

const A: &str = "aaaaaaaaaaaaaaaa";
const B: &str = "bbbbbbbbbbbbbbbb";
const C: &str = "cccccccccccccccc";
const NONE: &str = "----------------";

/// 28 full chunks and a short one.
const BIG: usize = 28 * 8_000 + 100;

struct Rig {
    clock: Clock,
    bridge: Bridge,
    start: Instant,
}

impl Rig {
    fn new() -> Self {
        let clock = Clock::new();
        let mut bridge = Bridge::new(clock.now);
        let first = drain(&mut bridge);
        assert_eq!(first.order, "P", "the first ping goes out when the bridge starts");
        assert_eq!(first.pings, vec![None]);
        Self {
            start: clock.now,
            clock,
            bridge,
        }
    }

    fn elapsed(&self) -> Duration {
        self.clock.now - self.start
    }

    fn hear(&mut self, text: &str) {
        self.bridge.handle_datagram(self.clock.now, text.as_bytes());
    }

    fn hello(&mut self, stored: &str, unknown: u16, assembling: &str) {
        self.hear(&format!("FP01 H {stored} {unknown} {assembling}"));
    }

    fn drain(&mut self) -> Sent {
        drain(&mut self.bridge)
    }

    fn snapshot(&mut self, which: &str, len: usize) -> Result<(), SnapshotError> {
        self.bridge.receive_snapshot(self.clock.now, id(which), vec![b'x'; len])
    }

    /// Moves time forward, running every timeout on the way, and returns everything sent.
    fn run_for(&mut self, duration: Duration) -> Sent {
        let end = self.clock.now + duration;
        let mut sent = Sent::default();
        loop {
            let due = self.bridge.poll_timeout(self.clock.now);
            if due > end {
                break;
            }
            self.clock.now = due.max(self.clock.now);
            self.bridge.handle_timeout(self.clock.now);
            for d in drain(&mut self.bridge).raw {
                sent.absorb(d);
            }
        }
        self.clock.now = end;
        sent
    }

    fn ms(&mut self, ms: u64) -> Sent {
        self.run_for(Duration::from_millis(ms))
    }

    fn secs(&mut self, s: u64) -> Sent {
        self.run_for(Duration::from_secs(s))
    }

    /// The mod has spoken: link `connected`, nothing stored.
    fn connect(&mut self) {
        self.hello(NONE, 0, NONE);
        let sent = self.drain();
        assert!(sent.is_empty(), "no snapshot, nothing to send: {sent:?}");
    }

    /// Runs the pacing until the window has been sent, and returns what it sent.
    fn run_window(&mut self) -> Sent {
        let mut sent = self.drain();
        while self.bridge.phase() == Phase::Sending {
            let more = self.ms(20);
            sent.merge(more);
        }
        sent
    }

    fn phase(&self) -> Phase {
        self.bridge.phase()
    }
}

fn dur(secs: u64) -> Duration {
    Duration::from_secs(secs)
}

// ---------------------------------------------------------------------------------------------
// Pings
// ---------------------------------------------------------------------------------------------

#[test]
fn the_first_ping_leaves_at_start_and_names_no_snapshot() {
    let mut clock = Clock::new();
    let mut bridge = Bridge::new(clock.now);
    let sent = drain(&mut bridge);
    assert_eq!(sent.pings, vec![None]);
    assert_eq!(sent.raw[0], b"FP01 P ----------------");
    clock.secs(1);
    assert!(drain(&mut bridge).is_empty());
}

#[test]
fn a_mod_that_keeps_answering_is_pinged_every_five_seconds() {
    let mut rig = Rig::new();
    let mut pings = 0;
    for _ in 0..20 {
        rig.hello(NONE, 0, NONE);
        let sent = rig.secs(5);
        pings += sent.pings.len();
        assert_eq!(sent.pings.len(), 1, "one ping per 5 s");
    }
    assert_eq!(pings, 20);
}

#[test]
fn pings_back_off_with_silence_up_to_five_minutes() {
    let mut rig = Rig::new();
    // Record the time of every ping over three hours of silence.
    let mut times = vec![Duration::ZERO];
    let end = Duration::from_secs(3 * 3_600);
    while rig.elapsed() < end {
        let due = rig.bridge.poll_timeout(rig.clock.now);
        rig.clock.now = due;
        rig.bridge.handle_timeout(due);
        let sent = rig.drain();
        assert_eq!(sent.pings.len(), 1);
        times.push(rig.elapsed());
    }
    let gaps: Vec<Duration> = times.windows(2).map(|w| w[1] - w[0]).collect();
    // While the silence is below 80 s, the interval is 5 s: the pings at 0, 5, ..., 75 s each wait 5 s.
    assert!(gaps[..16].iter().all(|g| *g == dur(5)), "{:?}", &gaps[..16]);
    // The interval is the silence at the previous ping, divided by 16 (to the millisecond).
    for (w, gap) in times.windows(2).zip(&gaps) {
        let expected = (w[0] / 16).clamp(dur(5), dur(300));
        assert_eq!(*gap, expected, "gap after the ping at {:?}", w[0]);
    }
    // The back-off reaches 5 minutes at 80 minutes of silence and stays there.
    assert!(times.iter().any(|t| *t >= dur(4_800)), "ran long enough");
    assert!(gaps.iter().rev().take(5).all(|g| *g == dur(300)));
    assert!(gaps.iter().all(|g| *g <= dur(300)));
}

#[test]
fn hearing_the_mod_pulls_a_far_ping_back_to_five_seconds() {
    let mut rig = Rig::new();
    // 90 minutes of silence: the next ping is 300 s away.
    rig.secs(90 * 60);
    let before = rig.bridge.poll_timeout(rig.clock.now) - rig.clock.now;
    assert!(before > dur(5), "the schedule has backed off: {before:?}");
    rig.hello(NONE, 0, NONE);
    assert_eq!(rig.bridge.poll_timeout(rig.clock.now), rig.clock.now + dur(5));
    let sent = rig.secs(5);
    assert_eq!(sent.pings.len(), 1);
}

#[test]
fn hearing_the_mod_never_makes_a_ping_later() {
    let mut rig = Rig::new();
    rig.hello(NONE, 0, NONE);
    rig.secs(3);
    let due = rig.bridge.poll_timeout(rig.clock.now);
    assert_eq!(due, rig.start + dur(5));
    rig.hello(NONE, 0, NONE);
    assert_eq!(
        rig.bridge.poll_timeout(rig.clock.now),
        due,
        "2 s to go is sooner than 5 s"
    );
}

#[test]
fn a_hello_of_another_version_counts_as_hearing_the_mod_but_garbage_does_not() {
    let mut rig = Rig::new();
    rig.secs(1_000);
    rig.hear("FP02 H whatever");
    assert_eq!(rig.bridge.poll_timeout(rig.clock.now), rig.clock.now + dur(5));
    assert_eq!(rig.bridge.link(rig.clock.now), Link::Mismatch);

    let mut rig = Rig::new();
    rig.secs(1_000);
    let due = rig.bridge.poll_timeout(rig.clock.now);
    rig.hear("garbage");
    rig.hear("FP02 R aaaaaaaaaaaaaaaa");
    rig.hear("FP01 H aaaaaaaaaaaaaaaa 007 ----------------");
    assert_eq!(rig.bridge.poll_timeout(rig.clock.now), due);
    assert_eq!(rig.bridge.link(rig.clock.now), Link::None);
}

#[test]
fn a_snapshot_nudges_a_ping_at_once_carrying_the_new_newest() {
    let mut rig = Rig::new();
    rig.secs(100);
    rig.drain();
    let due = rig.bridge.poll_timeout(rig.clock.now);
    rig.snapshot(A, 10).unwrap();
    let sent = rig.drain();
    assert_eq!(sent.pings, vec![Some(id(A))]);
    assert_eq!(
        rig.bridge.poll_timeout(rig.clock.now),
        due,
        "the nudge does not change the schedule"
    );
}

#[test]
fn nudges_come_at_most_once_per_ping_interval_even_for_the_same_snapshot() {
    let mut rig = Rig::new();
    rig.drain();
    rig.snapshot(A, 10).unwrap();
    assert_eq!(rig.drain().pings.len(), 1);
    rig.ms(4_900);
    rig.snapshot(B, 10).unwrap();
    assert!(rig.drain().pings.is_empty(), "within 5 s of the last nudge");
    // The ping that carries B is the next scheduled one, which is due at 5 s anyway.
    rig.ms(100);
    rig.snapshot(B, 10).unwrap();
    let sent = rig.drain();
    assert_eq!(
        sent.pings,
        vec![Some(id(B))],
        "5 s later, the same snapshot again nudges"
    );
}

#[test]
fn an_announce_sets_newest_without_a_nudge() {
    let mut rig = Rig::new();
    rig.drain();
    rig.bridge.announce(id(A));
    assert!(rig.drain().is_empty());
    assert_eq!(rig.bridge.newest(), Some(id(A)));
    let sent = rig.secs(5);
    assert_eq!(sent.pings, vec![Some(id(A))], "the next scheduled ping carries it");
}

#[test]
fn the_ping_goes_before_the_probe_it_nudges() {
    let mut rig = Rig::new();
    rig.connect();
    rig.snapshot(A, 10).unwrap();
    assert_eq!(rig.drain().order, "PW");
}

// ---------------------------------------------------------------------------------------------
// Receiving a snapshot
// ---------------------------------------------------------------------------------------------

#[test]
fn a_snapshot_with_no_mod_heard_waits_and_sends_no_probe() {
    let mut rig = Rig::new();
    rig.snapshot(A, 10).unwrap();
    let sent = rig.drain();
    assert!(sent.probes.is_empty());
    assert_eq!(rig.phase(), Phase::Waiting);
    // A hello that does not show it stored starts the transfer.
    rig.hello(B, 0, NONE);
    assert_eq!(rig.phase(), Phase::Probing);
    assert_eq!(rig.drain().probes, vec![(id(A), 1, 10)]);
}

#[test]
fn a_waiting_snapshot_the_mod_already_stores_is_delivered_by_the_hello_alone() {
    let mut rig = Rig::new();
    rig.snapshot(A, 10).unwrap();
    rig.drain();
    rig.hello(A, 3, NONE);
    assert_eq!(rig.phase(), Phase::Delivered);
    assert!(rig.drain().is_empty());
    let status = rig.bridge.status(rig.clock.now);
    assert_eq!(status.module.stored, Some(id(A)));
    assert_eq!(status.module.unknown_ids, Some(3));
}

#[test]
fn a_snapshot_the_mod_is_known_to_store_is_delivered_without_a_datagram() {
    let mut rig = Rig::new();
    rig.hello(A, 2, NONE);
    rig.snapshot(A, 10).unwrap();
    assert_eq!(rig.phase(), Phase::Delivered);
    let sent = rig.drain();
    assert!(sent.probes.is_empty() && sent.chunks.is_empty(), "{sent:?}");
    let transfer = rig.bridge.status(rig.clock.now).transfer.unwrap();
    assert_eq!(
        (transfer.state, transfer.sent, transfer.count),
        (TransferState::Delivered, 1, 1)
    );
}

#[test]
fn a_mismatched_link_does_not_deliver_from_a_stale_stored_id() {
    let mut rig = Rig::new();
    rig.hello(A, 0, NONE);
    rig.hear("FP02 H x");
    rig.snapshot(A, 10).unwrap();
    assert_eq!(
        rig.phase(),
        Phase::Waiting,
        "stored is unknown once the mod speaks another version"
    );
    assert!(rig.drain().probes.is_empty());
    assert_eq!(rig.bridge.status(rig.clock.now).module.stored, None);
}

#[test]
fn a_quiet_link_waits_instead_of_probing() {
    let mut rig = Rig::new();
    rig.connect();
    rig.secs(20);
    assert_eq!(rig.bridge.link(rig.clock.now), Link::Quiet);
    rig.snapshot(A, 10).unwrap();
    assert_eq!(rig.phase(), Phase::Waiting);
    assert!(rig.drain().probes.is_empty());
}

#[test]
fn the_same_snapshot_again_is_a_no_op_while_in_progress_or_delivered() {
    let mut rig = Rig::new();
    rig.connect();
    rig.snapshot(A, BIG).unwrap();
    rig.drain();
    assert_eq!(rig.phase(), Phase::Probing);
    rig.snapshot(A, BIG).unwrap();
    assert_eq!(rig.phase(), Phase::Probing);
    assert!(rig.drain().probes.is_empty(), "no new probe");

    rig.hear(&format!("FP01 R {A}"));
    rig.run_window();
    rig.snapshot(A, BIG).unwrap();
    assert_eq!(rig.phase(), Phase::Awaiting, "the window in progress is kept");
    assert!(rig.drain().chunks.is_empty());

    rig.hear(&format!("FP01 A {A} 0"));
    assert_eq!(rig.phase(), Phase::Delivered);
    rig.snapshot(A, BIG).unwrap();
    assert_eq!(rig.phase(), Phase::Delivered);
}

#[test]
fn sending_a_refused_or_failed_snapshot_again_is_an_explicit_retry() {
    let mut rig = Rig::new();
    rig.connect();
    rig.snapshot(A, 10).unwrap();
    rig.drain();
    rig.hear(&format!("FP01 N {A} json"));
    assert_eq!(rig.phase(), Phase::Rejected);
    rig.secs(2);
    rig.snapshot(A, 10).unwrap();
    assert_eq!(rig.phase(), Phase::Probing);
    assert_eq!(rig.drain().probes.len(), 1);
    assert_eq!(rig.bridge.status(rig.clock.now).transfer.unwrap().reason, None);
}

#[test]
fn a_new_snapshot_drops_the_window_in_progress_at_once() {
    let mut rig = Rig::new();
    rig.connect();
    rig.snapshot(A, BIG).unwrap();
    rig.drain();
    rig.hear(&format!("FP01 R {A}"));
    let first = rig.drain();
    assert_eq!(
        first.chunk_indices(),
        vec![0, 1, 2, 3],
        "the first slot goes out with the answer"
    );
    assert_eq!(rig.phase(), Phase::Sending);

    rig.ms(20);
    rig.snapshot(B, 100).unwrap();
    assert!(
        rig.drain().is_empty(),
        "the nudge was spent a moment ago and the next probe waits 250 ms"
    );
    let after = rig.secs(1);
    assert_eq!(
        after.probes,
        vec![(id(B), 1, 100), (id(B), 1, 100)],
        "the probes of the new snapshot (one was used by A)"
    );
    assert!(
        after.chunks.is_empty() && after.eows.is_empty(),
        "no more chunks or end-of-window of the old one"
    );
    assert_eq!(rig.bridge.status(rig.clock.now).transfer.unwrap().id, id(B));
}

#[test]
fn answers_naming_another_snapshot_are_ignored() {
    let mut rig = Rig::new();
    rig.connect();
    rig.snapshot(A, 10).unwrap();
    rig.drain();
    rig.snapshot(B, 10).unwrap();
    rig.drain();
    rig.hear(&format!("FP01 R {A}"));
    assert_eq!(rig.phase(), Phase::Probing);
    rig.hear(&format!("FP01 A {A} 0"));
    assert_eq!(rig.phase(), Phase::Probing);
    rig.hear(&format!("FP01 N {A} json"));
    assert_eq!(rig.phase(), Phase::Probing);
    assert_eq!(
        rig.bridge.status(rig.clock.now).module.stored,
        None,
        "an ack for another id says nothing about the target"
    );
}

#[test]
fn a_snapshot_that_cannot_be_sent_is_refused_and_changes_nothing() {
    let mut rig = Rig::new();
    rig.connect();
    assert_eq!(rig.snapshot(A, 0), Err(SnapshotError::Empty));
    assert_eq!(rig.snapshot(A, 8_000_001), Err(SnapshotError::TooLarge));
    assert!(rig.snapshot(A, 8_000_000).is_ok());
    assert_eq!(rig.phase(), Phase::Probing);
    let mut small_chunks = Bridge::with_chunk_size(rig.clock.now, 7);
    assert_eq!(
        small_chunks.receive_snapshot(rig.clock.now, id(B), vec![0; 7_001]),
        Err(SnapshotError::TooLarge),
        "more than MAX_CHUNKS chunks"
    );
    assert_eq!(rig.bridge.status(rig.clock.now).transfer.unwrap().id, id(A));
}

// ---------------------------------------------------------------------------------------------
// Probes
// ---------------------------------------------------------------------------------------------

#[test]
fn a_probe_burst_is_three_probes_250_ms_apart_and_then_nothing() {
    let mut rig = Rig::new();
    rig.connect();
    rig.snapshot(A, 10).unwrap();
    let mut at = vec![rig.elapsed()];
    rig.drain();
    for _ in 0..40 {
        let sent = rig.ms(50);
        for _ in &sent.probes {
            at.push(rig.elapsed());
        }
    }
    assert_eq!(at.len(), 3, "three probes in all: {at:?}");
    assert_eq!(at[1] - at[0], Duration::from_millis(250));
    assert_eq!(at[2] - at[1], Duration::from_millis(250));
    // Hours pass: a paused game must not be flooded, and the transfer waits.
    let sent = rig.secs(3_600);
    assert!(sent.probes.is_empty() && sent.chunks.is_empty() && sent.eows.is_empty());
    assert_eq!(rig.phase(), Phase::Probing);
}

#[test]
fn the_probe_budget_is_shared_and_a_new_snapshot_does_not_refill_it() {
    let mut rig = Rig::new();
    rig.connect();
    rig.snapshot(A, 10).unwrap();
    rig.drain();
    rig.secs(1);
    // The budget is spent.
    rig.snapshot(B, 10).unwrap();
    let sent = rig.drain();
    assert!(sent.probes.is_empty(), "no probe for the new snapshot: {sent:?}");
    assert_eq!(rig.phase(), Phase::Probing);
    assert!(rig.secs(60).probes.is_empty());
}

#[test]
fn a_report_an_ack_or_a_refusal_refills_the_budget_but_a_ready_does_not() {
    for (name, answer, refills) in [
        ("missing", format!("FP01 M {C} 0000 -"), true),
        ("ack", format!("FP01 A {C} 0"), true),
        ("refusal", format!("FP01 N {C} json"), true),
        ("ready", format!("FP01 R {C}"), false),
        (
            "hello within a second of the last probe",
            format!("FP01 H {B} 0 {NONE}"),
            false,
        ),
    ] {
        let mut rig = Rig::new();
        rig.connect();
        rig.snapshot(A, 10).unwrap();
        rig.drain();
        let hold = if name.starts_with("hello") { 600 } else { 1_000 };
        // The rest of the burst (probes at 250 and 500 ms) leaves during the wait: the budget is spent before the answer.
        let burst = rig.ms(hold);
        assert_eq!(burst.probes.len(), 2, "{name}");
        assert!(rig.drain().is_empty(), "{name}");
        rig.hear(&answer);
        let sent = rig.drain();
        // The answer may bring a probe at once (the last was 250 ms ago or more) and more follow.
        let more = rig.secs(2);
        let probes = sent.probes.len() + more.probes.len();
        assert_eq!(
            probes > 0 && probes <= 3 && rig.phase() == Phase::Probing,
            refills,
            "{name}: {probes} probes"
        );
        if refills {
            assert_eq!(probes, 3, "{name}: a whole new burst");
        }
    }
}

#[test]
fn a_hello_more_than_a_second_after_the_last_probe_refills_the_budget() {
    // The burst ends with a probe at 500 ms. A hello exactly 1,000 ms later is not "more than" 1,000 ms after it; one
    // millisecond later it is.
    for (hello_at, refills) in [(1_500, false), (1_501, true)] {
        let mut rig = Rig::new();
        rig.connect();
        rig.snapshot(A, 10).unwrap();
        rig.drain();
        let burst = rig.ms(hello_at);
        assert_eq!(burst.probes.len(), 2, "the rest of the burst");
        rig.hello(B, 0, NONE);
        let probes = rig.drain().probes.len() + rig.secs(2).probes.len();
        assert_eq!(probes, if refills { 3 } else { 0 }, "hello at {hello_at} ms");
    }
}

#[test]
fn lost_probes_show_no_error_in_the_status() {
    let mut rig = Rig::new();
    rig.connect();
    rig.snapshot(A, BIG).unwrap();
    rig.secs(2);
    let transfer = rig.bridge.status(rig.clock.now).transfer.unwrap();
    assert_eq!(transfer.state, TransferState::Sending);
    assert_eq!(transfer.reason, None);
}

#[test]
fn eight_probe_bursts_without_a_ready_fail_the_transfer_with_no_progress() {
    let mut rig = Rig::new();
    rig.connect();
    rig.snapshot(A, 10).unwrap();
    rig.drain();
    let mut bursts = 1;
    assert_eq!(rig.secs(2).probes.len(), 2, "the rest of the first burst");
    while rig.phase() == Phase::Probing {
        assert!(bursts <= NO_PROGRESS_LIMIT, "gave up too late");
        // The mod is up and answers hello, but never says ready.
        rig.hello(B, 0, NONE);
        let sent = rig.drain();
        if rig.phase() == Phase::Probing {
            bursts += 1;
            assert_eq!(sent.probes.len() + rig.secs(2).probes.len(), 3);
        }
    }
    assert_eq!(rig.phase(), Phase::Failed);
    assert_eq!(rig.bridge.reason(), Some("no-progress"));
    assert_eq!(bursts, NO_PROGRESS_LIMIT);
    let status = rig.bridge.status(rig.clock.now).transfer.unwrap();
    assert_eq!(
        (status.state, status.reason.as_deref()),
        (TransferState::Failed, Some("no-progress"))
    );
}

#[test]
fn a_ready_resets_the_burst_count_for_the_next_stay_in_probing() {
    let mut rig = Rig::new();
    rig.connect();
    rig.snapshot(A, BIG).unwrap();
    rig.drain();
    // Seven bursts with no ready: still probing.
    for _ in 0..7 {
        rig.secs(1);
        rig.hello(B, 0, NONE);
        rig.secs(1);
    }
    assert_eq!(rig.phase(), Phase::Probing);
    // The mod finally takes it, then loses it (a load): the count starts again.
    rig.hear(&format!("FP01 R {A}"));
    assert_eq!(rig.phase(), Phase::Sending);
    rig.hello(B, 0, NONE);
    assert_eq!(rig.phase(), Phase::Probing);
    for _ in 0..7 {
        rig.secs(2);
        rig.hello(B, 0, NONE);
    }
    assert_eq!(rig.phase(), Phase::Probing, "a fresh count of bursts");
}

// ---------------------------------------------------------------------------------------------
// Windows, pacing and reports
// ---------------------------------------------------------------------------------------------

/// A bridge that holds a 29-chunk snapshot and has heard the mod's `R`.
fn sending_rig() -> Rig {
    let mut rig = Rig::new();
    rig.connect();
    rig.snapshot(A, BIG).unwrap();
    rig.drain();
    rig
}

#[test]
fn a_window_is_24_chunks_four_per_20_ms_then_the_end_of_window() {
    let mut rig = sending_rig();
    let ready_at = rig.clock.now;
    rig.hear(&format!("FP01 R {A}"));
    let mut sent = rig.drain();
    assert_eq!(sent.chunk_indices(), vec![0, 1, 2, 3]);
    let mut slots = vec![(Duration::ZERO, 4)];
    while rig.phase() == Phase::Sending {
        assert_eq!(
            rig.bridge.poll_timeout(rig.clock.now),
            ready_at + Duration::from_millis(20 * slots.len() as u64)
        );
        let more = rig.ms(20);
        slots.push((rig.clock.now - ready_at, more.chunks.len()));
        sent.chunks.extend(more.chunks);
        sent.eows.extend(more.eows);
        sent.order.push_str(&more.order);
    }
    assert_eq!(sent.chunk_indices(), (0..24).collect::<Vec<_>>());
    assert_eq!(sent.eows, vec![(0, 24)]);
    assert_eq!(slots.len(), 6, "24 chunks at 4 per slot");
    assert!(slots.iter().all(|&(_, n)| n == 4));
    assert_eq!(slots[5].0, Duration::from_millis(100));
    assert!(sent.order.ends_with('E') && sent.order.matches('E').count() == 1);
    assert_eq!(rig.phase(), Phase::Awaiting);
    let transfer = rig.bridge.status(rig.clock.now).transfer.unwrap();
    assert_eq!((transfer.sent, transfer.count), (24, 29));
}

#[test]
fn a_window_that_fits_one_slot_sends_its_end_of_window_in_the_same_slot() {
    let mut rig = Rig::new();
    rig.connect();
    rig.snapshot(A, 20_000).unwrap();
    rig.drain();
    rig.hear(&format!("FP01 R {A}"));
    let sent = rig.drain();
    assert_eq!(sent.order, "CCCE");
    assert_eq!(sent.eows, vec![(0, 3)]);
    assert_eq!(sent.chunks, vec![(0, 8_000), (1, 8_000), (2, 4_000)]);
}

#[test]
fn nothing_is_resent_on_a_timeout_however_long_the_mod_stays_silent() {
    let mut rig = sending_rig();
    rig.hear(&format!("FP01 R {A}"));
    rig.run_window();
    let sent = rig.run_for(Duration::from_secs(6 * 3_600));
    assert!(
        sent.chunks.is_empty() && sent.eows.is_empty() && sent.probes.is_empty(),
        "only pings: {:?}",
        sent.order
    );
    assert!(!sent.pings.is_empty());
    assert_eq!(rig.phase(), Phase::Awaiting);
    let transfer = rig.bridge.status(rig.clock.now).transfer.unwrap();
    assert_eq!(transfer.state, TransferState::Stalled, "the link is quiet");
}

#[test]
fn a_report_that_names_nothing_releases_the_next_window() {
    let mut rig = sending_rig();
    rig.hear(&format!("FP01 R {A}"));
    rig.run_window();
    rig.hear(&format!("FP01 M {A} 0000 -"));
    let sent = rig.drain();
    assert_eq!(sent.chunk_indices(), vec![24, 25, 26, 27], "the first slot of window 1");
    rig.run_window();
    assert_eq!(rig.phase(), Phase::Awaiting);
    let transfer = rig.bridge.status(rig.clock.now).transfer.unwrap();
    assert_eq!(transfer.sent, 29);
}

#[test]
fn a_resend_window_puts_the_reported_chunks_first_then_fills_with_new_ones() {
    let mut rig = sending_rig();
    rig.hear(&format!("FP01 R {A}"));
    rig.run_window();
    rig.hear(&format!("FP01 M {A} 0000 1,3-5,9"));
    let mut sent = rig.drain();
    while rig.phase() == Phase::Sending {
        let more = rig.ms(20);
        sent.chunks.extend(more.chunks);
        sent.eows.extend(more.eows);
    }
    assert_eq!(sent.chunk_indices(), vec![1, 3, 4, 5, 9, 24, 25, 26, 27, 28]);
    assert_eq!(sent.eows, vec![(1, 29)]);
}

#[test]
fn a_window_is_capped_at_24_chunks_with_resends_first() {
    let mut rig = Rig::new();
    rig.connect();
    // 41 chunks of 8,000 bytes.
    rig.snapshot(A, 41 * 8_000).unwrap();
    rig.drain();
    rig.hear(&format!("FP01 R {A}"));
    rig.run_window();
    // Twelve gaps in the first window.
    rig.hear(&format!("FP01 M {A} 0000 0,2,4,6,8,10,12,14,16,18,20,22"));
    let mut sent = rig.drain();
    while rig.phase() == Phase::Sending {
        let more = rig.ms(20);
        sent.chunks.extend(more.chunks);
        sent.eows.extend(more.eows);
    }
    let mut expected: Vec<u16> = (0..12).map(|i| i * 2).collect();
    expected.extend(24..36);
    assert_eq!(sent.chunk_indices(), expected);
    assert_eq!(sent.eows, vec![(1, 36)]);
}

#[test]
fn reports_for_another_round_or_id_or_phase_are_ignored() {
    let mut rig = sending_rig();
    // Not awaiting yet.
    rig.hear(&format!("FP01 M {A} 0000 -"));
    rig.hear(&format!("FP01 R {A}"));
    rig.drain();
    assert_eq!(
        rig.phase(),
        Phase::Sending,
        "a report in Probing changed nothing and R started the window"
    );
    rig.run_window();
    rig.hear(&format!("FP01 M {A} 0001 -"));
    rig.hear(&format!("FP01 M {B} 0000 -"));
    assert_eq!(rig.phase(), Phase::Awaiting);
    assert!(rig.drain().is_empty());
    // A report naming a chunk at or above upto is dropped whole.
    rig.hear(&format!("FP01 M {A} 0000 2,24"));
    assert_eq!(rig.phase(), Phase::Awaiting);
    assert!(rig.drain().is_empty());
    // The right one still works, once.
    rig.hear(&format!("FP01 M {A} 0000 -"));
    assert_eq!(rig.phase(), Phase::Sending);
    rig.run_window();
    rig.hear(&format!("FP01 M {A} 0000 -"));
    assert_eq!(
        rig.phase(),
        Phase::Awaiting,
        "a duplicate of an answered report is stale"
    );
    assert!(rig.drain().is_empty());
}

#[test]
fn a_mod_that_keeps_sending_an_invalid_report_ends_in_failed() {
    let mut rig = sending_rig();
    rig.hear(&format!("FP01 R {A}"));
    rig.run_window();
    for n in 0..NO_PROGRESS_LIMIT {
        assert_eq!(rig.phase(), Phase::Awaiting, "invalid report {n}");
        // Chunk 24 is at `upto`: the mod cannot know it.
        rig.hear(&format!("FP01 M {A} 0000 2,24"));
        assert!(rig.drain().is_empty(), "an invalid report starts no window");
    }
    assert_eq!(rig.phase(), Phase::Failed);
    assert_eq!(rig.bridge.reason(), Some("no-progress"));
    // No ping interval resends the end-of-window forever: nothing is sent for a hello now.
    rig.hello(NONE, 0, A);
    assert!(rig.drain().is_empty());
}

#[test]
fn a_hello_that_still_shows_the_transfer_asks_again_with_the_same_end_of_window() {
    let mut rig = sending_rig();
    rig.hear(&format!("FP01 R {A}"));
    rig.run_window();
    rig.drain();
    rig.hello(NONE, 0, A);
    let sent = rig.drain();
    assert_eq!(sent.order, "E");
    assert_eq!(sent.eows, vec![(0, 24)]);
    assert_eq!(rig.phase(), Phase::Awaiting);
    // And again on the next hello; it is the answer to a ping, so the rate is the ping's.
    rig.hello(NONE, 0, A);
    assert_eq!(rig.drain().eows, vec![(0, 24)]);
    // The window itself is not resent: the report names what is missing.
}

#[test]
fn a_hello_that_shows_the_transfer_lost_starts_again_from_a_probe() {
    for phase_before in ["sending", "awaiting"] {
        let mut rig = sending_rig();
        rig.hear(&format!("FP01 R {A}"));
        if phase_before == "awaiting" {
            rig.run_window();
        }
        rig.drain();
        rig.secs(2);
        rig.hello(B, 0, NONE);
        assert_eq!(rig.phase(), Phase::Probing, "{phase_before}");
        let sent = rig.drain();
        assert_eq!(
            sent.probes.len(),
            1,
            "{phase_before}: the window is dropped and a probe goes out"
        );
        assert!(sent.chunks.is_empty() && sent.eows.is_empty(), "{phase_before}");
        // The next window starts at round 0 again.
        rig.hear(&format!("FP01 R {A}"));
        let first = rig.drain();
        assert_eq!(first.chunk_indices(), vec![0, 1, 2, 3]);
    }
}

#[test]
fn a_hello_that_shows_the_transfer_assembling_during_the_window_changes_nothing() {
    let mut rig = sending_rig();
    rig.hear(&format!("FP01 R {A}"));
    rig.drain();
    rig.hello(NONE, 0, A);
    assert_eq!(rig.phase(), Phase::Sending);
    assert!(
        rig.drain().is_empty(),
        "the end-of-window is not resent while the window is still going out"
    );
}

#[test]
fn an_ack_delivers_from_probing_sending_and_awaiting() {
    for stage in 0..3 {
        let mut rig = sending_rig();
        if stage >= 1 {
            rig.hear(&format!("FP01 R {A}"));
        }
        if stage >= 2 {
            rig.run_window();
        }
        rig.drain();
        rig.hear(&format!("FP01 A {A} 4"));
        assert_eq!(rig.phase(), Phase::Delivered, "stage {stage}");
        let status = rig.bridge.status(rig.clock.now);
        assert_eq!(
            (status.module.stored, status.module.unknown_ids),
            (Some(id(A)), Some(4))
        );
        assert_eq!(status.transfer.unwrap().sent, 29);
        assert!(
            rig.secs(1).chunks.is_empty(),
            "a delivered snapshot's window is dropped"
        );
    }
}

#[test]
fn a_refusal_rejects_with_the_mods_reason_and_only_a_new_snapshot_retries() {
    let mut rig = sending_rig();
    rig.hear(&format!("FP01 R {A}"));
    rig.run_window();
    rig.hear(&format!("FP01 N {A} version"));
    assert_eq!(rig.phase(), Phase::Rejected);
    assert_eq!(rig.bridge.reason(), Some("version"));
    let transfer = rig.bridge.status(rig.clock.now).transfer.unwrap();
    assert_eq!(
        (transfer.state, transfer.reason.as_deref()),
        (TransferState::Rejected, Some("version"))
    );
    // Nothing is sent for any other answer.
    rig.hello(B, 0, NONE);
    rig.hello(NONE, 0, A);
    rig.hear(&format!("FP01 A {B} 0"));
    rig.hear(&format!("FP01 R {A}"));
    rig.hear(&format!("FP01 M {A} 0001 -"));
    assert_eq!(rig.phase(), Phase::Rejected);
    assert!(rig.drain().is_empty());
    // A hello that shows the mod holds it after all clears the reason.
    rig.hello(A, 0, NONE);
    assert_eq!(rig.phase(), Phase::Delivered);
    assert_eq!(rig.bridge.reason(), None);
}

#[test]
fn a_delivered_snapshot_is_sent_again_when_a_hello_shows_another_one() {
    let mut rig = sending_rig();
    rig.hear(&format!("FP01 A {A} 0"));
    assert_eq!(rig.phase(), Phase::Delivered);
    rig.secs(2);
    // A save with another snapshot was loaded.
    rig.hello(B, 0, NONE);
    assert_eq!(rig.phase(), Phase::Probing);
    assert_eq!(rig.drain().probes.len(), 1);
}

#[test]
fn eight_fruitless_reports_stop_the_transfer_and_only_a_new_snapshot_or_a_stored_hello_moves_it() {
    let mut rig = Rig::new();
    rig.connect();
    rig.snapshot(A, 24 * 8_000 + 1).unwrap();
    rig.drain();
    rig.hear(&format!("FP01 R {A}"));
    rig.run_window();
    for round in 0..NO_PROGRESS_LIMIT {
        assert_eq!(rig.phase(), Phase::Awaiting, "report {round}");
        // Chunks 0 to 23 never arrive, and the window is 24 chunks, so nothing new fits either.
        rig.hear(&format!("FP01 M {A} {round:04} 0-23"));
        rig.run_window();
    }
    assert_eq!(rig.phase(), Phase::Failed);
    assert_eq!(rig.bridge.reason(), Some("no-progress"));
    assert!(rig.secs(60).chunks.is_empty());
    rig.hear(&format!("FP01 A {A} 0"));
    assert_eq!(rig.phase(), Phase::Failed, "an ack is ignored");
    rig.hello(A, 0, NONE);
    assert_eq!(rig.phase(), Phase::Delivered);
}

#[test]
fn the_report_counter_wraps_at_four_digits() {
    // Every window re-asks for the same chunk with no progress, but the run is restarted by alternating ranges.
    let mut rig = Rig::new();
    rig.connect();
    rig.snapshot(A, 2 * 8_000).unwrap();
    rig.drain();
    rig.hear(&format!("FP01 R {A}"));
    rig.drain();
    for n in 0..10_001_u32 {
        let round = n % 10_000;
        let ranges = if n % 2 == 0 { "0" } else { "1" };
        rig.hear(&format!("FP01 M {A} {round:04} {ranges}"));
        let sent = rig.drain();
        assert_eq!(sent.eows.len(), 1, "report {n}");
        assert_eq!(u32::from(sent.eows[0].0), (n + 1) % 10_000, "report {n}");
    }
}

// ---------------------------------------------------------------------------------------------
// Protocol versions
// ---------------------------------------------------------------------------------------------

#[test]
fn a_hello_of_another_version_puts_a_running_transfer_back_to_waiting() {
    let mut rig = sending_rig();
    rig.hear(&format!("FP01 R {A}"));
    rig.drain();
    rig.hear("FP02 H any other layout");
    assert_eq!(rig.phase(), Phase::Waiting);
    let status = rig.bridge.status(rig.clock.now);
    assert_eq!(status.module.link, Link::Mismatch);
    assert_eq!(status.module.protocol, Some(2));
    assert_eq!(status.transfer.unwrap().state, TransferState::Waiting);
    // It sends no probe and no chunk, but keeps pinging.
    let sent = rig.secs(30);
    assert!(sent.probes.is_empty() && sent.chunks.is_empty() && sent.eows.is_empty());
    assert!(!sent.pings.is_empty());
    // A mod updated later is picked up.
    rig.hello(NONE, 0, NONE);
    assert_eq!(rig.bridge.link(rig.clock.now), Link::Connected);
    assert_eq!(rig.phase(), Phase::Probing);
    assert_eq!(rig.drain().probes.len(), 1);
}

#[test]
fn a_hello_of_another_version_leaves_idle_delivered_rejected_and_failed_alone() {
    let mut rig = Rig::new();
    rig.hear("FP02 H x");
    assert_eq!(rig.phase(), Phase::Idle);

    let mut rig = sending_rig();
    rig.hear(&format!("FP01 A {A} 0"));
    rig.hear("FP02 H x");
    assert_eq!(rig.phase(), Phase::Delivered);

    let mut rig = sending_rig();
    rig.hear(&format!("FP01 N {A} json"));
    rig.hear("FP02 H x");
    assert_eq!(rig.phase(), Phase::Rejected);
}

// ---------------------------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------------------------

#[test]
fn the_link_goes_from_none_to_connected_to_quiet_and_the_status_changes_with_it() {
    let mut rig = Rig::new();
    let first = rig.bridge.poll_status(rig.clock.now).expect("a first status");
    assert_eq!(first.module.link, Link::None);
    assert_eq!(first.module.protocol, None);
    assert!(rig.bridge.poll_status(rig.clock.now).is_none(), "unchanged");

    rig.hello(A, 2, NONE);
    let status = rig.bridge.poll_status(rig.clock.now).unwrap();
    assert_eq!(status.module.link, Link::Connected);
    assert_eq!(
        (status.module.protocol, status.module.stored, status.module.unknown_ids),
        (Some(1), Some(id(A)), Some(2))
    );

    // The timeout that flips the link is part of the schedule.
    rig.ms(14_999);
    assert!(rig.bridge.poll_status(rig.clock.now).is_none());
    rig.ms(1);
    let quiet = rig.bridge.poll_status(rig.clock.now).unwrap();
    assert_eq!(quiet.module.link, Link::Quiet);
    assert_eq!(quiet.module.stored, Some(id(A)), "what the mod stored stays");

    rig.hello(A, 2, NONE);
    assert_eq!(
        rig.bridge.poll_status(rig.clock.now).unwrap().module.link,
        Link::Connected
    );
}

#[test]
fn the_transfer_state_follows_the_link_while_the_transfer_runs() {
    let mut rig = sending_rig();
    rig.hear(&format!("FP01 R {A}"));
    rig.run_window();
    assert_eq!(
        rig.bridge.status(rig.clock.now).transfer.unwrap().state,
        TransferState::Sending
    );
    rig.secs(16);
    assert_eq!(
        rig.bridge.status(rig.clock.now).transfer.unwrap().state,
        TransferState::Stalled
    );
    rig.hear(&format!("FP01 M {A} 0000 -"));
    assert_eq!(
        rig.bridge.status(rig.clock.now).transfer.unwrap().state,
        TransferState::Sending
    );
}

#[test]
fn the_status_carries_newest_and_the_chunk_counts() {
    let mut rig = Rig::new();
    rig.connect();
    rig.bridge.announce(id(C));
    rig.snapshot(A, BIG).unwrap();
    rig.drain();
    let transfer = rig.bridge.status(rig.clock.now).transfer.unwrap();
    assert_eq!(
        (transfer.id, transfer.sent, transfer.count, transfer.state),
        (id(A), 0, 29, TransferState::Sending)
    );
    assert_eq!(
        rig.bridge.status(rig.clock.now).newest,
        Some(id(A)),
        "the snapshot replaced the announce"
    );
}

#[test]
fn an_unknown_id_count_is_dropped_when_nothing_is_stored() {
    let mut rig = Rig::new();
    rig.hello(NONE, 7, NONE);
    let status = rig.bridge.status(rig.clock.now);
    assert_eq!((status.module.stored, status.module.unknown_ids), (None, None));
}

#[test]
fn snapshot_ids_are_just_names() {
    // An id has no order: going A, B, then back to A sends A again from the start.
    let mut rig = Rig::new();
    rig.connect();
    rig.snapshot(A, 10).unwrap();
    rig.drain();
    rig.hear(&format!("FP01 A {A} 0"));
    rig.snapshot(B, 10).unwrap();
    rig.drain();
    rig.hear(&format!("FP01 A {B} 0"));
    rig.secs(1);
    rig.snapshot(A, 10).unwrap();
    // The mod stores B, so A is not delivered, and the budget was refilled by the acks.
    assert_eq!(rig.phase(), Phase::Probing);
    assert_eq!(rig.drain().probes, vec![(id(A), 1, 10)]);
}
