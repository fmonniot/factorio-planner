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
use std::net::{Ipv4Addr, SocketAddr, TcpListener, TcpStream, UdpSocket};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, Sender};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use tungstenite::error::{CapacityError, Error as WsError};
use tungstenite::handshake::server::{ErrorResponse, Request, Response};
use tungstenite::http::StatusCode;
use tungstenite::protocol::frame::coding::CloseCode;
use tungstenite::protocol::{CloseFrame, WebSocketConfig};
use tungstenite::{Message, WebSocket};

use crate::bridge::{Bridge, SnapshotError};
use crate::cli::Config;
use crate::driver::{Driver, Step, Transport};
use crate::protocol::{MAX_FRAME_BYTES, WS_ENVELOPE};
use crate::ws::{ErrorCode, PlannerText, parse_snapshot_frame, parse_text_frame};

/// How long a connection thread waits for a frame before it looks at what the session queued for it.
const POLL: Duration = Duration::from_millis(25);
/// A client that has not finished the opening handshake by then is dropped.
const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(5);
/// A planner that does not take a frame in this time is dropped.
const WRITE_TIMEOUT: Duration = Duration::from_secs(10);
/// Tries at finding a port that is free for both TCP and UDP when the port asked for is 0.
const PORT_ATTEMPTS: usize = 50;

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
    Opened { conn: u64, outbox: Sender<Out> },
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

/// What the session asks a connection thread to send.
enum Out {
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
            origins: config.origins.clone(),
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
                .spawn(move || accept_loop(&listener, &origins, &stop, &events))?
        };
        let reader = {
            let (socket, events, stop) = (udp.try_clone()?, events.clone(), Arc::clone(&stop));
            thread::Builder::new()
                .name("udp".into())
                .spawn(move || udp_loop(&socket, &stop, &events))?
        };
        drop(events);

        let result = Session::new(Queue::new(udp, game)).run(&inbox);

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
    fn send(&mut self, datagram: &[u8]) -> io::Result<()> {
        self.socket.send_to(datagram, self.game).map(|_| ())
    }

    fn recv(&mut self) -> io::Result<Option<Vec<u8>>> {
        Ok(self.inbox.pop_front())
    }
}

struct Session {
    driver: Driver<Queue>,
    planners: HashMap<u64, Sender<Out>>,
}

impl Session {
    fn new(queue: Queue) -> Self {
        Self {
            driver: Driver::new(Bridge::new(Instant::now()), queue),
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
                    event => self.handle(event),
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

    fn handle(&mut self, event: Event) {
        let now = Instant::now();
        match event {
            Event::Datagram(datagram) => self.driver.transport_mut().inbox.push_back(datagram),
            Event::Opened { conn, outbox } => {
                // The first message of a connection is the status, before anything else.
                let status = self.driver.bridge().status(now).to_json();
                if outbox.send(Out::Text(status)).is_ok() {
                    self.planners.insert(conn, outbox);
                }
            }
            Event::Closed { conn } => {
                self.planners.remove(&conn);
            }
            Event::Frame {
                conn,
                frame: Frame::Binary(frame),
            } => self.on_snapshot(now, conn, frame),
            Event::Frame {
                conn,
                frame: Frame::Text(text),
            } => match parse_text_frame(&text) {
                Ok(PlannerText::Announce { id }) => {
                    let step = self.driver.announce(now, id);
                    self.publish(step);
                }
                Err(code) => self.reply_error(conn, code),
            },
            Event::UdpFailed(_) | Event::Shutdown => {}
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
            && outbox.send(Out::Text(code.to_json())).is_err()
        {
            self.planners.remove(&conn);
        }
    }

    /// Sends a changed status to every planner.
    fn publish(&mut self, step: Step) {
        if let Some(status) = step.status {
            let json = status.to_json();
            self.planners
                .retain(|_, outbox| outbox.send(Out::Text(json.clone())).is_ok());
        }
    }
}

// ---------------------------------------------------------------------------------------------
// The other threads
// ---------------------------------------------------------------------------------------------

fn udp_loop(socket: &UdpSocket, stop: &AtomicBool, events: &Sender<Event>) {
    use io::ErrorKind::{ConnectionRefused, ConnectionReset, Interrupted};
    let mut buffer = vec![0_u8; 65_536];
    loop {
        let received = socket.recv_from(&mut buffer);
        if stop.load(Ordering::SeqCst) {
            return;
        }
        match received {
            Ok((n, _)) => {
                if events.send(Event::Datagram(buffer[..n].to_vec())).is_err() {
                    return;
                }
            }
            // The game's port was closed (Windows reports it on the next receive) or a signal came in: it means nothing.
            Err(e) if matches!(e.kind(), ConnectionReset | ConnectionRefused | Interrupted) => {}
            Err(e) => {
                let _ = events.send(Event::UdpFailed(e));
                return;
            }
        }
    }
}

fn accept_loop(listener: &TcpListener, origins: &Arc<Vec<String>>, stop: &AtomicBool, events: &Sender<Event>) {
    let mut next = 0_u64;
    for stream in listener.incoming() {
        if stop.load(Ordering::SeqCst) {
            return;
        }
        let Ok(stream) = stream else { continue };
        next += 1;
        let (conn, origins, events) = (next, Arc::clone(origins), events.clone());
        // A failure to start a thread drops this one connection; the next one may do better.
        let _ = thread::Builder::new()
            .name(format!("planner-{conn}"))
            .spawn(move || serve_connection(conn, stream, &origins, &events));
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
        Some(origin) if !origins.iter().any(|allowed| allowed == origin) => {
            eprintln!("refused a connection from the origin {origin:?}; allow it with --origin if it is yours");
            let mut refusal = ErrorResponse::new(Some("origin not allowed\n".to_owned()));
            *refusal.status_mut() = StatusCode::FORBIDDEN;
            Err(refusal)
        }
        _ => Ok(response),
    }
}

fn serve_connection(conn: u64, stream: TcpStream, origins: &[String], events: &Sender<Event>) {
    let _ = stream.set_nodelay(true);
    if stream.set_read_timeout(Some(HANDSHAKE_TIMEOUT)).is_err()
        || stream.set_write_timeout(Some(WRITE_TIMEOUT)).is_err()
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
    let (outbox, queued) = mpsc::channel();
    if events.send(Event::Opened { conn, outbox }).is_err() {
        return;
    }
    converse(conn, &mut socket, &queued, events);
    let _ = events.send(Event::Closed { conn });
}

/// Reads frames for the session and writes what it queued, until either side ends.
fn converse(conn: u64, socket: &mut WebSocket<TcpStream>, queued: &Receiver<Out>, events: &Sender<Event>) {
    loop {
        loop {
            match queued.try_recv() {
                Ok(Out::Text(text)) => {
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
                return;
            }
            Err(_) => return,
        };
        if events.send(Event::Frame { conn, frame }).is_err() {
            return;
        }
    }
}
