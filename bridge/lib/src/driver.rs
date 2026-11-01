//! Glue between a [`Bridge`] and a datagram [`Transport`].
//!
//! The driver is synchronous and reads no clock: the caller passes `now` to every call, which is what lets tests run hours of
//! protocol time in milliseconds. A binary calls [`Driver::step`] whenever the transport has data or [`Step::next_wakeup`] has
//! passed, and the planner-facing calls ([`Driver::receive_snapshot`], [`Driver::announce`]) as frames arrive.

use std::io;
use std::net::{Ipv4Addr, SocketAddr, UdpSocket};
use std::time::{Duration, Instant};

use crate::bridge::{Bridge, SnapshotError};
use crate::protocol::SnapshotId;
use crate::status::Status;

/// A datagram link to the mod. Both calls are non-blocking.
pub trait Transport {
    /// Sends one datagram to the mod.
    ///
    /// # Errors
    /// Any I/O error. The driver counts it and carries on: a lost datagram is repaired by the protocol.
    fn send(&mut self, datagram: &[u8]) -> io::Result<()>;

    /// The next datagram heard, or `None` if there is none right now.
    ///
    /// # Errors
    /// An I/O error that ends the session.
    fn recv(&mut self) -> io::Result<Option<Vec<u8>>>;
}

/// What a call to the driver changed.
#[derive(Debug, Clone, PartialEq)]
pub struct Step {
    /// Datagrams handed to the transport (counting failed sends).
    pub sent: usize,
    /// The new status, if it changed.
    pub status: Option<Status>,
    /// When to call [`Driver::step`] next if nothing else happens first.
    pub next_wakeup: Instant,
}

/// A [`Bridge`] and the transport it talks through.
pub struct Driver<T: Transport> {
    bridge: Bridge,
    transport: T,
    send_errors: u64,
}

impl<T: Transport> Driver<T> {
    /// Puts `bridge` on `transport`. The first ping goes out on the first call that flushes.
    pub fn new(bridge: Bridge, transport: T) -> Self {
        Self {
            bridge,
            transport,
            send_errors: 0,
        }
    }

    /// The session.
    #[must_use]
    pub fn bridge(&self) -> &Bridge {
        &self.bridge
    }

    /// The transport.
    pub fn transport_mut(&mut self) -> &mut T {
        &mut self.transport
    }

    /// Ends the session and gives the transport back, to start a new one on the same socket.
    #[must_use]
    pub fn into_transport(self) -> T {
        self.transport
    }

    /// Sends that failed so far.
    #[must_use]
    pub fn send_errors(&self) -> u64 {
        self.send_errors
    }

    /// Reads everything the mod said, does what is due at `now`, and sends what the bridge produced.
    ///
    /// # Errors
    /// A fatal transport error on receive.
    pub fn step(&mut self, now: Instant) -> io::Result<Step> {
        while let Some(datagram) = self.transport.recv()? {
            self.bridge.handle_datagram(now, &datagram);
        }
        self.bridge.handle_timeout(now);
        Ok(self.flush(now))
    }

    /// A `snapshot` message from a planner.
    ///
    /// # Errors
    /// If the bridge refuses the snapshot.
    pub fn receive_snapshot(&mut self, now: Instant, id: SnapshotId, bytes: Vec<u8>) -> Result<Step, SnapshotError> {
        self.bridge.receive_snapshot(now, id, bytes)?;
        Ok(self.flush(now))
    }

    /// An `announce` message from a planner.
    pub fn announce(&mut self, now: Instant, id: SnapshotId) -> Step {
        self.bridge.announce(id);
        self.flush(now)
    }

    fn flush(&mut self, now: Instant) -> Step {
        let mut sent = 0;
        while let Some(datagram) = self.bridge.poll_transmit() {
            sent += 1;
            if self.transport.send(&datagram).is_err() {
                self.send_errors += 1;
            }
        }
        Step {
            sent,
            status: self.bridge.poll_status(now),
            next_wakeup: self.bridge.poll_timeout(now),
        }
    }
}

/// UDP on the loopback interface: bound to `127.0.0.1:<bridge port>`, sending to `127.0.0.1:<game port>`.
pub struct UdpTransport {
    socket: UdpSocket,
    game: SocketAddr,
    buffer: Vec<u8>,
}

impl UdpTransport {
    /// Binds the bridge's socket. Port 0 picks a free port (see [`UdpTransport::local_addr`]).
    ///
    /// # Errors
    /// If the port is taken, or the socket cannot be set up.
    pub fn bind(bridge_port: u16, game_port: u16) -> io::Result<Self> {
        let socket = UdpSocket::bind((Ipv4Addr::LOCALHOST, bridge_port))?;
        socket.set_nonblocking(true)?;
        Ok(Self {
            socket,
            game: SocketAddr::from((Ipv4Addr::LOCALHOST, game_port)),
            buffer: vec![0; 65_536],
        })
    }

    /// Changes the port datagrams are sent to.
    pub fn set_game_port(&mut self, game_port: u16) {
        self.game = SocketAddr::from((Ipv4Addr::LOCALHOST, game_port));
    }

    /// The address the socket is bound to.
    ///
    /// # Errors
    /// If the socket cannot say.
    pub fn local_addr(&self) -> io::Result<SocketAddr> {
        self.socket.local_addr()
    }

    /// Like [`Transport::recv`], but waits up to `timeout` for a datagram. A binary can use it to sleep until the
    /// next wake-up. The wait is a deadline: an error that means nothing (see [`Outcome::Ignored`]) does not restart it.
    ///
    /// # Errors
    /// An I/O error that ends the session.
    pub fn recv_wait(&mut self, timeout: Duration) -> io::Result<Option<Vec<u8>>> {
        let deadline = Instant::now() + timeout;
        self.socket.set_nonblocking(false)?;
        // Whatever happens below, the socket goes back to non-blocking.
        let _restore = NonBlocking(&self.socket);
        loop {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return Ok(None);
            }
            // A zero read timeout is an error, and a sub-millisecond one is rounded up.
            self.socket
                .set_read_timeout(Some(remaining.max(Duration::from_millis(1))))?;
            match classify(self.socket.recv_from(&mut self.buffer).map(|(n, _)| n))? {
                Outcome::Datagram(n) => return Ok(Some(self.buffer[..n].to_vec())),
                Outcome::Empty => return Ok(None),
                Outcome::Ignored => {}
            }
        }
    }

    fn recv_inner(&mut self) -> io::Result<Option<Vec<u8>>> {
        loop {
            match classify(self.socket.recv_from(&mut self.buffer).map(|(n, _)| n))? {
                Outcome::Datagram(n) => return Ok(Some(self.buffer[..n].to_vec())),
                Outcome::Empty => return Ok(None),
                Outcome::Ignored => {}
            }
        }
    }
}

/// Puts a socket back to non-blocking mode when dropped.
struct NonBlocking<'a>(&'a UdpSocket);

impl Drop for NonBlocking<'_> {
    fn drop(&mut self) {
        // Nothing sensible can be done about a failure here, and `recv_wait` sets the mode it needs on every call.
        let _ = self.0.set_nonblocking(true);
    }
}

/// What one receive call came to.
#[derive(Debug, PartialEq, Eq)]
enum Outcome {
    /// A datagram of this many bytes is in the buffer.
    Datagram(usize),
    /// Nothing to read (or the wait ran out).
    Empty,
    /// An error that means nothing here: the game's port was closed (Windows reports it on the next receive, other systems
    /// refuse), or a signal interrupted the call. Receive again.
    Ignored,
}

fn classify(result: io::Result<usize>) -> io::Result<Outcome> {
    use io::ErrorKind::{ConnectionRefused, ConnectionReset, Interrupted, TimedOut, WouldBlock};
    match result {
        Ok(n) => Ok(Outcome::Datagram(n)),
        Err(e) if matches!(e.kind(), WouldBlock | TimedOut) => Ok(Outcome::Empty),
        Err(e) if matches!(e.kind(), ConnectionReset | ConnectionRefused | Interrupted) => Ok(Outcome::Ignored),
        Err(e) => Err(e),
    }
}

impl Transport for UdpTransport {
    fn send(&mut self, datagram: &[u8]) -> io::Result<()> {
        self.socket.send_to(datagram, self.game).map(|_| ())
    }

    fn recv(&mut self) -> io::Result<Option<Vec<u8>>> {
        self.recv_inner()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn err(kind: io::ErrorKind) -> io::Result<usize> {
        Err(io::Error::from(kind))
    }

    #[test]
    fn harmless_receive_errors_do_not_end_the_session() {
        assert_eq!(classify(Ok(23)).unwrap(), Outcome::Datagram(23));
        assert_eq!(classify(err(io::ErrorKind::WouldBlock)).unwrap(), Outcome::Empty);
        assert_eq!(classify(err(io::ErrorKind::TimedOut)).unwrap(), Outcome::Empty);
        for kind in [
            io::ErrorKind::Interrupted,
            io::ErrorKind::ConnectionReset,
            io::ErrorKind::ConnectionRefused,
        ] {
            assert_eq!(classify(err(kind)).unwrap(), Outcome::Ignored, "{kind:?}");
        }
        assert!(classify(err(io::ErrorKind::PermissionDenied)).is_err());
    }

    #[test]
    fn recv_wait_returns_at_its_deadline_and_leaves_the_socket_non_blocking() {
        let mut transport = UdpTransport::bind(0, 1).unwrap();
        let started = Instant::now();
        assert_eq!(transport.recv_wait(Duration::from_millis(30)).unwrap(), None);
        assert!(started.elapsed() >= Duration::from_millis(25));
        // Non-blocking again: this returns at once instead of waiting.
        let started = Instant::now();
        assert_eq!(transport.recv().unwrap(), None);
        assert!(started.elapsed() < Duration::from_millis(500));
    }
}
