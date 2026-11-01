//! The server over real sockets: a WebSocket client plays the planner, a fake mod plays the mod and the game around it.
//!
//! Time is real here (the server reads the system clock), so these tests wait for the protocol's own timers: a warm-up probe
//! is repeated every 250 ms, and the fake mod polls every 166 ms. A transfer of a small snapshot takes about a second.

mod support;

use std::io;
use std::net::{SocketAddr, TcpListener, TcpStream, UdpSocket};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use bridge_lib::cli::Config;
use bridge_lib::protocol::{MAX_FRAME_BYTES, MAX_SNAPSHOT_BYTES};
use bridge_lib::server::{Limits, Server, ShutdownHandle};
use bridge_lib::ws::{encode_announce, encode_snapshot_frame};
use serde_json::Value;
use support::fake_mod::{FakeMod, snapshot_bytes};
use support::id;
use tungstenite::client::IntoClientRequest;
use tungstenite::protocol::frame::coding::CloseCode;
use tungstenite::{Error, HandshakeError, Message, WebSocket};

const ORIGIN: &str = "http://localhost:4000";
const WAIT: Duration = Duration::from_secs(20);

fn config(bridge_port: u16, game_port: u16) -> Config {
    Config {
        game_port,
        bridge_port,
        origins: vec![ORIGIN.to_owned(), "https://planner.test".to_owned()],
    }
}

/// A running server and the fake mod beside it.
struct Rig {
    port: u16,
    handle: ShutdownHandle,
    thread: Option<JoinHandle<io::Result<()>>>,
    fake: FakeMod,
}

impl Rig {
    fn start() -> Self {
        Self::start_with(Limits::default())
    }

    fn start_with(limits: Limits) -> Self {
        let mut server = Server::bind(&config(0, 1)).expect("bind");
        server.set_limits(limits);
        let port = server.port();
        let fake = FakeMod::new(SocketAddr::from(([127, 0, 0, 1], port)), Instant::now());
        server.set_game_port(fake.game_addr().port());
        Self::run(server, fake)
    }

    fn run(server: Server, fake: FakeMod) -> Self {
        Self {
            port: server.port(),
            handle: server.shutdown_handle(),
            thread: Some(thread::spawn(move || server.run())),
            fake,
        }
    }

    /// Stops the server and starts a new one on the same ports: the bridge restarted, the mod kept running.
    fn restart(&mut self) {
        self.stop();
        let server = Server::bind(&config(self.port, self.fake.game_addr().port())).expect("rebind the same port");
        self.handle = server.shutdown_handle();
        self.thread = Some(thread::spawn(move || server.run()));
    }

    fn stop(&mut self) {
        self.handle.shutdown();
        if let Some(thread) = self.thread.take() {
            thread
                .join()
                .expect("the server thread")
                .expect("the server ended cleanly");
        }
    }

    fn connect(&self, origin: Option<&str>) -> Result<Client, Error> {
        let mut request = format!("ws://127.0.0.1:{}/", self.port).into_client_request().unwrap();
        if let Some(origin) = origin {
            request.headers_mut().insert("Origin", origin.parse().unwrap());
        }
        let stream = TcpStream::connect(("127.0.0.1", self.port)).unwrap();
        let (socket, _) = tungstenite::client(request, stream).map_err(|e| match e {
            HandshakeError::Failure(e) => e,
            HandshakeError::Interrupted(_) => unreachable!("a blocking stream"),
        })?;
        socket
            .get_ref()
            .set_read_timeout(Some(Duration::from_millis(5)))
            .unwrap();
        Ok(Client { socket })
    }

    fn planner(&self) -> Client {
        self.connect(Some(ORIGIN)).expect("an allowed origin connects")
    }

    /// Lets the fake mod run while `Client` waits.
    fn pump(&mut self) {
        self.fake.step(Instant::now(), 0);
    }

    /// The next JSON text message of `client`.
    fn next(&mut self, client: &mut Client) -> Value {
        let deadline = Instant::now() + WAIT;
        while Instant::now() < deadline {
            self.pump();
            if let Some(Message::Text(text)) = client.read() {
                return serde_json::from_str(text.as_str()).unwrap();
            }
        }
        panic!("no message within {WAIT:?}");
    }

    /// Reads messages until a `status` satisfies `wanted`, and returns it.
    fn status_where(&mut self, client: &mut Client, what: &str, wanted: impl Fn(&Value) -> bool) -> Value {
        let deadline = Instant::now() + WAIT;
        let mut seen = Vec::new();
        while Instant::now() < deadline {
            let message = self.next(client);
            if message["type"] == "status" && wanted(&message) {
                return message;
            }
            seen.push(message);
        }
        panic!("no status where {what}; saw {seen:?}");
    }

    /// The code of the next `error` message (statuses in between are skipped).
    fn error(&mut self, client: &mut Client) -> String {
        loop {
            let message = self.next(client);
            if message["type"] == "error" {
                return message["code"].as_str().expect("a code").to_owned();
            }
        }
    }

    /// True if `client` receives no `error` within `quiet`.
    fn no_error(&mut self, client: &mut Client, quiet: Duration) -> bool {
        let until = Instant::now() + quiet;
        while Instant::now() < until {
            self.pump();
            if let Some(Message::Text(text)) = client.read()
                && text.as_str().contains(r#""error""#)
            {
                return false;
            }
        }
        true
    }

    fn delivered(&mut self, client: &mut Client, which: &str) -> Value {
        self.status_where(client, &format!("{which} is delivered"), |s| {
            s["transfer"]["id"] == which && s["transfer"]["state"] == "delivered"
        })
    }
}

impl Drop for Rig {
    fn drop(&mut self) {
        self.handle.shutdown();
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

struct Client {
    socket: WebSocket<TcpStream>,
}

impl Client {
    /// One message, or `None` after the short read timeout.
    fn read(&mut self) -> Option<Message> {
        match self.socket.read() {
            Ok(message) => Some(message),
            Err(Error::Io(e)) if matches!(e.kind(), io::ErrorKind::WouldBlock | io::ErrorKind::TimedOut) => None,
            Err(e) => panic!("the connection failed: {e}"),
        }
    }

    fn send_binary(&mut self, bytes: Vec<u8>) {
        self.socket.send(Message::binary(bytes)).expect("send");
    }

    fn send_text(&mut self, text: &str) {
        self.socket.send(Message::text(text)).expect("send");
    }

    fn send_snapshot(&mut self, which: &str, bytes: &[u8]) {
        self.send_binary(encode_snapshot_frame(&id(which), bytes));
    }
}

const A: &str = "9b3b078dbd018b94";
const B: &str = "efb9607ec1bac090";

// -------------------------------------------------------------------------------------------------
// Origin
// -------------------------------------------------------------------------------------------------

#[test]
fn an_allowed_origin_connects_and_the_first_message_is_the_status() {
    let mut rig = Rig::start();
    for origin in [Some(ORIGIN), Some("https://planner.test"), None] {
        let mut client = rig.connect(origin).expect("allowed");
        let first = rig.next(&mut client);
        assert_eq!(first["type"], "status");
        assert_eq!(first["protocol"], 1);
        assert_eq!(first["bridge"], env!("CARGO_PKG_VERSION"));
        assert!(
            first.get("transfer").is_none() && first.get("newest").is_none(),
            "{first}"
        );
    }
}

#[test]
fn a_disallowed_origin_gets_http_403() {
    let rig = Rig::start();
    for origin in [
        "https://evil.example",
        "http://localhost:5174",
        "http://localhost:4000.evil.example",
        "",
    ] {
        match rig.connect(Some(origin)) {
            Err(Error::Http(response)) => assert_eq!(response.status().as_u16(), 403, "{origin:?}"),
            Err(other) => panic!("{origin:?}: expected an HTTP 403, got {other}"),
            Ok(_) => panic!("{origin:?} must not connect"),
        }
    }
    // The refusals did not disturb the server.
    drop(rig.planner());
}

// -------------------------------------------------------------------------------------------------
// Frames
// -------------------------------------------------------------------------------------------------

#[test]
fn errors_go_to_the_sender_only_and_the_connection_stays_open() {
    let mut rig = Rig::start();
    let (mut sender, mut other) = (rig.planner(), rig.planner());
    rig.next(&mut sender);
    rig.next(&mut other);

    sender.send_binary(b"not an envelope".to_vec());
    assert_eq!(rig.error(&mut sender), "bad-envelope");

    // The length field says 5 and the body is 3 bytes.
    let mut short = encode_snapshot_frame(&id(A), b"12345");
    short.truncate(35);
    sender.send_binary(short);
    assert_eq!(rig.error(&mut sender), "bad-envelope");

    sender.send_binary(b"FP02 S 9b3b078dbd018b94 0000001 x".to_vec());
    assert_eq!(rig.error(&mut sender), "protocol-mismatch");

    sender.send_text(r#"{"type":"announce","protocol":2,"id":"9b3b078dbd018b94"}"#);
    assert_eq!(rig.error(&mut sender), "protocol-mismatch");

    for text in [
        "nonsense",
        r#"{"type":"hello"}"#,
        r#"{"type":"announce","protocol":1,"id":"short"}"#,
    ] {
        sender.send_text(text);
        assert_eq!(rig.error(&mut sender), "bad-message", "{text}");
    }

    assert!(
        rig.no_error(&mut other, Duration::from_millis(300)),
        "an error is for the sender alone"
    );

    // Nothing changed and the connection works: an announce is answered by a status for both.
    sender.send_text(&encode_announce(&id(B)));
    for client in [&mut sender, &mut other] {
        let status = rig.status_where(client, "newest is set", |s| s["newest"] == B);
        assert!(
            status.get("transfer").is_none(),
            "an announce starts no transfer: {status}"
        );
    }
}

#[test]
fn an_oversized_but_legal_frame_is_answered_with_too_large() {
    let mut rig = Rig::start();
    let mut planner = rig.planner();
    rig.next(&mut planner);

    // 32 B of envelope plus the largest length its field can state: exactly MAX_FRAME_BYTES.
    let mut frame = format!("FP01 S {A} 9999999 ").into_bytes();
    frame.resize(MAX_FRAME_BYTES, b'x');
    assert_eq!(frame.len(), MAX_FRAME_BYTES);
    planner.send_binary(frame);
    assert_eq!(rig.error(&mut planner), "too-large");

    // Just above the guard: the envelope alone decides, whatever follows.
    let mut frame = format!("FP01 S {A} {:07} ", MAX_SNAPSHOT_BYTES + 1).into_bytes();
    frame.resize(32 + MAX_SNAPSHOT_BYTES + 1, b'x');
    planner.send_binary(frame);
    assert_eq!(rig.error(&mut planner), "too-large");

    // The connection is still open and nothing was stored.
    planner.send_text(&encode_announce(&id(B)));
    let status = rig.status_where(&mut planner, "newest is set", |s| s["newest"] == B);
    assert!(status.get("transfer").is_none(), "{status}");
}

#[test]
fn a_frame_above_the_frame_limit_closes_the_connection_with_1009() {
    let mut rig = Rig::start();
    let mut planner = rig.planner();
    rig.next(&mut planner);

    // The client writes the whole 10 MB while the server has already decided: the server must keep reading what it will not
    // use, or closing would reset the connection and the close frame would never be seen (a browser reports 1006).
    let mut frame = format!("FP01 S {A} 0000001 ").into_bytes();
    frame.resize(MAX_FRAME_BYTES + 1, b'x');
    planner
        .socket
        .send(Message::binary(frame))
        .expect("the whole frame is taken");

    let deadline = Instant::now() + WAIT;
    let mut closed_with = None;
    while Instant::now() < deadline {
        rig.pump();
        match planner.socket.read() {
            Ok(Message::Close(frame)) => {
                closed_with = Some(frame.map(|f| f.code));
                break;
            }
            Ok(_) => {}
            Err(Error::Io(e)) if matches!(e.kind(), io::ErrorKind::WouldBlock | io::ErrorKind::TimedOut) => {}
            Err(e) => panic!("the connection ended without the close frame: {e}"),
        }
    }
    assert_eq!(closed_with, Some(Some(CloseCode::Size)), "a close frame with code 1009");

    // Another planner is served as before, and the bridge holds nothing.
    let mut again = rig.planner();
    let status = rig.next(&mut again);
    assert!(
        status.get("transfer").is_none() && status.get("newest").is_none(),
        "{status}"
    );
}

// -------------------------------------------------------------------------------------------------
// Relaying and status
// -------------------------------------------------------------------------------------------------

#[test]
fn a_snapshot_reaches_the_mod_as_the_same_bytes_and_every_planner_hears_the_status() {
    let mut rig = Rig::start();
    let (mut sender, mut watcher) = (rig.planner(), rig.planner());
    rig.next(&mut sender);
    rig.next(&mut watcher);

    // Three chunks.
    let bytes = snapshot_bytes(20_000, 7);
    sender.send_snapshot(A, &bytes);
    let status = rig.status_where(&mut sender, "the snapshot is held", |s| s["transfer"]["id"] == A);
    assert_eq!(status["newest"], A);
    assert_eq!(status["transfer"]["count"], 3);

    for client in [&mut sender, &mut watcher] {
        let status = rig.delivered(client, A);
        assert_eq!(status["mod"]["link"], "connected");
        assert_eq!(status["mod"]["stored"], A);
        assert_eq!(status["mod"]["protocol"], 1);
        assert_eq!(status["transfer"]["sent"], 3);
    }
    assert_eq!(rig.fake.stored_bytes.as_deref(), Some(bytes.as_slice()));
}

#[test]
fn a_new_connection_gets_the_whole_status_first() {
    let mut rig = Rig::start();
    let mut first = rig.planner();
    rig.next(&mut first);
    first.send_snapshot(A, &snapshot_bytes(600, 1));
    rig.delivered(&mut first, A);

    let mut late = rig.planner();
    let status = rig.next(&mut late);
    assert_eq!(status["type"], "status");
    assert_eq!(status["transfer"]["id"], A);
    assert_eq!(status["transfer"]["state"], "delivered");
    assert_eq!(status["newest"], A);
}

#[test]
fn the_last_snapshot_wins_whichever_planner_sent_it() {
    let mut rig = Rig::start();
    let (mut one, mut two) = (rig.planner(), rig.planner());
    rig.next(&mut one);
    rig.next(&mut two);

    one.send_snapshot(A, &snapshot_bytes(600, 1));
    rig.delivered(&mut one, A);
    let newer = snapshot_bytes(900, 2);
    two.send_snapshot(B, &newer);
    rig.delivered(&mut one, B);
    rig.delivered(&mut two, B);
    assert_eq!(rig.fake.stored_bytes.as_deref(), Some(newer.as_slice()));
}

#[test]
fn a_planner_that_reconnects_sees_what_the_bridge_holds() {
    let mut rig = Rig::start();
    let mut planner = rig.planner();
    rig.next(&mut planner);
    planner.send_snapshot(A, &snapshot_bytes(600, 1));
    rig.delivered(&mut planner, A);
    drop(planner);

    // Not a restart: the first status shows a transfer, so a planner would send nothing (protocol.md, "Two planners").
    let mut planner = rig.planner();
    let status = rig.next(&mut planner);
    assert_eq!(status["transfer"]["id"], A);
    assert_eq!(status["transfer"]["state"], "delivered");
}

#[test]
fn a_restarted_bridge_holds_nothing_and_a_restored_snapshot_costs_no_datagram() {
    let mut rig = Rig::start();
    let mut planner = rig.planner();
    rig.next(&mut planner);
    let bytes = snapshot_bytes(20_000, 3);
    planner.send_snapshot(A, &bytes);
    rig.delivered(&mut planner, A);
    let taken = rig.fake.chunks_taken;
    drop(planner);

    rig.restart();
    let mut planner = rig.planner();
    let first = rig.next(&mut planner);
    assert!(
        first.get("transfer").is_none() && first.get("newest").is_none(),
        "the bridge holds nothing: {first}"
    );

    // The mod answers the first ping, and still stores A.
    rig.status_where(&mut planner, "the mod is heard", |s| {
        s["mod"]["link"] == "connected" && s["mod"]["stored"] == A
    });

    // The planner restores the bytes it last sent. The mod has them, so the bridge sends no chunk.
    planner.send_snapshot(A, &bytes);
    let status = rig.delivered(&mut planner, A);
    assert_eq!(status["transfer"]["sent"], status["transfer"]["count"]);
    assert_eq!(rig.fake.chunks_taken, taken, "no chunk was sent again");

    // A newer plan announced after the restore shows up as `newest`.
    planner.send_text(&encode_announce(&id(B)));
    rig.status_where(&mut planner, "newest is B", |s| s["newest"] == B);
}

#[test]
fn the_status_follows_the_mod_when_the_game_goes_quiet() {
    // QUIET_AFTER is 15 s in the protocol; one second shows the same flip. Pings are 5 s apart, so the pause is what matters.
    let mut rig = Rig::start_with(Limits {
        quiet_after: Duration::from_secs(1),
        ..Limits::default()
    });
    let mut planner = rig.planner();
    rig.next(&mut planner);
    rig.status_where(&mut planner, "the mod is heard", |s| s["mod"]["link"] == "connected");
    rig.fake.pause();
    rig.status_where(&mut planner, "the link is quiet", |s| s["mod"]["link"] == "quiet");
}

// -------------------------------------------------------------------------------------------------
// Limits
// -------------------------------------------------------------------------------------------------

#[test]
fn origins_match_in_canonical_form_only() {
    let rig = Rig::start();
    // Case and the default port do not matter ...
    drop(rig.connect(Some("HTTPS://Planner.TEST:443")).expect("the same origin"));
    // ... another port, a subdomain or a suffix is another origin.
    for origin in [
        "https://planner.test:444",
        "https://x.planner.test",
        "https://planner.test.evil",
        "null",
    ] {
        assert!(
            matches!(rig.connect(Some(origin)), Err(Error::Http(r)) if r.status().as_u16() == 403),
            "{origin}"
        );
    }
}

#[test]
fn connections_beyond_the_cap_are_closed_and_slots_come_back() {
    let rig = Rig::start_with(Limits {
        max_connections: 2,
        ..Limits::default()
    });
    let planner = rig.planner();
    // A client that connects and never speaks holds a slot too, before any handshake.
    let idle = TcpStream::connect(("127.0.0.1", rig.port)).unwrap();
    // Wait until the server has counted both.
    let mut refused = false;
    for _ in 0..200 {
        if rig.connect(Some(ORIGIN)).is_err() {
            refused = true;
            break;
        }
        thread::sleep(Duration::from_millis(10));
    }
    assert!(refused, "a third connection must be refused");

    drop(idle);
    let deadline = Instant::now() + WAIT;
    loop {
        if rig.connect(Some(ORIGIN)).is_ok() {
            break;
        }
        assert!(
            Instant::now() < deadline,
            "the slot of the closed connection never came back"
        );
        thread::sleep(Duration::from_millis(20));
    }
    drop(planner);
}

#[test]
fn a_planner_that_stops_reading_is_dropped_and_the_others_are_not_held_up() {
    let mut rig = Rig::start_with(Limits {
        outbox_capacity: 1000,
        write_timeout: Duration::from_secs(1),
        ..Limits::default()
    });
    let (mut frozen, mut active) = (rig.planner(), rig.planner());
    rig.next(&mut frozen);
    rig.next(&mut active);

    // Every announce with a new id changes the status, and every status goes to both planners. `frozen` reads none of them.
    let last = 30_000_u64;
    for batch in 0..(last / 50) {
        for i in 1..=50 {
            active.send_text(&encode_announce(&id(&format!("{:016x}", batch * 50 + i))));
        }
        while let Some(message) = active.read() {
            drop(message);
        }
        rig.pump();
    }
    // The bridge was never held up by `frozen`: `active` sees the last status.
    let wanted = format!("{last:016x}");
    rig.status_where(&mut active, "the last announce arrived", |s| {
        s["newest"] == wanted.as_str()
    });

    // `frozen` was dropped: after the messages already in its socket, its connection ends instead of staying open for ever.
    let deadline = Instant::now() + WAIT;
    loop {
        match frozen.socket.read() {
            Ok(Message::Close(_)) => break,
            Ok(_) => {}
            Err(Error::Io(e)) if matches!(e.kind(), io::ErrorKind::WouldBlock | io::ErrorKind::TimedOut) => {}
            Err(_) => break,
        }
        assert!(
            Instant::now() < deadline,
            "the connection of a planner that stopped reading stayed open"
        );
    }
}

// -------------------------------------------------------------------------------------------------
// Ports
// -------------------------------------------------------------------------------------------------

#[test]
fn a_taken_tcp_port_is_an_actionable_error() {
    let taken = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = taken.local_addr().unwrap().port();
    let error = Server::bind(&config(port, 1))
        .err()
        .expect("the port is taken")
        .to_string();
    assert!(error.contains(&port.to_string()) && error.contains("TCP"), "{error}");
    assert!(error.contains("--bridge-port"), "{error}");
}

#[test]
fn a_taken_udp_port_is_an_actionable_error() {
    // The TCP port of the same number must be free, or the error would be about TCP.
    let (taken, port) = loop {
        let udp = UdpSocket::bind("127.0.0.1:0").unwrap();
        let port = udp.local_addr().unwrap().port();
        if TcpListener::bind(("127.0.0.1", port)).is_ok() {
            break (udp, port);
        }
    };
    let error = Server::bind(&config(port, 1))
        .err()
        .expect("the port is taken")
        .to_string();
    assert!(error.contains(&port.to_string()) && error.contains("UDP"), "{error}");
    assert!(error.contains("--bridge-port"), "{error}");
    drop(taken);
}

#[test]
fn the_ports_are_free_again_after_the_server_stops() {
    let mut rig = Rig::start();
    rig.stop();
    drop(Server::bind(&config(rig.port, 1)).expect("both ports were released"));
}
