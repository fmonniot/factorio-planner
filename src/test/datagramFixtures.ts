import { createHash } from 'node:crypto'
import type { Snapshot } from '../snapshot/schema'
import { buildSnapshotFixtures } from './snapshotFixtures'

// ---------------------------------------------------------------------------
// Builds the shared wire-protocol fixtures (contract/datagrams/*.json), which the Lua and Rust
// tests read. The rules are in initiatives/in-game-viewer/protocol.md.
//
// TEST TOOLING ONLY. This encoder is the minimum needed to write the fixtures: it is not the
// bridge, it has no state machine, and production code must not import it. Expected answers below
// are written by hand on purpose; src/snapshot/datagrams.test.ts replays them through a separate
// reader built from the document, so a fixture and that reader cannot share a mistake.
// ---------------------------------------------------------------------------

/** The document's constants table; a test holds the two together. Units are the table's. */
export const WIRE = {
  CHUNK_PAYLOAD: 8000,
  CHUNK_HEADER: 42,
  MAX_DATAGRAM: 8042,
  PROBE_HEADER: 37,
  PING_BYTES: 23,
  EOW_BYTES: 33,
  WS_ENVELOPE: 32,
  WINDOW_CHUNKS: 24,
  PACE_CHUNKS: 4,
  PACE_INTERVAL: 20,
  MAX_CHUNKS: 1000,
  MAX_SNAPSHOT_BYTES: 8_000_000,
  MAX_FRAME_BYTES: 10_000_031,
  MAX_REPORT_RANGES: 12,
  MAX_REPORT_BYTES: 124,
  MAX_UNKNOWN_IDS: 9999,
  POLL_TICKS: 10,
  FLUSH_OFFSET: 2,
  PROBE_INTERVAL: 250,
  PROBE_BURST: 3,
  PROBE_REFILL_AFTER: 1000,
  PING_INTERVAL: 5,
  PING_INTERVAL_MAX: 300,
  PING_BACKOFF_DIVISOR: 16,
  QUIET_AFTER: 15,
  GAME_UPS: 60,
  DISCONNECT_TICKS: 1080,
  NO_PROGRESS_LIMIT: 8,
  PLANNER_RETRY: 5,
}

const PROTOCOL_VERSION = 1

/** The id field when there is no snapshot to name. */
export const NO_ID = '-'.repeat(16)

const PREFIX = 'FP01'

const digits = (n: number, width: number): string => String(n).padStart(width, '0')
const round4 = (n: number): string => digits(n, 4)

/** The snapshot id: the first 16 hex characters of the SHA-256 of the snapshot's bytes. */
export function snapshotId(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex').slice(0, 16)
}

/** The bytes a snapshot travels as: compact JSON, UTF-8. */
export function snapshotBytes(snapshot: unknown): Buffer {
  return Buffer.from(JSON.stringify(snapshot), 'utf-8')
}

interface Transfer {
  id: string
  bytes: number
  count: number
  data: Buffer
  chunks: Buffer[]
}

function transferOf(data: Buffer, chunkSize: number): Transfer {
  const chunks: Buffer[] = []
  for (let at = 0; at < data.length; at += chunkSize) chunks.push(data.subarray(at, at + chunkSize))
  return { id: snapshotId(data), bytes: data.length, count: chunks.length, data, chunks }
}

/** A transfer cut at the given sizes, the last chunk taking whatever is left. */
function transferFromSizes(data: Buffer, sizes: number[]): Transfer {
  const chunks: Buffer[] = []
  let at = 0
  for (const size of sizes) {
    chunks.push(data.subarray(at, at + size))
    at += size
  }
  chunks.push(data.subarray(at))
  return { id: snapshotId(data), bytes: data.length, count: chunks.length, data, chunks }
}

export interface Datagram {
  type: string
  /** The readable part: everything but a chunk's payload or a probe's padding. `hex` is the datagram. */
  text: string
  hex: string
}

function datagram(type: string, text: string, tail: Buffer = Buffer.alloc(0)): Datagram {
  return { type, text, hex: Buffer.concat([Buffer.from(text, 'latin1'), tail]).toString('hex') }
}

const chunkHeader = (id: string, index: number, count: number, bytes: number): string =>
  `${PREFIX} C ${id} ${round4(index)} ${round4(count)} ${digits(bytes, 7)} `

function chunk(t: Transfer, index: number, payload: Buffer = t.chunks[index]): Datagram {
  return datagram('chunk', chunkHeader(t.id, index, t.count, t.bytes), payload)
}

function probe(t: Pick<Transfer, 'id' | 'count' | 'bytes'>): Datagram {
  const text = `${PREFIX} W ${t.id} ${round4(t.count)} ${digits(t.bytes, 7)} `
  return datagram('probe', text, Buffer.alloc(WIRE.MAX_DATAGRAM - text.length, '.'))
}

const endOfWindow = (id: string, round: number, upto: number): Datagram =>
  datagram('end-of-window', `${PREFIX} E ${id} ${round4(round)} ${round4(upto)}`)

const ping = (newest: string = NO_ID): Datagram => datagram('ping', `${PREFIX} P ${newest}`)

const hello = (stored: string, unknownIds: number, assembling: string): string =>
  `${PREFIX} H ${stored} ${unknownIds} ${assembling}`
const ready = (id: string): string => `${PREFIX} R ${id}`
const missing = (id: string, round: number, ranges: string): string => `${PREFIX} M ${id} ${round4(round)} ${ranges}`
const ack = (id: string, unknownIds: number): string => `${PREFIX} A ${id} ${unknownIds}`
const nack = (id: string, reason: string): string => `${PREFIX} N ${id} ${reason}`

export interface ModState {
  stored: string | null
  unknownIds: number
  assembling: string | null
  have: number[]
  stale: boolean
  mismatch: boolean
}

export interface Poll {
  arrive: Datagram[]
  answer: string | null
  after: ModState
}

export interface BridgeStep {
  hears: string
  /** What the bridge sends next: a window, the same end-of-window again, a new probe, or nothing. */
  sends: { round: number; indices: number[]; upto: number } | { endOfWindow: { round: number; upto: number } } | { probe: true } | null
  /** When present: the bridge's phase after hearing this, for the steps that end or leave a terminal phase. */
  state?: 'delivered' | 'rejected' | 'failed'
}

export interface Case {
  case: string
  summary: string
  /** The snapshot the transfer carries, when the case has one. `hex` is what the chunks must join to. */
  snapshot?: { fixture: string; id: string; bytes: number; chunkSize: number; hex: string }
  start: { stored: { id: string; unknownIds: number } | null }
  /** What the test's stand-in for the running game's id check returns on a snapshot it accepts. */
  idCheck: { unknownIds: number }
  polls: Poll[]
  /** When present: the bridge, given this snapshot and chunk size, hears these answers and must send these windows. */
  bridge?: BridgeStep[]
}

const OLD_ID = 'aaaaaaaaaaaaaaaa'
const range = (from: number, to: number): number[] => Array.from({ length: to - from + 1 }, (_, i) => from + i)

function state(over: Partial<ModState>): ModState {
  return { stored: null, unknownIds: 0, assembling: null, have: [], stale: false, mismatch: false, ...over }
}

function snapshotRef(fixture: string, t: Transfer, chunkSize: number): Case['snapshot'] {
  return { fixture, id: t.id, bytes: t.bytes, chunkSize, hex: t.data.toString('hex') }
}

/** The transcript shared by the plain cases: a probe answered, then a window of everything at once. */
function plainDelivery(t: Transfer, arrive: Datagram[], after: ModState = state({ stored: t.id })): Poll[] {
  return [
    { arrive: [probe(t)], answer: ready(t.id), after: state({ stored: null, assembling: t.id }) },
    { arrive, answer: ack(t.id, after.unknownIds), after },
  ]
}

function buildCases(snapshots: Record<string, Snapshot>): Case[] {
  const bytesOf = (name: string): Buffer => snapshotBytes(snapshots[name])
  const cases: Case[] = []
  const none = { stored: null }
  const noUnknown = { unknownIds: 0 }

  // Delivery, with a real snapshot.
  {
    const t = transferOf(bytesOf('seablock-loop'), 512)
    const all = range(0, t.count - 1)
    cases.push({
      case: 'in-order',
      summary: 'A probe, every chunk in order and the end of the window: the snapshot is accepted and acknowledged.',
      snapshot: snapshotRef('seablock-loop', t, 512),
      start: none,
      idCheck: noUnknown,
      polls: plainDelivery(t, [...all.map(i => chunk(t, i)), endOfWindow(t.id, 0, t.count)]),
      bridge: [
        { hears: ready(t.id), sends: { round: 0, indices: all, upto: t.count } },
        { hears: ack(t.id, 0), sends: null },
      ],
    })
  }
  {
    const t = transferOf(bytesOf('seablock-loop'), 64)
    const first = range(0, 23)
    const rest = range(24, t.count - 1)
    cases.push({
      case: 'two-windows',
      summary: 'More chunks than a window: the first report names nothing missing, which releases the second window.',
      snapshot: snapshotRef('seablock-loop', t, 64),
      start: none,
      idCheck: { unknownIds: 3 },
      polls: [
        { arrive: [probe(t)], answer: ready(t.id), after: state({ assembling: t.id }) },
        {
          arrive: [...first.map(i => chunk(t, i)), endOfWindow(t.id, 0, 24)],
          answer: missing(t.id, 0, '-'),
          after: state({ assembling: t.id, have: first }),
        },
        {
          arrive: [...rest.map(i => chunk(t, i)), endOfWindow(t.id, 1, t.count)],
          answer: ack(t.id, 3),
          after: state({ stored: t.id, unknownIds: 3 }),
        },
      ],
      bridge: [
        { hears: ready(t.id), sends: { round: 0, indices: first, upto: 24 } },
        { hears: missing(t.id, 0, '-'), sends: { round: 1, indices: rest, upto: t.count } },
        { hears: ack(t.id, 3), sends: null },
      ],
    })
  }
  {
    // Fixture blocks repeated until the snapshot needs two full chunks and a bit more.
    const base = snapshots['seablock-loop']
    const big = { ...base, blocks: Array.from({ length: 9 }, () => base.blocks).flat() }
    const t = transferOf(snapshotBytes(big), WIRE.CHUNK_PAYLOAD)
    const all = range(0, t.count - 1)
    cases.push({
      case: 'max-size-chunks',
      summary: 'Chunks of the largest allowed size, so full datagrams of MAX_DATAGRAM bytes. The snapshot is seablock-loop with its blocks repeated.',
      snapshot: snapshotRef('seablock-loop with blocks repeated', t, WIRE.CHUNK_PAYLOAD),
      start: none,
      idCheck: noUnknown,
      polls: plainDelivery(t, [...all.map(i => chunk(t, i)), endOfWindow(t.id, 0, t.count)]),
      bridge: [
        { hears: ready(t.id), sends: { round: 0, indices: all, upto: t.count } },
        { hears: ack(t.id, 0), sends: null },
      ],
    })
  }

  // Arrival order and repeats.
  {
    const t = transferOf(bytesOf('seablock-areas'), 256)
    const order = [...range(0, t.count - 1)].reverse()
    cases.push({
      case: 'reordered',
      summary: 'Chunks arrive last to first. They join by index, not by arrival.',
      snapshot: snapshotRef('seablock-areas', t, 256),
      start: none,
      idCheck: noUnknown,
      polls: plainDelivery(t, [...order.map(i => chunk(t, i)), endOfWindow(t.id, 0, t.count)]),
    })
  }
  {
    const t = transferOf(bytesOf('small'), 128)
    const altered = Buffer.alloc(t.chunks[1].length, 'x')
    cases.push({
      case: 'duplicate-chunk',
      summary: 'A chunk arrives three times, the last time with other bytes. The first copy wins and the rest are dropped.',
      snapshot: snapshotRef('small', t, 128),
      start: none,
      idCheck: noUnknown,
      polls: plainDelivery(t, [
        chunk(t, 0),
        chunk(t, 1),
        chunk(t, 1),
        chunk(t, 1, altered),
        ...range(2, t.count - 1).map(i => chunk(t, i)),
        endOfWindow(t.id, 0, t.count),
      ]),
    })
  }

  // Loss.
  {
    const t = transferOf(bytesOf('small'), 128)
    const arrived = range(0, t.count - 1).filter(i => i !== 1 && i !== 3)
    cases.push({
      case: 'missing-chunk',
      summary: 'Two chunks are lost. The report names them, the bridge resends only those, and the transfer completes.',
      snapshot: snapshotRef('small', t, 128),
      start: none,
      idCheck: noUnknown,
      polls: [
        { arrive: [probe(t)], answer: ready(t.id), after: state({ assembling: t.id }) },
        {
          arrive: [...arrived.map(i => chunk(t, i)), endOfWindow(t.id, 0, t.count)],
          answer: missing(t.id, 0, '1,3'),
          after: state({ assembling: t.id, have: arrived }),
        },
        {
          arrive: [chunk(t, 1), chunk(t, 3), endOfWindow(t.id, 1, t.count)],
          answer: ack(t.id, 0),
          after: state({ stored: t.id }),
        },
      ],
      bridge: [
        { hears: ready(t.id), sends: { round: 0, indices: range(0, t.count - 1), upto: t.count } },
        { hears: missing(t.id, 0, '1,3'), sends: { round: 1, indices: [1, 3], upto: t.count } },
        { hears: ack(t.id, 0), sends: null },
      ],
    })
  }
  {
    const t = transferOf(bytesOf('seablock-loop'), 64)
    const first = range(0, 23)
    const rest = range(24, t.count - 1)
    cases.push({
      case: 'window-lost',
      summary: 'A whole window is lost and only the end-of-window datagram arrives: one short range covers it.',
      snapshot: snapshotRef('seablock-loop', t, 64),
      start: none,
      idCheck: noUnknown,
      polls: [
        { arrive: [probe(t)], answer: ready(t.id), after: state({ assembling: t.id }) },
        { arrive: [endOfWindow(t.id, 0, 24)], answer: missing(t.id, 0, '0-23'), after: state({ assembling: t.id }) },
        {
          arrive: [...first.map(i => chunk(t, i)), endOfWindow(t.id, 1, 24)],
          answer: missing(t.id, 1, '-'),
          after: state({ assembling: t.id, have: first }),
        },
        { arrive: [...rest.map(i => chunk(t, i)), endOfWindow(t.id, 2, t.count)], answer: ack(t.id, 0), after: state({ stored: t.id }) },
      ],
      bridge: [
        { hears: ready(t.id), sends: { round: 0, indices: first, upto: 24 } },
        { hears: missing(t.id, 0, '0-23'), sends: { round: 1, indices: first, upto: 24 } },
        { hears: missing(t.id, 1, '-'), sends: { round: 2, indices: rest, upto: t.count } },
        { hears: ack(t.id, 0), sends: null },
      ],
    })
  }
  {
    // 146 chunks. Thirteen pairs of chunks (100-101, 103-104, ... 136-137) are lost, each pair with
    // one held chunk between it and the next, so thirteen separate gaps lie below `upto` and every
    // gap is written as `abc-def`. The report stops at twelve: 29 + 12 * 7 + 11 = MAX_REPORT_BYTES.
    // The bridge never sends this much in one window, so the case has no bridge steps.
    const t = transferOf(bytesOf('seablock-loop'), 14)
    const pair = (k: number): number[] => [100 + 3 * k, 101 + 3 * k]
    const lostFirst = range(0, 12).flatMap(pair)
    const firstTwelve = range(0, 11).flatMap(pair)
    const ranges = range(0, 11).map(k => `${100 + 3 * k}-${101 + 3 * k}`).join(',')
    const everything = range(0, t.count - 1)
    const arrived = everything.filter(i => !lostFirst.includes(i))
    cases.push({
      case: 'report-worst-case',
      summary: 'Thirteen gaps of two chunks with three-digit indices below `upto`. The report holds twelve ranges, lowest first, and is exactly MAX_REPORT_BYTES long; the next round reports the thirteenth.',
      snapshot: snapshotRef('seablock-loop', t, 14),
      start: none,
      idCheck: noUnknown,
      polls: [
        { arrive: [probe(t)], answer: ready(t.id), after: state({ assembling: t.id }) },
        {
          arrive: [...arrived.map(i => chunk(t, i)), endOfWindow(t.id, 0, t.count)],
          answer: missing(t.id, 0, ranges),
          after: state({ assembling: t.id, have: arrived }),
        },
        {
          arrive: [...firstTwelve.map(i => chunk(t, i)), endOfWindow(t.id, 1, t.count)],
          answer: missing(t.id, 1, '136-137'),
          after: state({ assembling: t.id, have: everything.filter(i => !pair(12).includes(i)) }),
        },
        { arrive: [...pair(12).map(i => chunk(t, i)), endOfWindow(t.id, 2, t.count)], answer: ack(t.id, 0), after: state({ stored: t.id }) },
      ],
    })
  }
  {
    // 41 chunks. Every even chunk is lost in round 0, and again in round 1, so 18 separate gaps
    // lie below `upto` and the report must stop at 12 ranges.
    const t = transferOf(bytesOf('seablock-loop'), 50)
    const odd = (from: number, to: number): number[] => range(from, to).filter(i => i % 2 === 1)
    const even = (from: number, to: number): number[] => range(from, to).filter(i => i % 2 === 0)
    const first12 = even(0, 22)
    const round1 = [...first12, ...range(24, 35)]
    const round2 = [...first12, ...range(36, 40)]
    const twelve = first12.join(',')
    const lateEven = even(24, 34)
    cases.push({
      case: 'report-capped',
      summary: 'Alternating loss across 41 chunks. The report stops at MAX_REPORT_RANGES ranges, lowest first, and stays under MAX_REPORT_BYTES; later rounds report the rest.',
      snapshot: snapshotRef('seablock-loop', t, 50),
      start: none,
      idCheck: noUnknown,
      polls: [
        { arrive: [probe(t)], answer: ready(t.id), after: state({ assembling: t.id }) },
        {
          arrive: [...odd(0, 23).map(i => chunk(t, i)), endOfWindow(t.id, 0, 24)],
          answer: missing(t.id, 0, twelve),
          after: state({ assembling: t.id, have: odd(0, 23) }),
        },
        {
          arrive: [...odd(24, 35).map(i => chunk(t, i)), endOfWindow(t.id, 1, 36)],
          answer: missing(t.id, 1, twelve),
          after: state({ assembling: t.id, have: odd(0, 35) }),
        },
        {
          arrive: [...round2.map(i => chunk(t, i)), endOfWindow(t.id, 2, t.count)],
          answer: missing(t.id, 2, lateEven.join(',')),
          after: state({ assembling: t.id, have: [...odd(0, 35), ...first12, ...range(36, 40)].sort((a, b) => a - b) }),
        },
        {
          arrive: [...lateEven.map(i => chunk(t, i)), endOfWindow(t.id, 3, t.count)],
          answer: ack(t.id, 0),
          after: state({ stored: t.id }),
        },
      ],
      bridge: [
        { hears: ready(t.id), sends: { round: 0, indices: range(0, 23), upto: 24 } },
        { hears: missing(t.id, 0, twelve), sends: { round: 1, indices: round1, upto: 36 } },
        { hears: missing(t.id, 1, twelve), sends: { round: 2, indices: round2, upto: t.count } },
        { hears: missing(t.id, 2, lateEven.join(',')), sends: { round: 3, indices: lateEven, upto: t.count } },
        { hears: ack(t.id, 0), sends: null },
      ],
    })
  }

  {
    const t = transferOf(bytesOf('seablock-loop'), 64)
    const first = range(0, 23)
    const rest = range(24, t.count - 1)
    cases.push({
      case: 'lost-end-of-window',
      summary: 'The end-of-window is lost, so no report comes and no timer fires. The next hello shows the transfer still assembling, and the bridge sends the same end-of-window again.',
      snapshot: snapshotRef('seablock-loop', t, 64),
      start: none,
      idCheck: noUnknown,
      polls: [
        { arrive: [probe(t)], answer: ready(t.id), after: state({ assembling: t.id }) },
        { arrive: first.map(i => chunk(t, i)), answer: null, after: state({ assembling: t.id, have: first }) },
        { arrive: [ping(t.id)], answer: hello(NO_ID, 0, t.id), after: state({ assembling: t.id, have: first }) },
        { arrive: [endOfWindow(t.id, 0, 24)], answer: missing(t.id, 0, '-'), after: state({ assembling: t.id, have: first }) },
        { arrive: [...rest.map(i => chunk(t, i)), endOfWindow(t.id, 1, t.count)], answer: ack(t.id, 0), after: state({ stored: t.id }) },
      ],
      bridge: [
        { hears: ready(t.id), sends: { round: 0, indices: first, upto: 24 } },
        { hears: hello(NO_ID, 0, t.id), sends: { endOfWindow: { round: 0, upto: 24 } } },
        { hears: missing(t.id, 0, '-'), sends: { round: 1, indices: rest, upto: t.count } },
        { hears: ack(t.id, 0), sends: null },
      ],
    })
  }

  // Bytes.
  {
    const t = transferOf(bytesOf('unicode'), 43)
    const first = range(0, 23)
    const rest = range(24, t.count - 1)
    cases.push({
      case: 'multibyte-straddle',
      summary: 'At this chunk size, chunk boundaries fall inside a 2-byte, a 3-byte and a 4-byte character. Chunks are joined byte for byte, so the names survive.',
      snapshot: snapshotRef('unicode', t, 43),
      start: none,
      idCheck: noUnknown,
      polls: [
        { arrive: [probe(t)], answer: ready(t.id), after: state({ assembling: t.id }) },
        {
          arrive: [...first.map(i => chunk(t, i)), endOfWindow(t.id, 0, 24)],
          answer: missing(t.id, 0, '-'),
          after: state({ assembling: t.id, have: first }),
        },
        { arrive: [...rest.map(i => chunk(t, i)), endOfWindow(t.id, 1, t.count)], answer: ack(t.id, 0), after: state({ stored: t.id }) },
      ],
    })
  }
  {
    const real = transferOf(bytesOf('small'), 128)
    const t = { ...real, bytes: real.bytes + 1 }
    const held = { stored: OLD_ID, unknownIds: 1 }
    cases.push({
      case: 'wrong-byte-length',
      summary: 'All chunks arrive, but they add up to one byte less than the header says. The snapshot is refused and the old one stays.',
      start: { stored: { id: OLD_ID, unknownIds: 1 } },
      idCheck: noUnknown,
      polls: [
        { arrive: [probe(t)], answer: ready(t.id), after: state({ ...held, assembling: t.id }) },
        {
          arrive: [...range(0, t.count - 1).map(i => chunk(t, i)), endOfWindow(t.id, 0, t.count)],
          answer: nack(t.id, 'length'),
          after: state(held),
        },
      ],
    })
  }
  {
    const t = transferOf(bytesOf('small').subarray(0, 300), 128)
    const held = { stored: OLD_ID, unknownIds: 1 }
    cases.push({
      case: 'invalid-json',
      summary: 'The byte length is right but the bytes are not JSON (a snapshot cut short). The snapshot is refused and the old one stays.',
      start: { stored: { id: OLD_ID, unknownIds: 1 } },
      idCheck: noUnknown,
      polls: [
        { arrive: [probe(t)], answer: ready(t.id), after: state({ ...held, assembling: t.id }) },
        { arrive: [...range(0, t.count - 1).map(i => chunk(t, i)), endOfWindow(t.id, 0, t.count)], answer: nack(t.id, 'json'), after: state(held) },
      ],
    })
  }
  {
    const t = transferOf(snapshotBytes({ ...snapshots.small, v: 2 }), 128)
    cases.push({
      case: 'snapshot-version',
      summary: 'A valid transfer of a snapshot whose `v` this mod does not read: refused with reason `version`.',
      start: none,
      idCheck: noUnknown,
      polls: [
        { arrive: [probe(t)], answer: ready(t.id), after: state({ assembling: t.id }) },
        { arrive: [...range(0, t.count - 1).map(i => chunk(t, i)), endOfWindow(t.id, 0, t.count)], answer: nack(t.id, 'version'), after: state({}) },
      ],
    })
  }
  {
    const t = transferOf(Buffer.from('{"v":1,"blocks":"none"}', 'utf-8'), 8)
    cases.push({
      case: 'snapshot-invalid',
      summary: 'Valid JSON of the right version that is not a snapshot: refused with reason `invalid`.',
      start: none,
      idCheck: noUnknown,
      polls: [
        { arrive: [probe(t)], answer: ready(t.id), after: state({ assembling: t.id }) },
        { arrive: [...range(0, t.count - 1).map(i => chunk(t, i)), endOfWindow(t.id, 0, t.count)], answer: nack(t.id, 'invalid'), after: state({}) },
      ],
    })
  }

  // Superseding, and what a reload loses.
  {
    const a = transferOf(bytesOf('small'), 128)
    const b = transferOf(bytesOf('seablock-areas'), 512)
    cases.push({
      case: 'superseded',
      summary: 'A newer probe replaces a transfer in progress. Late chunks and a late end-of-window of the old snapshot are dropped, and the old snapshot is never stored.',
      snapshot: snapshotRef('seablock-areas', b, 512),
      start: none,
      idCheck: noUnknown,
      polls: [
        { arrive: [probe(a)], answer: ready(a.id), after: state({ assembling: a.id }) },
        { arrive: [chunk(a, 0), chunk(a, 1), chunk(a, 2)], answer: null, after: state({ assembling: a.id, have: [0, 1, 2] }) },
        { arrive: [chunk(a, 3), probe(b), chunk(a, 4), endOfWindow(a.id, 0, a.count)], answer: ready(b.id), after: state({ assembling: b.id }) },
        { arrive: [...range(0, b.count - 1).map(i => chunk(b, i)), endOfWindow(b.id, 0, b.count)], answer: ack(b.id, 0), after: state({ stored: b.id }) },
      ],
    })
  }
  {
    const t = transferOf(bytesOf('small'), 128)
    const held = { stored: t.id }
    cases.push({
      case: 'already-stored',
      summary: 'A probe or end-of-window naming the stored snapshot is answered with an ack, with no transfer.',
      start: { stored: { id: t.id, unknownIds: 0 } },
      idCheck: noUnknown,
      polls: [
        { arrive: [probe(t)], answer: ack(t.id, 0), after: state(held) },
        { arrive: [endOfWindow(t.id, 0, t.count)], answer: ack(t.id, 0), after: state(held) },
      ],
    })
  }
  {
    const t = transferOf(bytesOf('small'), 128)
    const held = { stored: OLD_ID, unknownIds: 1 }
    const all = range(0, t.count - 1)
    cases.push({
      case: 'lost-on-load',
      summary: 'After a save load the reassembly is gone. Chunks and an end-of-window with no probe before them are dropped with no answer; the ping shows the bridge that nothing is assembling; a new probe restarts the transfer.',
      snapshot: snapshotRef('small', t, 128),
      start: { stored: { id: OLD_ID, unknownIds: 1 } },
      idCheck: noUnknown,
      polls: [
        { arrive: [chunk(t, 3), chunk(t, 4), endOfWindow(t.id, 0, t.count)], answer: null, after: state(held) },
        { arrive: [ping(t.id)], answer: hello(OLD_ID, 1, NO_ID), after: state({ ...held, stale: true }) },
        { arrive: [probe(t)], answer: ready(t.id), after: state({ ...held, stale: true, assembling: t.id }) },
        { arrive: [...all.map(i => chunk(t, i)), endOfWindow(t.id, 0, t.count)], answer: ack(t.id, 0), after: state({ stored: t.id }) },
      ],
      // The first exchange is from before the load: the bridge had a window out when it happened.
      bridge: [
        { hears: ready(t.id), sends: { round: 0, indices: all, upto: t.count } },
        { hears: hello(OLD_ID, 1, NO_ID), sends: { probe: true } },
        { hears: ready(t.id), sends: { round: 0, indices: all, upto: t.count } },
        { hears: ack(t.id, 0), sends: null },
      ],
    })
  }
  {
    const t = transferOf(bytesOf('small'), 128)
    const backlog = Array.from({ length: 40 }, () => ping(t.id))
    cases.push({
      case: 'resume-after-pause',
      summary: 'A paused game drains its whole backlog in one poll: chunks, the end-of-window and forty pings. It answers once. The hello a later ping brings shows the same snapshot.',
      snapshot: snapshotRef('small', t, 128),
      start: none,
      idCheck: noUnknown,
      polls: [
        { arrive: [probe(t)], answer: ready(t.id), after: state({ assembling: t.id }) },
        {
          arrive: [...range(0, t.count - 1).map(i => chunk(t, i)), endOfWindow(t.id, 0, t.count), ...backlog],
          answer: ack(t.id, 0),
          after: state({ stored: t.id }),
        },
        { arrive: [ping(t.id)], answer: hello(t.id, 0, NO_ID), after: state({ stored: t.id }) },
      ],
    })
  }
  {
    const a = transferOf(bytesOf('small'), 128)
    const b = transferOf(bytesOf('seablock-areas'), 512)
    cases.push({
      case: 'one-answer-per-poll',
      summary: 'One answer slot per poll. Every answer replaces it, except a hello, which only fills an empty slot. A repeated probe keeps what has arrived.',
      start: none,
      idCheck: noUnknown,
      polls: [
        { arrive: [ping(), probe(a)], answer: ready(a.id), after: state({ assembling: a.id }) },
        { arrive: [probe(a), ping()], answer: ready(a.id), after: state({ assembling: a.id }) },
        { arrive: [chunk(a, 0), chunk(a, 1)], answer: null, after: state({ assembling: a.id, have: [0, 1] }) },
        { arrive: [probe(a)], answer: ready(a.id), after: state({ assembling: a.id, have: [0, 1] }) },
        { arrive: [ping()], answer: hello(NO_ID, 0, a.id), after: state({ assembling: a.id, have: [0, 1] }) },
        { arrive: [endOfWindow(a.id, 0, a.count), ping()], answer: missing(a.id, 0, `2-${a.count - 1}`), after: state({ assembling: a.id, have: [0, 1] }) },
        { arrive: [endOfWindow(a.id, 0, a.count), probe(b)], answer: ready(b.id), after: state({ assembling: b.id }) },
      ],
    })
  }
  {
    const t = transferOf(bytesOf('small'), 128)
    const other = transferOf(bytesOf('seablock-areas'), 512)
    const held = { stored: t.id }
    cases.push({
      case: 'stale-signal',
      summary: 'The ping carries the newest id. It sets Stale when it differs from the stored id, and clears it when it matches or names nothing.',
      start: { stored: { id: t.id, unknownIds: 0 } },
      idCheck: noUnknown,
      polls: [
        { arrive: [ping(t.id)], answer: hello(t.id, 0, NO_ID), after: state(held) },
        { arrive: [ping(other.id)], answer: hello(t.id, 0, NO_ID), after: state({ ...held, stale: true }) },
        { arrive: [ping(NO_ID)], answer: hello(t.id, 0, NO_ID), after: state(held) },
      ],
    })
  }
  {
    const t = transferOf(bytesOf('small'), 128)
    cases.push({
      case: 'no-snapshot-not-stale',
      summary: 'With no stored snapshot there is nothing to be stale: the ping still gets a hello, with the no-id value.',
      start: none,
      idCheck: noUnknown,
      polls: [{ arrive: [ping(t.id)], answer: hello(NO_ID, 0, NO_ID), after: state({}) }],
    })
  }
  {
    const t = transferOf(bytesOf('small'), 128)
    const held = { stored: OLD_ID, unknownIds: 1 }
    const foreignPing = datagram('ping', `FP02 P ${t.id}`)
    const foreignChunk = datagram('chunk', `FP02 C ${t.id} 0000 0001 0000005 `, Buffer.from('hello'))
    cases.push({
      case: 'protocol-mismatch',
      summary: 'Any datagram of another protocol version sets the mismatch flag and is answered with a hello, which tells the bridge this mod\'s version. Nothing in it is read. A datagram of this version clears the flag.',
      start: { stored: { id: OLD_ID, unknownIds: 1 } },
      idCheck: noUnknown,
      polls: [
        { arrive: [foreignPing], answer: hello(OLD_ID, 1, NO_ID), after: state({ ...held, mismatch: true }) },
        { arrive: [foreignChunk], answer: hello(OLD_ID, 1, NO_ID), after: state({ ...held, mismatch: true }) },
        { arrive: [ping(OLD_ID)], answer: hello(OLD_ID, 1, NO_ID), after: state(held) },
      ],
    })
  }
  {
    const t = transferOf(bytesOf('small'), 128)
    const wrongCount = datagram('chunk', chunkHeader(t.id, 1, t.count + 1, t.bytes), t.chunks[1])
    const wrongBytes = datagram('chunk', chunkHeader(t.id, 1, t.count, t.bytes + 1), t.chunks[1])
    cases.push({
      case: 'conflicting-header',
      summary: 'A chunk with the right id but a count other than the probe\'s is dropped; so is one with the right count and another byte length.',
      start: none,
      idCheck: noUnknown,
      polls: [
        { arrive: [probe(t)], answer: ready(t.id), after: state({ assembling: t.id }) },
        { arrive: [chunk(t, 0), wrongCount, endOfWindow(t.id, 0, 2)], answer: missing(t.id, 0, '1'), after: state({ assembling: t.id, have: [0] }) },
        { arrive: [wrongBytes, endOfWindow(t.id, 1, 2)], answer: missing(t.id, 1, '1'), after: state({ assembling: t.id, have: [0] }) },
      ],
    })
  }
  {
    // 226 chunks make ten windows. Every report names nothing missing, nine times in a row: more
    // than NO_PROGRESS_LIMIT, yet healthy, because `upto` advances every time.
    const t = transferOf(bytesOf('seablock-loop'), 9)
    const windows = Math.ceil(t.count / WIRE.WINDOW_CHUNKS)
    const window = (k: number): number[] => range(k * WIRE.WINDOW_CHUNKS, Math.min((k + 1) * WIRE.WINDOW_CHUNKS, t.count) - 1)
    const upto = (k: number): number => Math.min((k + 1) * WIRE.WINDOW_CHUNKS, t.count)
    const polls: Poll[] = [{ arrive: [probe(t)], answer: ready(t.id), after: state({ assembling: t.id }) }]
    const steps: BridgeStep[] = [{ hears: ready(t.id), sends: { round: 0, indices: window(0), upto: upto(0) } }]
    for (let k = 0; k < windows - 1; k++) {
      polls.push({
        arrive: [...window(k).map(i => chunk(t, i)), endOfWindow(t.id, k, upto(k))],
        answer: missing(t.id, k, '-'),
        after: state({ assembling: t.id, have: range(0, upto(k) - 1) }),
      })
      steps.push({ hears: missing(t.id, k, '-'), sends: { round: k + 1, indices: window(k + 1), upto: upto(k + 1) } })
    }
    polls.push({
      arrive: [...window(windows - 1).map(i => chunk(t, i)), endOfWindow(t.id, windows - 1, t.count)],
      answer: ack(t.id, 0),
      after: state({ stored: t.id }),
    })
    steps.push({ hears: ack(t.id, 0), sends: null })
    cases.push({
      case: 'many-windows',
      summary: 'Ten windows, nine reports in a row that name nothing missing. The ranges repeat but `upto` advances every time, so this is progress: more reports than NO_PROGRESS_LIMIT, and the bridge keeps sending.',
      snapshot: snapshotRef('seablock-loop', t, 9),
      start: none,
      idCheck: noUnknown,
      polls,
      bridge: steps,
    })
  }
  {
    // Every chunk of every window is lost; only the end-of-window arrives. The report is the same
    // eight times and `upto` stays at 24: the run reaches NO_PROGRESS_LIMIT and the bridge gives up.
    // The window then turns up late, the mod stores the snapshot, and the next hello moves the
    // bridge out of Failed.
    const t = transferOf(bytesOf('seablock-loop'), 64)
    const first = range(0, 23)
    const polls: Poll[] = [{ arrive: [probe(t)], answer: ready(t.id), after: state({ assembling: t.id }) }]
    const steps: BridgeStep[] = [{ hears: ready(t.id), sends: { round: 0, indices: first, upto: 24 } }]
    for (let r = 0; r < WIRE.NO_PROGRESS_LIMIT; r++) {
      polls.push({ arrive: [endOfWindow(t.id, r, 24)], answer: missing(t.id, r, '0-23'), after: state({ assembling: t.id }) })
      steps.push(
        r < WIRE.NO_PROGRESS_LIMIT - 1
          ? { hears: missing(t.id, r, '0-23'), sends: { round: r + 1, indices: first, upto: 24 } }
          : { hears: missing(t.id, r, '0-23'), sends: null, state: 'failed' },
      )
    }
    polls.push({
      arrive: [...range(0, t.count - 1).map(i => chunk(t, i)), endOfWindow(t.id, WIRE.NO_PROGRESS_LIMIT, t.count)],
      answer: ack(t.id, 0),
      after: state({ stored: t.id }),
    })
    steps.push({ hears: ack(t.id, 0), sends: null, state: 'failed' })
    polls.push({ arrive: [ping(t.id)], answer: hello(t.id, 0, NO_ID), after: state({ stored: t.id }) })
    steps.push({ hears: hello(t.id, 0, NO_ID), sends: null, state: 'delivered' })
    cases.push({
      case: 'no-progress',
      summary: 'Eight reports in a row with the same ranges and the same `upto` stop the transfer in Failed, with nothing more sent. An ack is ignored there, but a hello showing the mod stores the snapshot moves the bridge to Delivered.',
      snapshot: snapshotRef('seablock-loop', t, 64),
      start: none,
      idCheck: noUnknown,
      polls,
      bridge: steps,
    })
  }
  {
    // Chunks of six different sizes, arriving in the order 3, 0, 5, 2, 1, 4. Joining at
    // `index * CHUNK_PAYLOAD` or at the first chunk's size breaks it; only the real payloads, in
    // index order, give the bytes.
    const t = transferFromSizes(bytesOf('seablock-loop'), [100, 37, 1, 700, 250])
    const order = [3, 0, 5, 2, 1, 4]
    cases.push({
      case: 'mixed-chunk-sizes',
      summary: 'The chunks are 100, 37, 1, 700, 250 and 946 bytes. The format only needs the payloads to add up to `bytes`, so the snapshot joins from what arrived, not from a fixed size. `chunkSize` is the largest.',
      snapshot: snapshotRef('seablock-loop', t, 946),
      start: none,
      idCheck: noUnknown,
      polls: plainDelivery(t, [...order.map(i => chunk(t, i)), endOfWindow(t.id, 0, t.count)]),
    })
  }
  {
    // Seven reports with the same ranges and the same `upto`, then one that differs, then another
    // that differs, then identical ones until the run reaches NO_PROGRESS_LIMIT again. The run
    // counts consecutive reports: a count of all reports would stop at the 8th, and a counter that
    // restarts on `round` would never stop.
    const t = transferOf(bytesOf('seablock-loop'), 64)
    const first = range(0, 23)
    const stuck = [...range(0, 4), ...range(6, 24)]
    const polls: Poll[] = [{ arrive: [probe(t)], answer: ready(t.id), after: state({ assembling: t.id }) }]
    const steps: BridgeStep[] = [{ hears: ready(t.id), sends: { round: 0, indices: first, upto: 24 } }]
    // Reports 1 to 7: nothing arrives but the end-of-window.
    for (let r = 0; r < 7; r++) {
      polls.push({ arrive: [endOfWindow(t.id, r, 24)], answer: missing(t.id, r, '0-23'), after: state({ assembling: t.id }) })
      steps.push({ hears: missing(t.id, r, '0-23'), sends: { round: r + 1, indices: first, upto: 24 } })
    }
    // Report 8: chunk 5 got through, so the ranges differ. The next window grows by chunk 24.
    polls.push({ arrive: [chunk(t, 5), endOfWindow(t.id, 7, 24)], answer: missing(t.id, 7, '0-4,6-23'), after: state({ assembling: t.id, have: [5] }) })
    steps.push({ hears: missing(t.id, 7, '0-4,6-23'), sends: { round: 8, indices: stuck, upto: 25 } })
    // Report 9: nothing got through, chunk 24 included. The ranges differ again, so the run is 1.
    polls.push({ arrive: [endOfWindow(t.id, 8, 25)], answer: missing(t.id, 8, '0-4,6-24'), after: state({ assembling: t.id, have: [5] }) })
    steps.push({ hears: missing(t.id, 8, '0-4,6-24'), sends: { round: 9, indices: stuck, upto: 25 } })
    // Reports 10 to 16: the same ranges and the same `upto`, runs 2 to 8. The 16th stops the bridge.
    for (let r = 9; r <= 15; r++) {
      polls.push({ arrive: [endOfWindow(t.id, r, 25)], answer: missing(t.id, r, '0-4,6-24'), after: state({ assembling: t.id, have: [5] }) })
      steps.push(
        r < 15
          ? { hears: missing(t.id, r, '0-4,6-24'), sends: { round: r + 1, indices: stuck, upto: 25 } }
          : { hears: missing(t.id, r, '0-4,6-24'), sends: null, state: 'failed' },
      )
    }
    // The window turns up late, the mod stores the snapshot, and the next hello moves the bridge on.
    polls.push({
      arrive: [...range(0, t.count - 1).map(i => chunk(t, i)), endOfWindow(t.id, 16, t.count)],
      answer: ack(t.id, 0),
      after: state({ stored: t.id }),
    })
    steps.push({ hears: ack(t.id, 0), sends: null, state: 'failed' })
    polls.push({ arrive: [ping(t.id)], answer: hello(t.id, 0, NO_ID), after: state({ stored: t.id }) })
    steps.push({ hears: hello(t.id, 0, NO_ID), sends: null, state: 'delivered' })
    cases.push({
      case: 'no-progress-reset',
      summary: 'Seven identical fruitless reports, then two reports with other ranges, then identical ones again. The run starts again at 1 on a report that differs, so the bridge keeps sending through the 8th and 15th reports and fails on the 16th, the 8th of the new run.',
      snapshot: snapshotRef('seablock-loop', t, 64),
      start: none,
      idCheck: noUnknown,
      polls,
      bridge: steps,
    })
  }
  {
    // The declared length is one byte too many, so the mod refuses with `length` and keeps the old
    // snapshot. Later the mod holds the real snapshot (here a transfer with the right length): the
    // hello that shows it moves the bridge on.
    const real = transferOf(bytesOf('small'), 128)
    const t = { ...real, bytes: real.bytes + 1 }
    const all = range(0, t.count - 1)
    const held = { stored: OLD_ID, unknownIds: 0 }
    cases.push({
      case: 'rejected-then-stored',
      summary: 'A refused transfer leaves the bridge in Rejected. A hello that does not show the snapshot stored leaves it alone; once the mod holds it after all (here through a later transfer with the right length), its hello moves the bridge to Delivered.',
      snapshot: snapshotRef('small', real, 128),
      start: { stored: { id: OLD_ID, unknownIds: 0 } },
      idCheck: noUnknown,
      polls: [
        { arrive: [probe(t)], answer: ready(t.id), after: state({ ...held, assembling: t.id }) },
        { arrive: [...all.map(i => chunk(t, i)), endOfWindow(t.id, 0, t.count)], answer: nack(t.id, 'length'), after: state(held) },
        { arrive: [ping(t.id)], answer: hello(OLD_ID, 0, NO_ID), after: state({ ...held, stale: true }) },
        { arrive: [probe(real)], answer: ready(t.id), after: state({ ...held, stale: true, assembling: t.id }) },
        { arrive: [...all.map(i => chunk(real, i)), endOfWindow(t.id, 0, t.count)], answer: ack(t.id, 0), after: state({ stored: t.id }) },
        { arrive: [ping(t.id)], answer: hello(t.id, 0, NO_ID), after: state({ stored: t.id }) },
      ],
      bridge: [
        { hears: ready(t.id), sends: { round: 0, indices: all, upto: t.count } },
        { hears: nack(t.id, 'length'), sends: null, state: 'rejected' },
        { hears: hello(OLD_ID, 0, NO_ID), sends: null, state: 'rejected' },
        { hears: hello(t.id, 0, NO_ID), sends: null, state: 'delivered' },
      ],
    })
  }
  return cases
}

interface Message {
  name: string
  link: 'udp' | 'ws'
  from: 'planner' | 'bridge' | 'mod'
  to: 'planner' | 'bridge' | 'mod'
  frame?: 'text' | 'binary'
  type: string
  /** A line of the document that shows this message. */
  doc: string
  hex: string
  /** The decoded fields: what a parser returns. */
  fields: Record<string, unknown>
}

function buildMessages(snapshots: Record<string, Snapshot>): { protocol: number; messages: Message[] } {
  const data = snapshotBytes(snapshots.small)
  const full = transferOf(data, WIRE.CHUNK_PAYLOAD)
  const t = transferOf(data, 128)
  const id = t.id
  const newer = snapshotId(snapshotBytes(snapshots.unicode))
  const messages: Message[] = []

  const udp = (name: string, from: 'bridge' | 'mod', d: Datagram, fields: Record<string, unknown>): void => {
    messages.push({ name, link: 'udp', from, to: from === 'mod' ? 'bridge' : 'mod', type: d.type, doc: d.text, hex: d.hex, fields })
  }
  const modMessage = (name: string, type: string, text: string, fields: Record<string, unknown>): void => {
    udp(name, 'mod', datagram(type, text), fields)
  }
  const json = (name: string, from: 'planner' | 'bridge', type: string, value: unknown, fields: Record<string, unknown>): void => {
    const text = JSON.stringify(value)
    messages.push({
      name,
      link: 'ws',
      from,
      to: from === 'planner' ? 'bridge' : 'planner',
      frame: 'text',
      type,
      doc: text,
      hex: Buffer.from(text, 'utf-8').toString('hex'),
      fields,
    })
  }

  udp('ping', 'bridge', ping(newer), { protocol: 1, newest: newer })
  udp('ping-no-snapshot', 'bridge', ping(), { protocol: 1, newest: null })
  udp('probe', 'bridge', probe(t), { protocol: 1, id, count: t.count, bytes: t.bytes })
  udp('chunk', 'bridge', chunk(t, 2), { protocol: 1, id, index: 2, count: t.count, bytes: t.bytes, payloadBytes: t.chunks[2].length })
  udp('chunk-single', 'bridge', chunk(full, 0), { protocol: 1, id, index: 0, count: 1, bytes: full.bytes, payloadBytes: full.bytes })
  udp('end-of-window', 'bridge', endOfWindow(id, 1, t.count), { protocol: 1, id, round: 1, upto: t.count })

  modMessage('hello', 'hello', hello(id, 2, NO_ID), { protocol: 1, stored: id, unknownIds: 2, assembling: null })
  modMessage('hello-empty', 'hello', hello(NO_ID, 0, NO_ID), { protocol: 1, stored: null, unknownIds: 0, assembling: null })
  modMessage('hello-assembling', 'hello', hello(id, 2, newer), { protocol: 1, stored: id, unknownIds: 2, assembling: newer })
  modMessage('hello-other-version', 'hello', 'FP02 H 5 any other layout, never read', { protocol: 2 })
  modMessage('hello-other-version-short', 'hello', 'FP02 H', { protocol: 2 })
  modMessage('ready', 'ready', ready(id), { protocol: 1, id })
  modMessage('missing-none', 'missing', missing(id, 0, '-'), { protocol: 1, id, round: 0, missing: [] })
  modMessage('missing', 'missing', missing(id, 1, '1,3-5,9'), {
    protocol: 1,
    id,
    round: 1,
    missing: [[1, 1], [3, 5], [9, 9]],
  })
  modMessage('ack', 'ack', ack(id, 2), { protocol: 1, id, unknownIds: 2 })
  for (const reason of ['length', 'json', 'version', 'invalid']) {
    modMessage(`nack-${reason}`, 'nack', nack(id, reason), { protocol: 1, id, reason })
  }

  const envelope = `${PREFIX} S ${id} ${digits(data.length, 7)} `
  messages.push({
    name: 'snapshot',
    link: 'ws',
    from: 'planner',
    to: 'bridge',
    frame: 'binary',
    type: 'snapshot',
    doc: envelope,
    hex: Buffer.concat([Buffer.from(envelope, 'latin1'), data]).toString('hex'),
    fields: { protocol: 1, id, bytes: data.length },
  })
  json('announce', 'planner', 'announce', { type: 'announce', protocol: 1, id: newer }, { protocol: 1, id: newer })

  const status = (name: string, over: object): void => {
    const value = { type: 'status', protocol: 1, bridge: '0.1.0', ...over }
    json(name, 'bridge', 'status', value, value as Record<string, unknown>)
  }
  status('status-no-mod', { mod: { link: 'none' } })
  status('status-waiting', { newest: id, mod: { link: 'none' }, transfer: { id, state: 'waiting', sent: 0, count: 1 } })
  status('status-sending', {
    newest: newer,
    mod: { link: 'connected', protocol: 1, stored: id, unknownIds: 0 },
    transfer: { id: newer, state: 'sending', sent: 24, count: 29 },
  })
  status('status-stalled', {
    newest: newer,
    mod: { link: 'quiet', protocol: 1, stored: id, unknownIds: 0 },
    transfer: { id: newer, state: 'stalled', sent: 24, count: 29 },
  })
  status('status-delivered', {
    newest: id,
    mod: { link: 'connected', protocol: 1, stored: id, unknownIds: 2 },
    transfer: { id, state: 'delivered', sent: 1, count: 1 },
  })
  status('status-rejected', {
    newest: newer,
    mod: { link: 'connected', protocol: 1, stored: id, unknownIds: 0 },
    transfer: { id: newer, state: 'rejected', sent: 29, count: 29, reason: 'json' },
  })
  status('status-failed', {
    newest: newer,
    mod: { link: 'connected', protocol: 1, stored: id, unknownIds: 0 },
    transfer: { id: newer, state: 'failed', sent: 24, count: 29, reason: 'no-progress' },
  })
  status('status-mismatch', { mod: { link: 'mismatch', protocol: 2 } })
  for (const code of ['bad-envelope', 'bad-message', 'too-large', 'protocol-mismatch']) {
    const value = { type: 'error', code }
    json(`error-${code}`, 'bridge', 'error', value, value)
  }
  return { protocol: PROTOCOL_VERSION, messages }
}

interface Malformed {
  reader: 'mod' | 'bridge-udp' | 'bridge-ws'
  frame?: 'text' | 'binary'
  why: string
  hex: string
  /** For `bridge-ws` only: the code of the `error` message the bridge answers with. */
  error?: string
}

function buildMalformed(): { protocol: number; inputs: Malformed[] } {
  const inputs: Malformed[] = []
  const id = '0123456789abcdef'
  const hexOf = (b: Buffer | string): string => (typeof b === 'string' ? Buffer.from(b, 'latin1') : b).toString('hex')
  const mod = (why: string, b: Buffer | string): void => void inputs.push({ reader: 'mod', why, hex: hexOf(b) })
  const bridge = (why: string, text: string): void => void inputs.push({ reader: 'bridge-udp', why, hex: hexOf(text) })
  const ws = (why: string, frame: 'text' | 'binary', b: Buffer | string, error: string): void =>
    void inputs.push({ reader: 'bridge-ws', frame, why, hex: hexOf(b), error })

  const body = 'x'
  const header = (over: { id?: string; index?: string; count?: string; bytes?: string } = {}): string =>
    `FP01 C ${over.id ?? id} ${over.index ?? '0000'} ${over.count ?? '0002'} ${over.bytes ?? '0000002'} `

  mod('empty datagram', '')
  mod('foreign traffic: another mod on the same socket', 'hello from another mod')
  mod('foreign traffic: binary', Buffer.from([0x00, 0xff, 0x10, 0x80, 0x46, 0x50]))
  mod('prefix cut short', 'FP01')
  mod('prefix without a type', 'FP01 ')
  mod('version is not two digits', 'FP1x P ----------------')
  mod('unknown type', `FP01 Z ${id}`)
  mod('chunk header cut short', header().slice(0, 30))
  mod('chunk with no payload', header())
  mod('chunk payload over CHUNK_PAYLOAD', Buffer.concat([Buffer.from(header({ count: '0001', bytes: '0008000' }), 'latin1'), Buffer.alloc(8001, 'x')]))
  mod('chunk id in upper case', header({ id: '0123456789ABCDEF' }) + body)
  mod('chunk id too short', `FP01 C 0123456789abcde 0000 0002 0000002 ${body}`)
  mod('chunk index not digits', header({ index: '00x0' }) + body)
  mod('chunk index in hexadecimal form', header({ index: '0x10' }) + body)
  mod('chunk index with a sign', header({ index: '+001' }) + body)
  mod('chunk index equal to count', header({ index: '0002' }) + body)
  mod('chunk count of zero', header({ count: '0000' }) + body)
  mod('chunk count over MAX_CHUNKS', header({ count: '1001' }) + body)
  mod('chunk byte length of zero', header({ bytes: '0000000' }) + body)
  mod('chunk byte length over MAX_SNAPSHOT_BYTES', header({ count: '1000', bytes: '8000001' }) + body)
  mod('chunk byte length smaller than count', header({ count: '0003' }) + body)
  mod('chunk byte length larger than count chunks can hold', header({ count: '0001', bytes: '0008001' }) + body)
  mod('chunk separator missing', header().replace(/ $/, '-') + body)
  mod('probe header cut short', `FP01 W ${id} 0001`)
  mod('probe count of zero', `FP01 W ${id} 0000 0000002 ...`)
  mod('probe byte length smaller than count', `FP01 W ${id} 0003 0000002 ...`)
  mod('end-of-window one byte short', `FP01 E ${id} 0000 002`)
  mod('end-of-window one byte long', `FP01 E ${id} 0000 00022`)
  mod('end-of-window upto of zero', `FP01 E ${id} 0000 0000`)
  mod('end-of-window upto over MAX_CHUNKS', `FP01 E ${id} 0000 1001`)
  mod('end-of-window round not digits', `FP01 E ${id} 000a 0002`)
  mod('ping with no id', 'FP01 P')
  mod('ping id of the wrong length', 'FP01 P 0123')
  mod('ping id mixing dashes and hexadecimal', `FP01 P 0123456789abc---`)
  mod('ping followed by extra bytes', `FP01 P ${id} `)

  bridge('empty datagram', '')
  bridge('foreign traffic', 'hello from another process')
  bridge('unknown type', `FP01 Z ${id}`)
  bridge('hello missing a field', `FP01 H ${id} 0`)
  bridge('hello with an extra field', `FP01 H ${id} 0 ${NO_ID} 1`)
  bridge('hello count not a number', `FP01 H ${id} x ${NO_ID}`)
  bridge('hello count over MAX_UNKNOWN_IDS', `FP01 H ${id} 10000 ${NO_ID}`)
  bridge('hello id in upper case', `FP01 H 0123456789ABCDEF 0 ${NO_ID}`)
  bridge('ready with no id', 'FP01 R')
  bridge('ready naming no snapshot', `FP01 R ${NO_ID}`)
  bridge('report with no ranges', `FP01 M ${id} 0000`)
  bridge('report round not four digits', `FP01 M ${id} 0 -`)
  bridge('report range the wrong way round', `FP01 M ${id} 0000 5-3`)
  bridge('report ranges out of order', `FP01 M ${id} 0000 5,3`)
  bridge('report ranges overlapping', `FP01 M ${id} 0000 1-4,3`)
  bridge('report range with an empty entry', `FP01 M ${id} 0000 1,,3`)
  bridge('report range not a number', `FP01 M ${id} 0000 1,a`)
  bridge('report with thirteen ranges', `FP01 M ${id} 0000 0,2,4,6,8,10,12,14,16,18,20,22,24`)
  bridge('ack with no count', `FP01 A ${id}`)
  bridge('ack count not a number', `FP01 A ${id} x`)
  bridge('ack count padded with zeros', `FP01 A ${id} 0002`)
  bridge('ack count over MAX_UNKNOWN_IDS', `FP01 A ${id} 10000`)
  bridge('hello count padded with zeros', `FP01 H ${id} 02 ${NO_ID}`)
  bridge('hello count of four digits padded', `FP01 H ${id} 0000 ${NO_ID}`)
  bridge('report index padded with zeros', `FP01 M ${id} 0000 01,003`)
  bridge('report range padded with zeros', `FP01 M ${id} 0000 1-04`)
  bridge('report index over MAX_CHUNKS', `FP01 M ${id} 0000 1000`)
  bridge('report range ending over MAX_CHUNKS', `FP01 M ${id} 0000 5-1000`)
  bridge('report of another version: only a hello is read', `FP02 R ${id}`)
  bridge('ping of another version: only a hello is read', `FP02 P ${id}`)
  bridge('another version without a type', 'FP02 ')
  bridge('version not two digits', 'FP1x H')
  bridge('version of one digit', 'FP2 H')
  bridge('nack with no reason', `FP01 N ${id}`)
  bridge('nack reason not a word', `FP01 N ${id} Bad-Reason`)

  const envelope = (over: { id?: string; bytes?: string } = {}): string => `FP01 S ${over.id ?? id} ${over.bytes ?? '0000002'} `
  ws('envelope cut short', 'binary', envelope().slice(0, 20), 'bad-envelope')
  ws('wrong type letter', 'binary', envelope().replace(' S ', ' C ') + '{}', 'bad-envelope')
  ws('id in upper case', 'binary', envelope({ id: '0123456789ABCDEF' }) + '{}', 'bad-envelope')
  ws('byte length not digits', 'binary', envelope({ bytes: '00000x2' }) + '{}', 'bad-envelope')
  ws('byte length of zero', 'binary', envelope({ bytes: '0000000' }), 'bad-envelope')
  ws('frame shorter than the byte length', 'binary', envelope({ bytes: '0000003' }) + '{}', 'bad-envelope')
  ws('frame longer than the byte length', 'binary', envelope({ bytes: '0000001' }) + '{}', 'bad-envelope')
  ws('byte length over MAX_SNAPSHOT_BYTES', 'binary', envelope({ bytes: '8000001' }) + '{}', 'too-large')
  ws('byte length at the largest the field can state', 'binary', envelope({ bytes: '9999999' }) + '{}', 'too-large')
  ws('other protocol version', 'binary', envelope().replace('FP01', 'FP02') + '{}', 'protocol-mismatch')
  ws('text frame that is not JSON', 'text', 'not json', 'bad-message')
  ws('text frame of an unknown type', 'text', '{"type":"reset","protocol":1}', 'bad-message')
  ws('announce with a bad id', 'text', '{"type":"announce","protocol":1,"id":"XYZ"}', 'bad-message')
  ws('announce of another protocol version', 'text', `{"type":"announce","protocol":2,"id":"${id}"}`, 'protocol-mismatch')
  return { protocol: PROTOCOL_VERSION, inputs }
}

/** Every file of contract/datagrams/, by name (without `.json`). */
export function buildDatagramFixtures(snapshots: Record<string, Snapshot> = buildSnapshotFixtures()): Record<string, unknown> {
  const files: Record<string, unknown> = {
    messages: buildMessages(snapshots),
    malformed: buildMalformed(),
  }
  for (const c of buildCases(snapshots)) files[`case-${c.case}`] = c
  return files
}
