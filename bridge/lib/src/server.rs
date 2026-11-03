//! The sockets of the bridge: a WebSocket endpoint for planners and a UDP socket to the mod, around one [`Driver`].
//!
//! Threads, no async runtime. One thread owns the [`Bridge`] (through its [`Driver`]) and the clock; the others only move bytes
//! to it over one channel of [`Event`]s:
//!
//! - the **acceptor** takes TCP connections and starts a thread for each;
//! - a **connection** thread does the handshake (and the `Origin` check), then owns its WebSocket: it reads frames and, between
//!   reads, writes what the session thread queued for it. The read timeout [`POLL`] bounds that delay;
//! - the **UDP reader** forwards the mod's datagrams.
//!
//! The session thread sleeps until the next thing the bridge is due to do or the next event, whichever comes first.
//! Everything is bound to `127.0.0.1`. Nothing is written to disk.

use std::collections::{HashMap, VecDeque};
use std::fmt;
use std::io;
use std::io::Read;
use std::net::{Ipv4Addr, Shutdown, SocketAddr, TcpListener, TcpStream, UdpSocket};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::mpsc::{self, Receiver, Sender, SyncSender, TrySendError};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use tungstenite::error::{CapacityError, Error as WsError};
use tungstenite::handshake::server::{ErrorResponse, Request, Response};
use tungstenite::http::StatusCode;
use tungstenite::protocol::frame::coding::CloseCode;
use tungstenite::protocol::{CloseFrame, WebSocketConfig};
use tungstenite::{Message, WebSocket};

use crate::bridge::{Bridge, SnapshotError};
use crate::cli::{Config, canonical_origin};
use crate::driver::{Driver, Outcome, Step, Transport, classify};
use crate::protocol::{MAX_FRAME_BYTES, QUIET_AFTER, WS_ENVELOPE};
use crate::ws::{ErrorCode, PlannerText, parse_snapshot_frame, parse_text_frame};

/// How long a connection thread waits for a frame before it looks at what the session queued for it.
const POLL: Duration = Duration::from_millis(25);
/// A client that has not finished the opening handshake by then is dropped.
const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(5);
/// After refusing an oversized frame, how long and how many bytes of the rest of it are read and discarded, so that closing the
/// socket does not reset the connection and take the close frame with it.
const LINGER: Duration = Duration::from_secs(5);
const LINGER_BYTES: usize = 32 * 1024 * 1024;
/// Pause after a failed `accept` (typically out of file descriptors), so that the failure does not spin a core.
const ACCEPT_BACKOFF: Duration = Duration::from_millis(50);
/// Tries at finding a port that is free for both TCP and UDP when the port asked for is 0.
const PORT_ATTEMPTS: usize = 50;

/// Bounds on what the server holds. The defaults suit a player's machine; tests shrink them.
#[derive(Debug, Clone, Copy)]
pub struct Limits {
    /// Concurrent TCP connections, counting those still in the opening handshake. The excess is closed at once.
    pub max_connections: usize,
    /// Messages queued for one planner. A planner whose queue is full (its tab is frozen, or its thread is stuck in a write) is
    /// dropped instead of holding memory for ever.
    pub outbox_capacity: usize,
    /// A planner that does not take a frame in this time is dropped.
    pub write_timeout: Duration,
    /// How long the mod may be silent before the link is `quiet` ([`QUIET_AFTER`], 15 s, in the protocol).
    pub quiet_after: Duration,
}

impl Default for Limits {
    fn default() -> Self {
        Self {
            max_connections: 32,
            outbox_capacity: 64,
            write_timeout: Duration::from_secs(10),
            quiet_after: QUIET_AFTER,
        }
    }
}

/// Why the server could not start.
#[derive(Debug)]
pub struct BindError {
    protocol: &'static str,
    port: u16,
    source: io::Error,
}

impl fmt::Display for BindError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let what = if self.protocol == "TCP" {
            "the planner's WebSocket"
        } else {
            "the mod's UDP datagrams"
        };
        write!(
            f,
            "cannot listen on 127.0.0.1:{} ({}, for {what}): {}.",
            self.port, self.protocol, self.source
        )?;
        if self.source.kind() == io::ErrorKind::AddrInUse {
            write!(
                f,
                " Another bridge, or another program, is using that port. Stop it, or choose a free port with --bridge-port \
                 (and set the same number in the mod's settings)."
            )?;
        }
        Ok(())
    }
}

impl std::error::Error for BindError {}

/// Something the session thread must react to.
enum Event {
    /// A datagram from the mod.
    Datagram(Vec<u8>),
    /// A planner finished its handshake. `outbox` is how the session talks to it.
    Opened { conn: u64, outbox: SyncSender<String> },
    /// A planner sent a frame.
    Frame { conn: u64, frame: Frame },
    /// A planner's connection ended.
    Closed { conn: u64 },
    /// The UDP socket failed for good.
    UdpFailed(io::Error),
    /// Stop.
    Shutdown,
}

/// A frame from a planner.
enum Frame {
    Binary(Vec<u8>),
    Text(String),
}

/// Asks a running [`Server`] to stop. Cloneable and usable from any thread.
#[derive(Clone)]
pub struct ShutdownHandle {
    flag: Arc<AtomicBool>,
    events: Sender<Event>,
}

impl ShutdownHandle {
    /// Makes [`Server::run`] return, after it has closed the sockets.
    pub fn shutdown(&self) {
        self.flag.store(true, Ordering::SeqCst);
        // The server may be gone already.
        let _ = self.events.send(Event::Shutdown);
    }
}

/// The bound sockets, ready to [`run`](Server::run).
pub struct Server {
    listener: TcpListener,
    udp: UdpSocket,
    game: SocketAddr,
    origins: Vec<String>,
    limits: Limits,
    stop: Arc<AtomicBool>,
    events: Sender<Event>,
    inbox: Receiver<Event>,
}

impl Server {
    /// Binds `127.0.0.1:<bridge_port>` for TCP and UDP. With port 0 the system picks a port that is free for both.
    ///
    /// # Errors
    /// [`BindError`], with an actionable message, if either socket cannot be bound, typically because the port is taken.
    pub fn bind(config: &Config) -> Result<Self, BindError> {
        let (listener, udp) = if config.bridge_port == 0 {
            bind_any_port()?
        } else {
            bind_pair(config.bridge_port)?
        };
        let (events, inbox) = mpsc::channel();
        Ok(Self {
            listener,
            udp,
            game: SocketAddr::from((Ipv4Addr::LOCALHOST, config.game_port)),
            origins: config.origins.iter().filter_map(|o| canonical_origin(o)).collect(),
            limits: Limits::default(),
            stop: Arc::new(AtomicBool::new(false)),
            events,
            inbox,
        })
    }

    /// The port both sockets are bound to.
    #[must_use]
    pub fn port(&self) -> u16 {
        self.listener.local_addr().map_or(0, |a| a.port())
    }

    /// Changes the port datagrams are sent to. For tests, where the game's port is not known before the bridge's.
    pub fn set_game_port(&mut self, game_port: u16) {
        self.game = SocketAddr::from((Ipv4Addr::LOCALHOST, game_port));
    }

    /// Replaces the [`Limits`]. For tests.
    pub fn set_limits(&mut self, limits: Limits) {
        self.limits = limits;
    }

    /// A handle that stops [`Server::run`].
    #[must_use]
    pub fn shutdown_handle(&self) -> ShutdownHandle {
        ShutdownHandle {
            flag: Arc::clone(&self.stop),
            events: self.events.clone(),
        }
    }

    /// One line for the log when the server starts.
    #[must_use]
    pub fn banner(&self) -> String {
        format!(
            "factorio-planner-bridge {} listening on ws://127.0.0.1:{port}/ and udp://127.0.0.1:{port}, game at udp://{}; allowed origins: {}",
            env!("CARGO_PKG_VERSION"),
            self.game,
            self.origins.join(", "),
            port = self.port(),
        )
    }

    /// Serves until [`ShutdownHandle::shutdown`] is called or the UDP socket fails.
    ///
    /// # Errors
    /// A failure of the UDP socket that is not one of the harmless ones the game's closing causes.
    pub fn run(self) -> io::Result<()> {
        let Self {
            listener,
            udp,
            game,
            origins,
            limits,
            stop,
            events,
            inbox,
        } = self;
        let tcp_addr = listener.local_addr()?;
        let udp_addr = udp.local_addr()?;

        let acceptor = {
            let (events, stop, origins) = (events.clone(), Arc::clone(&stop), Arc::new(origins));
            thread::Builder::new()
                .name("accept".into())
                .spawn(move || accept_loop(&listener, &origins, limits, &stop, &events))?
        };
        let reader = {
            let (socket, events, stop) = (udp.try_clone()?, events.clone(), Arc::clone(&stop));
            thread::Builder::new()
                .name("udp".into())
                .spawn(move || udp_loop(&socket, &stop, &events))?
        };
        drop(events);

        let result = Session::new(Queue::new(udp, game), limits.quiet_after).run(&inbox);

        // Wake the two threads that sleep in a system call, and wait for them, so that the ports are free when this returns.
        stop.store(true, Ordering::SeqCst);
        let _ = TcpStream::connect(tcp_addr);
        let _ = UdpSocket::bind((Ipv4Addr::LOCALHOST, 0)).and_then(|s| s.send_to(&[0], udp_addr));
        join(acceptor);
        join(reader);
        result
    }
}

fn join(handle: JoinHandle<()>) {
    let _ = handle.join();
}

fn bind_pair(port: u16) -> Result<(TcpListener, UdpSocket), BindError> {
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, port)).map_err(|source| BindError {
        protocol: "TCP",
        port,
        source,
    })?;
    let udp = UdpSocket::bind((Ipv4Addr::LOCALHOST, port)).map_err(|source| BindError {
        protocol: "UDP",
        port,
        source,
    })?;
    Ok((listener, udp))
}

fn bind_any_port() -> Result<(TcpListener, UdpSocket), BindError> {
    let mut last = None;
    for _ in 0..PORT_ATTEMPTS {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).map_err(|source| BindError {
            protocol: "TCP",
            port: 0,
            source,
        })?;
        let port = listener.local_addr().map_or(0, |a| a.port());
        match UdpSocket::bind((Ipv4Addr::LOCALHOST, port)) {
            Ok(udp) => return Ok((listener, udp)),
            Err(source) => {
                last = Some(BindError {
                    protocol: "UDP",
                    port,
                    source,
                });
            }
        }
    }
    Err(last.expect("at least one attempt"))
}

// ---------------------------------------------------------------------------------------------
// The session thread
// ---------------------------------------------------------------------------------------------

/// The mod's datagrams, handed over by the UDP reader thread, and the socket to send on.
///
/// The server cannot use [`UdpTransport`](crate::driver::UdpTransport) as it is: the session thread has to sleep until the
/// bridge's next timer *or* a planner's frame, which one thread cannot do on a blocking UDP read and a channel at once, and
/// polling both would wake it many times a second. So a thread blocks on the socket and wakes the session through the same
/// channel as the planners; only the error classification ([`classify`]) is shared with the library's transport.
struct Queue {
    socket: UdpSocket,
    game: SocketAddr,
    inbox: VecDeque<Vec<u8>>,
}

impl Queue {
    fn new(socket: UdpSocket, game: SocketAddr) -> Self {
        Self {
            socket,
            game,
            inbox: VecDeque::new(),
        }
    }
}

impl Transport for Queue {
    fn game_port(&self) -> Option<u16> {
        Some(self.game.port())
    }

    fn send(&mut self, datagram: &[u8]) -> io::Result<()> {
        self.socket.send_to(datagram, self.game).map(|_| ())
    }

    fn recv(&mut self) -> io::Result<Option<Vec<u8>>> {
        Ok(self.inbox.pop_front())
    }
}

struct Session {
    driver: Driver<Queue>,
    planners: HashMap<u64, SyncSender<String>>,
}

impl Session {
    fn new(queue: Queue, quiet_after: Duration) -> Self {
        let mut bridge = Bridge::new(Instant::now());
        bridge.set_quiet_after(quiet_after);
        Self {
            driver: Driver::new(bridge, queue),
            planners: HashMap::new(),
        }
    }

    fn run(mut self, events: &Receiver<Event>) -> io::Result<()> {
        // The first ping leaves now.
        self.step()?;
        loop {
            let now = Instant::now();
            let wait = self
                .driver
                .bridge()
                .poll_timeout(now)
                .saturating_duration_since(now)
                .max(Duration::from_millis(1));
            let first = match events.recv_timeout(wait) {
                Ok(event) => Some(event),
                Err(mpsc::RecvTimeoutError::Timeout) => None,
                Err(mpsc::RecvTimeoutError::Disconnected) => return Ok(()),
            };
            for event in first.into_iter().chain(std::iter::from_fn(|| events.try_recv().ok())) {
                match event {
                    Event::Shutdown => return Ok(()),
                    Event::UdpFailed(e) => return Err(e),
                    Event::Datagram(datagram) => self.driver.transport_mut().inbox.push_back(datagram),
                    Event::Opened { conn, outbox } => self.on_opened(conn, outbox),
                    Event::Closed { conn } => {
                        self.planners.remove(&conn);
                    }
                    Event::Frame { conn, frame } => self.on_frame(conn, frame),
                }
            }
            self.step()?;
        }
    }

    /// Hears the mod, does what is due and sends the datagrams that produces.
    fn step(&mut self) -> io::Result<()> {
        let step = self.driver.step(Instant::now())?;
        self.publish(step);
        Ok(())
    }

    fn on_opened(&mut self, conn: u64, outbox: SyncSender<String>) {
        // The first message of a connection is the status, before anything else.
        let status = self.driver.bridge().status(Instant::now()).to_json();
        if outbox.try_send(status).is_ok() {
            self.planners.insert(conn, outbox);
        }
    }

    fn on_frame(&mut self, conn: u64, frame: Frame) {
        let now = Instant::now();
        match frame {
            Frame::Binary(frame) => self.on_snapshot(now, conn, frame),
            Frame::Text(text) => match parse_text_frame(&text) {
                Ok(PlannerText::Announce { id }) => {
                    let step = self.driver.announce(now, id);
                    self.publish(step);
                }
                Err(code) => self.reply_error(conn, code),
            },
        }
    }

    fn on_snapshot(&mut self, now: Instant, conn: u64, mut frame: Vec<u8>) {
        let id = match parse_snapshot_frame(&frame) {
            Ok(parsed) => parsed.id,
            Err(code) => return self.reply_error(conn, code),
        };
        // The snapshot stays opaque: drop the envelope and keep the rest, in the same allocation.
        frame.drain(..WS_ENVELOPE);
        match self.driver.receive_snapshot(now, id, frame) {
            Ok(step) => self.publish(step),
            Err(SnapshotError::Empty) => self.reply_error(conn, ErrorCode::BadEnvelope),
            Err(SnapshotError::TooLarge) => self.reply_error(conn, ErrorCode::TooLarge),
        }
    }

    /// An `error` goes only to the connection that sent the offending frame.
    fn reply_error(&mut self, conn: u64, code: ErrorCode) {
        if let Some(outbox) = self.planners.get(&conn)
            && !queue(conn, outbox, code.to_json())
        {
            self.planners.remove(&conn);
        }
    }

    /// Sends a changed status to every planner.
    fn publish(&mut self, step: Step) {
        if let Some(status) = step.status {
            let json = status.to_json();
            self.planners.retain(|&conn, outbox| queue(conn, outbox, json.clone()));
        }
    }
}

/// Queues a message for a planner without ever waiting. False if the planner is gone or too far behind, and must be dropped:
/// dropping its sender makes its thread close the connection once it has written what is queued.
fn queue(conn: u64, outbox: &SyncSender<String>, message: String) -> bool {
    match outbox.try_send(message) {
        Ok(()) => true,
        Err(TrySendError::Disconnected(_)) => false,
        Err(TrySendError::Full(_)) => {
            eprintln!("dropped planner {conn}: it stopped reading its messages");
            false
        }
    }
}

// ---------------------------------------------------------------------------------------------
// The other threads
// ---------------------------------------------------------------------------------------------

fn udp_loop(socket: &UdpSocket, stop: &AtomicBool, events: &Sender<Event>) {
    let mut buffer = vec![0_u8; 65_536];
    loop {
        let received = classify(socket.recv_from(&mut buffer).map(|(n, _)| n));
        if stop.load(Ordering::SeqCst) {
            return;
        }
        match received {
            Ok(Outcome::Datagram(n)) => {
                if events.send(Event::Datagram(buffer[..n].to_vec())).is_err() {
                    return;
                }
            }
            // Nothing to read, or an error that means nothing (the game's port was closed, a signal came in).
            Ok(Outcome::Empty | Outcome::Ignored) => {}
            Err(e) => {
                let _ = events.send(Event::UdpFailed(e));
                return;
            }
        }
    }
}

/// Counts a connection while it lives, from `accept` to the end of its thread.
struct Slot(Arc<AtomicUsize>);

impl Drop for Slot {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::SeqCst);
    }
}

fn accept_loop(
    listener: &TcpListener,
    origins: &Arc<Vec<String>>,
    limits: Limits,
    stop: &AtomicBool,
    events: &Sender<Event>,
) {
    let (mut next, active) = (0_u64, Arc::new(AtomicUsize::new(0)));
    for stream in listener.incoming() {
        if stop.load(Ordering::SeqCst) {
            return;
        }
        let stream = match stream {
            Ok(stream) => stream,
            Err(e) => {
                eprintln!("accept failed: {e}");
                thread::sleep(ACCEPT_BACKOFF);
                continue;
            }
        };
        if active.fetch_add(1, Ordering::SeqCst) >= limits.max_connections {
            active.fetch_sub(1, Ordering::SeqCst);
            eprintln!("refused a connection: {} are open already", limits.max_connections);
            continue;
        }
        let slot = Slot(Arc::clone(&active));
        next += 1;
        let (conn, origins, events) = (next, Arc::clone(origins), events.clone());
        // If the thread cannot start, the closure is dropped with its slot and its stream, and the next connection may do better.
        let _ = thread::Builder::new().name(format!("planner-{conn}")).spawn(move || {
            let _slot = slot;
            serve_connection(conn, stream, &origins, limits, &events);
        });
    }
}

fn websocket_config() -> WebSocketConfig {
    // The default limits are above this today; naming them keeps the contract (MAX_FRAME_BYTES, so that `too-large` can be
    // answered) from depending on a library default. A frame above it is closed with code 1009.
    WebSocketConfig::default()
        .max_message_size(Some(MAX_FRAME_BYTES))
        .max_frame_size(Some(MAX_FRAME_BYTES))
}

/// The handshake callback: a browser always sends `Origin` on a WebSocket, so a page that is not allowed gets a 403.
/// A client with no `Origin` header is not a browser page (a script or a test), and a local process can reach the port anyway.
// The error type is the library's callback signature.
#[allow(clippy::result_large_err)]
fn check_origin(request: &Request, response: Response, origins: &[String]) -> Result<Response, ErrorResponse> {
    let origin = request.headers().get("origin").map(|v| v.to_str().unwrap_or(""));
    match origin {
        Some(origin) if !canonical_origin(origin).is_some_and(|o| origins.contains(&o)) => {
            eprintln!("refused a connection from the origin {origin:?}; allow it with --origin if it is yours");
            let mut refusal = ErrorResponse::new(Some("origin not allowed\n".to_owned()));
            *refusal.status_mut() = StatusCode::FORBIDDEN;
            Err(refusal)
        }
        _ => Ok(response),
    }
}

fn serve_connection(conn: u64, stream: TcpStream, origins: &[String], limits: Limits, events: &Sender<Event>) {
    let _ = stream.set_nodelay(true);
    if stream.set_read_timeout(Some(HANDSHAKE_TIMEOUT)).is_err()
        || stream.set_write_timeout(Some(limits.write_timeout)).is_err()
    {
        return;
    }
    #[allow(clippy::result_large_err)]
    let callback = |request: &Request, response: Response| check_origin(request, response, origins);
    let Ok(mut socket) = tungstenite::accept_hdr_with_config(stream, callback, Some(websocket_config())) else {
        return;
    };
    if socket.get_ref().set_read_timeout(Some(POLL)).is_err() {
        return;
    }
    let (outbox, queued) = mpsc::sync_channel(limits.outbox_capacity.max(1));
    if events.send(Event::Opened { conn, outbox }).is_err() {
        return;
    }
    converse(conn, &mut socket, &queued, events);
    let _ = events.send(Event::Closed { conn });
}

/// Reads frames for the session and writes what it queued, until either side ends.
fn converse(conn: u64, socket: &mut WebSocket<TcpStream>, queued: &Receiver<String>, events: &Sender<Event>) {
    loop {
        loop {
            match queued.try_recv() {
                Ok(text) => {
                    if socket.send(Message::text(text)).is_err() {
                        return;
                    }
                }
                Err(mpsc::TryRecvError::Empty) => break,
                // The session dropped its end: it is shutting down.
                Err(mpsc::TryRecvError::Disconnected) => {
                    let _ = socket.close(Some(CloseFrame {
                        code: CloseCode::Away,
                        reason: "bridge stopping".into(),
                    }));
                    let _ = socket.flush();
                    return;
                }
            }
        }
        let frame = match socket.read() {
            Ok(Message::Binary(bytes)) => Frame::Binary(Vec::from(bytes)),
            Ok(Message::Text(text)) => Frame::Text(text.as_str().to_owned()),
            Ok(Message::Close(_)) => {
                // The library queued the reply to the close; send it.
                let _ = socket.flush();
                return;
            }
            Ok(_) => continue,
            Err(WsError::Io(e)) if matches!(e.kind(), io::ErrorKind::WouldBlock | io::ErrorKind::TimedOut) => {
                // Nothing arrived within POLL. Also sends a pong the library may still hold.
                let _ = socket.flush();
                continue;
            }
            Err(WsError::Capacity(CapacityError::MessageTooLong { .. })) => {
                let _ = socket.close(Some(CloseFrame {
                    code: CloseCode::Size,
                    reason: "frame too large".into(),
                }));
                let _ = socket.flush();
                linger(socket.get_ref());
                return;
            }
            Err(_) => return,
        };
        if events.send(Event::Frame { conn, frame }).is_err() {
            return;
        }
    }
}

/// Ends a connection whose peer may still be sending: closes our side after the close frame, then reads and discards what
/// arrives, for a bounded time and a bounded number of bytes. Closing a socket with unread data resets the connection, and the
/// reset can destroy the close frame before the peer reads it (a browser then reports 1006 instead of 1009).
fn linger(stream: &TcpStream) {
    let _ = stream.shutdown(Shutdown::Write);
    let (deadline, mut left, mut buffer) = (Instant::now() + LINGER, LINGER_BYTES, vec![0_u8; 64 * 1024]);
    let mut reader = stream;
    while left > 0 && Instant::now() < deadline {
        match reader.read(&mut buffer) {
            Ok(0) => return,
            Ok(n) => left = left.saturating_sub(n),
            // The stream's read timeout is POLL: keep waiting until the deadline.
            Err(e) if matches!(e.kind(), io::ErrorKind::WouldBlock | io::ErrorKind::TimedOut) => {}
            Err(_) => return,
        }
    }
}
