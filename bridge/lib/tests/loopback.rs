//! The bridge against a fake mod over real UDP on loopback.
//!
//! Only the sockets are real. Time is virtual: the harness jumps from one wake-up to the next, so a game paused for an hour
//! costs a few hundred loop iterations. The fake mod plays the mod's part of the protocol and loses datagrams the way the game
//! does: a fresh socket drops its first oversized datagram, and a full buffer drops what does not fit.

mod support;

use std::io;
use std::time::{Duration, Instant};

use bridge_lib::driver::{Driver, Transport, UdpTransport};
use bridge_lib::{Bridge, Link, Phase, SnapshotId, Status, TransferState};
use support::fake_mod::{BUFFER, FakeMod, OVERHEAD, PESSIMISTIC_OVERHEAD, snapshot_bytes};
use support::id;

/// A UDP transport that can be told how many datagrams the mod has sent, so that a read waits for exactly those.
struct Loopback {
    udp: UdpTransport,
    expected: usize,
}

impl Transport for Loopback {
    fn send(&mut self, datagram: &[u8]) -> io::Result<()> {
        self.udp.send(datagram)
    }

    fn recv(&mut self) -> io::Result<Option<Vec<u8>>> {
        if self.expected == 0 {
            return self.udp.recv();
        }
        let datagram = self.udp.recv_wait(Duration::from_secs(5))?;
        assert!(datagram.is_some(), "the mod sent a datagram that never arrived");
        self.expected -= 1;
        Ok(datagram)
    }
}

struct World {
    now: Instant,
    start: Instant,
    driver: Driver<Loopback>,
    fake: FakeMod,
    to_mod: usize,
    to_bridge: usize,
    /// Every status the bridge published, with the time since the start.
    statuses: Vec<(Duration, Status)>,
}

impl World {
    fn new() -> Self {
        let now = Instant::now();
        let mut udp = UdpTransport::bind(0, 1).expect("bind the bridge's socket");
        let fake = FakeMod::new(udp.local_addr().unwrap(), now);
        udp.set_game_port(fake.game_addr().port());
        let driver = Driver::new(Bridge::new(now), Loopback { udp, expected: 0 });
        Self {
            now,
            start: now,
            driver,
            fake,
            to_mod: 0,
            to_bridge: 0,
            statuses: Vec::new(),
        }
        .started()
    }

    fn started(mut self) -> Self {
        // The first ping leaves when the bridge starts.
        self.turn();
        self
    }

    fn elapsed(&self) -> Duration {
        self.now - self.start
    }

    fn record(&mut self, step: bridge_lib::driver::Step) {
        self.to_mod += step.sent;
        if let Some(status) = step.status {
            self.statuses.push((self.elapsed(), status));
        }
    }

    /// One round at the current instant: the bridge hears what the mod sent, then the mod takes what the bridge sent.
    fn turn(&mut self) {
        self.driver.transport_mut().expected = std::mem::take(&mut self.to_bridge);
        let step = self.driver.step(self.now).expect("step");
        self.record(step);
        self.to_bridge += self.fake.step(self.now, std::mem::take(&mut self.to_mod));
    }

    fn run_for(&mut self, duration: Duration) {
        let end = self.now + duration;
        let mut guard = 0_u32;
        loop {
            guard += 1;
            assert!(guard < 2_000_000, "the loop is not making progress");
            self.turn();
            if self.to_mod > 0 || self.to_bridge > 0 {
                continue;
            }
            let next = self
                .driver
                .bridge()
                .poll_timeout(self.now)
                .min(self.fake.next_wakeup().unwrap_or(end))
                .min(end);
            if next <= self.now {
                if self.now >= end {
                    break;
                }
                // Something is due now and nothing was in flight: step once more at the same instant.
                continue;
            }
            self.now = next;
            if self.now >= end {
                self.turn();
                // Whatever that turn produced is delivered at the same instant.
                while self.to_mod > 0 || self.to_bridge > 0 {
                    self.turn();
                }
                break;
            }
        }
    }

    fn secs(&mut self, s: u64) {
        self.run_for(Duration::from_secs(s));
    }

    fn send_snapshot(&mut self, which: SnapshotId, bytes: Vec<u8>) {
        let step = self.driver.receive_snapshot(self.now, which, bytes).expect("accepted");
        self.record(step);
    }

    fn phase(&self) -> Phase {
        self.driver.bridge().phase()
    }

    fn status(&self) -> Status {
        self.driver.bridge().status(self.now)
    }

    /// Runs until the transfer reaches `phase`, for at most `limit` of virtual time.
    fn run_until_phase(&mut self, phase: Phase, limit: Duration) {
        let end = self.now + limit;
        while self.phase() != phase && self.now < end {
            self.run_for(Duration::from_millis(100));
        }
        assert_eq!(
            self.phase(),
            phase,
            "after {:?}: statuses {:?}",
            self.elapsed(),
            self.statuses.last()
        );
    }

    fn mod_log(&self) -> String {
        self.fake.sent.iter().collect()
    }
}

const A: &str = "aaaaaaaaaaaaaaaa";
const B: &str = "bbbbbbbbbbbbbbbb";

/// 29 chunks, as a full Seablock snapshot.
fn full_snapshot(seed: u8) -> Vec<u8> {
    snapshot_bytes(228_548, seed)
}

/// A world where the mod has already answered a ping, so the link is `connected`.
fn connected_world() -> World {
    let mut world = World::new();
    world.secs(1);
    assert_eq!(
        world.status().module.link,
        Link::Connected,
        "the first ping got its hello"
    );
    world
}

#[test]
fn a_full_size_snapshot_is_delivered_byte_for_byte() {
    let mut world = connected_world();
    // The socket has already grown for this test's purposes.
    world.fake.growth_losses = 0;
    world.fake.reload(world.now);
    let snapshot = full_snapshot(1);
    world.send_snapshot(id(A), snapshot.clone());
    world.run_until_phase(Phase::Delivered, Duration::from_secs(5));
    assert_eq!(world.fake.stored_bytes.as_deref(), Some(snapshot.as_slice()));
    assert_eq!(world.fake.stored.map(|(i, _)| i), Some(id(A)));
    assert_eq!(world.fake.duplicates, 0, "nothing is sent twice when nothing is lost");
    assert_eq!(world.fake.lost_to_growth + world.fake.lost_to_overflow, 0);
    let transfer = world.status().transfer.unwrap();
    assert_eq!(
        (transfer.state, transfer.sent, transfer.count),
        (TransferState::Delivered, 29, 29)
    );
    // Probe, ready, two windows: one mod answer to each, plus the hellos of the pings.
    assert!(
        world.mod_log().contains("RMMA") || world.mod_log().contains("RMA"),
        "{}",
        world.mod_log()
    );
}

#[test]
fn a_fresh_socket_loses_the_first_oversized_datagram_and_the_probes_cover_it() {
    let mut world = connected_world();
    world.fake.growth_losses = 1;
    world.fake.reload(world.now);
    world.send_snapshot(id(A), full_snapshot(2));
    world.run_until_phase(Phase::Delivered, Duration::from_secs(10));
    assert_eq!(
        world.fake.lost_to_growth, 1,
        "the first probe was lost to the growth step"
    );
    assert_eq!(world.fake.stored.map(|(i, _)| i), Some(id(A)));
    // The chunks never needed a resend, and the status never showed an error.
    assert_eq!(world.fake.duplicates, 0);
    assert!(
        world
            .statuses
            .iter()
            .all(|(_, s)| s.transfer.as_ref().is_none_or(|t| t.reason.is_none()))
    );
}

#[test]
fn two_growth_steps_are_covered_by_a_burst_of_three() {
    let mut world = connected_world();
    world.fake.growth_losses = 2;
    world.fake.reload(world.now);
    world.send_snapshot(id(A), full_snapshot(3));
    world.run_until_phase(Phase::Delivered, Duration::from_secs(10));
    assert_eq!(world.fake.lost_to_growth, 2);
    assert_eq!(world.fake.probes_seen, 1, "only the third probe arrived");
}

#[test]
fn a_game_that_loses_every_probe_is_given_three_and_no_more_until_it_speaks_again() {
    let mut world = connected_world();
    // Three losses: all three probes of the burst.
    world.fake.growth_losses = 3;
    world.fake.reload(world.now);
    world.send_snapshot(id(A), full_snapshot(4));
    world.run_for(Duration::from_secs(2));
    assert_eq!(world.fake.lost_to_growth, 3);
    assert_eq!(world.fake.probes_seen, 0);
    assert_eq!(world.phase(), Phase::Probing);
    // The next ping's hello proves the game is running, which refills the budget; the fourth probe arrives.
    world.run_until_phase(Phase::Delivered, Duration::from_secs(30));
    assert_eq!(world.fake.stored.map(|(i, _)| i), Some(id(A)));
}

#[test]
fn a_full_receive_buffer_drops_chunks_and_the_report_gets_them_resent() {
    let mut world = connected_world();
    world.fake.growth_losses = 0;
    world.fake.reload(world.now);
    // The buffer has room for seven chunks, and a window is 24 sent in about 100 ms, within one poll of 166 ms.
    world.fake.capacity = 7 * (8_042 + OVERHEAD) + 700;
    let snapshot = full_snapshot(5);
    world.send_snapshot(id(A), snapshot.clone());
    world.run_until_phase(Phase::Delivered, Duration::from_secs(30));
    assert!(world.fake.lost_to_overflow > 0, "the buffer really overflowed");
    assert_eq!(world.fake.stored_bytes.as_deref(), Some(snapshot.as_slice()));
}

#[test]
fn a_buffer_too_small_for_a_window_still_delivers_through_repeated_reports() {
    let mut world = connected_world();
    world.fake.growth_losses = 0;
    world.fake.reload(world.now);
    world.fake.capacity = 4 * (8_042 + OVERHEAD) + 300;
    let snapshot = full_snapshot(6);
    world.send_snapshot(id(A), snapshot.clone());
    world.run_until_phase(Phase::Delivered, Duration::from_secs(60));
    assert_eq!(world.fake.stored_bytes.as_deref(), Some(snapshot.as_slice()));
    assert!(world.fake.lost_to_overflow > 0);
    assert_ne!(world.phase(), Phase::Failed);
}

#[test]
fn reordered_datagrams_still_deliver_and_duplicates_are_dropped() {
    for seed in 0..8 {
        let mut world = connected_world();
        world.fake.growth_losses = 0;
        world.fake.reload(world.now);
        world.fake.reorder = Some(seed);
        let snapshot = full_snapshot(7);
        world.send_snapshot(id(A), snapshot.clone());
        world.run_until_phase(Phase::Delivered, Duration::from_secs(60));
        assert_eq!(
            world.fake.stored_bytes.as_deref(),
            Some(snapshot.as_slice()),
            "seed {seed}"
        );
    }
}

#[test]
fn a_game_paused_mid_transfer_stalls_the_transfer_and_resumes_it_without_resending() {
    // The protocol's buffer budget is given at 92 B per datagram and, pessimistically, at 192 B.
    for overhead in [OVERHEAD, PESSIMISTIC_OVERHEAD] {
        paused_for_an_hour(overhead);
    }
}

fn paused_for_an_hour(overhead: usize) {
    let mut world = connected_world();
    world.fake.overhead = overhead;
    world.fake.growth_losses = 0;
    world.fake.reload(world.now);
    world.send_snapshot(id(A), full_snapshot(8));
    // Run until the first window is out, then pause the game before it polls again.
    world.run_until_phase(Phase::Awaiting, Duration::from_secs(5));
    world.fake.pause();
    let chunks_before = world.fake.chunks_taken;
    // An hour of pause: the bridge waits and sends only pings.
    let sent_before = world.fake.buffered_bytes();
    world.secs(3_600);
    assert_eq!(world.phase(), Phase::Awaiting, "no timeout fired");
    let status = world.status();
    assert_eq!(status.module.link, Link::Quiet);
    assert_eq!(status.transfer.as_ref().unwrap().state, TransferState::Stalled);
    assert_eq!(
        world.fake.lost_to_overflow, 0,
        "the buffer budget holds for an hour at {overhead} B per datagram"
    );
    assert!(world.fake.buffered_bytes() > sent_before, "pings piled up");
    assert!(world.fake.buffered_bytes() <= BUFFER);
    assert_eq!(world.fake.chunks_taken, chunks_before);

    let snapshot = world.fake.stored_bytes.clone();
    assert_eq!(snapshot, None);
    world.fake.resume(world.now);
    world.run_until_phase(Phase::Delivered, Duration::from_secs(30));
    assert_eq!(world.fake.duplicates, 0, "nothing was resent");
    assert_eq!(world.fake.stored.map(|(i, _)| i), Some(id(A)));
    assert_eq!(world.status().module.link, Link::Connected);
    // The status told the planner about the stall and the recovery.
    assert!(
        world
            .statuses
            .iter()
            .any(|(_, s)| s.transfer.as_ref().is_some_and(|t| t.state == TransferState::Stalled))
    );
}

#[test]
fn the_buffer_budget_for_a_probe_burst_and_a_window_survives_twelve_hours_of_pause() {
    for overhead in [OVERHEAD, PESSIMISTIC_OVERHEAD] {
        paused_for_twelve_hours(overhead);
    }
}

/// Worst case of the protocol's Buffer budget: a window, its end-of-window and a probe burst for a newer snapshot, all in
/// the buffer of a paused game, and then only the back-off pings.
fn paused_for_twelve_hours(overhead: usize) {
    let mut world = connected_world();
    world.fake.overhead = overhead;
    world.fake.growth_losses = 0;
    world.fake.reload(world.now);
    world.send_snapshot(id(A), full_snapshot(9));
    world.run_until_phase(Phase::Awaiting, Duration::from_secs(5));
    world.fake.pause();
    world.send_snapshot(id(B), full_snapshot(10));
    world.secs(12 * 3_600);
    assert_eq!(
        world.fake.lost_to_overflow, 0,
        "12 hours of pings fit beside a window and a probe burst at {overhead} B per datagram"
    );
    assert!(world.fake.buffered_bytes() < BUFFER);
    // The game comes back, and the newer snapshot is what arrives.
    world.fake.resume(world.now);
    world.run_until_phase(Phase::Delivered, Duration::from_secs(60));
    assert_eq!(world.fake.stored.map(|(i, _)| i), Some(id(B)));
}

#[test]
fn a_save_load_mid_transfer_restarts_from_a_probe_through_the_next_hello() {
    let mut world = connected_world();
    world.fake.growth_losses = 1;
    world.fake.reload(world.now);
    world.send_snapshot(id(A), full_snapshot(11));
    world.run_until_phase(Phase::Awaiting, Duration::from_secs(5));
    // The game loads a save: the reassembly is gone, the socket is small again.
    world.fake.reload(world.now);
    world.run_until_phase(Phase::Delivered, Duration::from_secs(60));
    assert_eq!(world.fake.stored.map(|(i, _)| i), Some(id(A)));
    assert!(world.fake.lost_to_growth >= 1);
}

#[test]
fn a_newer_snapshot_replaces_one_in_progress_and_the_old_one_is_never_stored() {
    let mut world = connected_world();
    world.fake.growth_losses = 0;
    world.fake.reload(world.now);
    world.send_snapshot(id(A), full_snapshot(12));
    world.run_until_phase(Phase::Awaiting, Duration::from_secs(5));
    let newer = full_snapshot(13);
    world.send_snapshot(id(B), newer.clone());
    world.run_until_phase(Phase::Delivered, Duration::from_secs(60));
    assert_eq!(world.fake.stored.map(|(i, _)| i), Some(id(B)));
    assert_eq!(world.fake.stored_bytes.as_deref(), Some(newer.as_slice()));
}

#[test]
fn a_restarted_bridge_finds_the_mod_through_its_first_ping_and_a_restored_snapshot_costs_no_datagram() {
    let mut world = connected_world();
    world.fake.growth_losses = 0;
    world.fake.reload(world.now);
    let snapshot = full_snapshot(14);
    world.send_snapshot(id(A), snapshot.clone());
    world.run_until_phase(Phase::Delivered, Duration::from_secs(10));
    let (chunks, probes) = (world.fake.chunks_taken, world.fake.probes_seen);

    // The bridge restarts: nothing is persisted, but the socket and the game stay.
    let transport = std::mem::replace(
        &mut world.driver,
        Driver::new(
            Bridge::new(world.now),
            Loopback {
                udp: UdpTransport::bind(0, 1).unwrap(),
                expected: 0,
            },
        ),
    )
    .into_transport();
    world.driver = Driver::new(Bridge::new(world.now), transport);
    world.turn();
    world.secs(1);
    let status = world.status();
    assert_eq!(status.module.link, Link::Connected);
    assert_eq!(
        status.module.stored,
        Some(id(A)),
        "the first hello shows what the mod stores"
    );
    assert!(
        status.transfer.is_none() && status.newest.is_none(),
        "the new bridge holds nothing"
    );

    // The planner restores the bytes it sent before: the mod stores them already, so no probe and no chunk.
    world.send_snapshot(id(A), snapshot);
    world.secs(2);
    assert_eq!(world.phase(), Phase::Delivered);
    assert_eq!((world.fake.chunks_taken, world.fake.probes_seen), (chunks, probes));
}

#[test]
fn a_game_that_is_closed_costs_the_pings_only_and_the_schedule_backs_off() {
    let mut world = World::new();
    world.fake.pause();
    world.secs(2 * 3_600);
    assert_eq!(world.fake.polls, 1, "only the very first poll, before the pause");
    // About 17 pings in the first 80 s, then slower: under 100 in two hours.
    assert!(
        world.fake.buffered_bytes() < 100 * (23 + OVERHEAD),
        "{}",
        world.fake.buffered_bytes()
    );
    assert_eq!(world.status().module.link, Link::None, "never heard");
}
