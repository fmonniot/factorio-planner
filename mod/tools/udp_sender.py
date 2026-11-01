#!/usr/bin/env python3
"""A stand-in for the bridge, for the manual checklist (mod/CHECKLIST.md).

It sends the bridge-to-mod datagrams of spec/in-game-viewer-protocol.md to
the game's UDP port, then prints whatever the mod answers on the bridge port for a
few seconds. It implements no recovery: it sends what it is told once.

  udp_sender.py ping [NEWEST_ID]
  udp_sender.py send FIXTURE.json [--chunk BYTES] [--stop-after N] [--probe-only]
  udp_sender.py raw 'FP02 P ----------------'

Options for all: --game-port (34198), --bridge-port (34199), --wait SECONDS (8).
The mod polls every 10 ticks (about 0.17 s) and answers once per poll.
"""
import argparse
import hashlib
import socket
import time

NO_ID = "-" * 16
CHUNK_PAYLOAD = 8000
PROBE_SIZE = 37 + CHUNK_PAYLOAD + 5  # the bridge pads a probe to chunk size


def snapshot_id(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()[:16]


def probe(sid: str, count: int, size: int) -> bytes:
    head = f"FP01 W {sid} {count:04d} {size:07d} ".encode()
    return head + b"." * (PROBE_SIZE - len(head))


def chunk(sid: str, index: int, count: int, size: int, payload: bytes) -> bytes:
    return f"FP01 C {sid} {index:04d} {count:04d} {size:07d} ".encode() + payload


def end_of_window(sid: str, round_: int, upto: int) -> bytes:
    return f"FP01 E {sid} {round_:04d} {upto:04d}".encode()


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("command", choices=["ping", "send", "raw"])
    p.add_argument("arg", nargs="?")
    p.add_argument("--chunk", type=int, default=CHUNK_PAYLOAD, help="payload bytes per chunk (default 8000)")
    p.add_argument("--stop-after", type=int, default=None, help="send only this many chunks, and no end of window")
    p.add_argument("--probe-only", action="store_true", help="send the probe and nothing else")
    p.add_argument("--game-port", type=int, default=34198)
    p.add_argument("--bridge-port", type=int, default=34199)
    p.add_argument("--wait", type=float, default=8.0)
    a = p.parse_args()
    if a.command == "send" and not a.arg:
        p.error("send needs a snapshot file: udp_sender.py send FIXTURE.json")
    if a.command == "raw" and not a.arg:
        p.error("raw needs the datagram text: udp_sender.py raw 'FP01 P ----------------'")
    snapshot = None
    if a.command == "send":
        try:
            with open(a.arg, "rb") as f:
                snapshot = f.read().strip()
        except OSError as e:
            p.error(f"cannot read {a.arg}: {e.strerror}")

    listener = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    listener.bind(("127.0.0.1", a.bridge_port))
    listener.settimeout(0.2)
    sender = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)

    def out(data: bytes) -> None:
        print("->", data[:60], f"({len(data)} B)")
        sender.sendto(data, ("127.0.0.1", a.game_port))

    if a.command == "ping":
        out(f"FP01 P {a.arg or NO_ID}".encode())
    elif a.command == "raw":
        out(a.arg.encode())
    else:
        data = snapshot
        sid = snapshot_id(data)
        parts = [data[i : i + a.chunk] for i in range(0, len(data), a.chunk)]
        print(f"snapshot id {sid}, {len(data)} B in {len(parts)} chunks")
        out(probe(sid, len(parts), len(data)))
        if not a.probe_only:
            time.sleep(0.5)  # let the mod answer the probe first
            for i, part in enumerate(parts[: a.stop_after]):
                out(chunk(sid, i, len(parts), len(data), part))
            if a.stop_after is None:
                out(end_of_window(sid, 0, len(parts)))

    deadline = time.time() + a.wait
    while time.time() < deadline:
        try:
            data, _ = listener.recvfrom(65535)
        except socket.timeout:
            continue
        print("<-", data.decode(errors="replace"))


if __name__ == "__main__":
    main()
