import { readFileSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import { SnapshotSchema, SNAPSHOT_VERSION } from './schema'
import { WIRE, NO_ID, type Case, type BridgeStep, type ModState } from '../test/datagramFixtures'

// Holds contract/datagrams/ to initiatives/in-game-viewer/protocol.md. The reader and the window
// builder below are written from the document, separately from the fixtures' encoder, and the
// constants table is read from the document itself. If a rule changes, the document, the fixtures
// and this file change together.

const ROOT = resolve(import.meta.dirname, '../..')
const DATAGRAMS = join(ROOT, 'contract/datagrams')
const DOC = readFileSync(join(ROOT, 'initiatives/in-game-viewer/protocol.md'), 'utf-8')
const readJson = (file: string): unknown => JSON.parse(readFileSync(join(DATAGRAMS, file), 'utf-8'))

const ID = /^[0-9a-f]{16}$/
const hexBytes = (hex: string): Buffer => Buffer.from(hex, 'hex')

interface Message { name: string; link: string; from: string; to: string; frame?: string; type: string; doc: string; hex: string; fields: Record<string, unknown> }
interface Malformed { reader: string; frame?: string; why: string; hex: string; error?: string }

interface BridgeWindow { round: number; indices: number[]; upto: number }

// --- The bytes, as the document lays them out ----------------------------------------------------

type Parsed =
  | { kind: 'foreign'; version: string }
  | { kind: 'ping'; newest: string }
  | { kind: 'probe'; id: string; count: number; bytes: number }
  | { kind: 'chunk'; id: string; index: number; count: number; bytes: number; payload: Buffer }
  | { kind: 'eow'; id: string; round: number; upto: number }

const inRange = (count: number, bytes: number): boolean =>
  count >= 1 && count <= WIRE.MAX_CHUNKS && bytes >= count && bytes <= WIRE.MAX_SNAPSHOT_BYTES && bytes <= count * WIRE.CHUNK_PAYLOAD

/** What the mod reads from a datagram; null is "drop". */
function parseModInput(d: Buffer): Parsed | null {
  if (d.length < 6) return null
  const prefix = d.subarray(0, 7).toString('latin1')
  if (!/^FP\d\d [A-Z]/.test(prefix)) return null
  if (prefix.slice(0, 4) !== 'FP01') return { kind: 'foreign', version: prefix.slice(2, 4) }
  const type = prefix[5]
  if (type === 'P') {
    if (d.length !== WIRE.PING_BYTES) return null
    const m = /^FP01 P ([0-9a-f]{16}|-{16})$/.exec(d.toString('latin1'))
    return m ? { kind: 'ping', newest: m[1] } : null
  }
  if (type === 'W') {
    if (d.length < WIRE.PROBE_HEADER) return null
    const m = /^FP01 W ([0-9a-f]{16}) (\d{4}) (\d{7}) $/.exec(d.subarray(0, WIRE.PROBE_HEADER).toString('latin1'))
    if (!m || !inRange(+m[2], +m[3])) return null
    return { kind: 'probe', id: m[1], count: +m[2], bytes: +m[3] }
  }
  if (type === 'C') {
    if (d.length <= WIRE.CHUNK_HEADER || d.length > WIRE.MAX_DATAGRAM) return null
    const m = /^FP01 C ([0-9a-f]{16}) (\d{4}) (\d{4}) (\d{7}) $/.exec(d.subarray(0, WIRE.CHUNK_HEADER).toString('latin1'))
    if (!m || !inRange(+m[3], +m[4]) || +m[2] >= +m[3]) return null
    return { kind: 'chunk', id: m[1], index: +m[2], count: +m[3], bytes: +m[4], payload: d.subarray(WIRE.CHUNK_HEADER) }
  }
  if (type === 'E') {
    if (d.length !== WIRE.EOW_BYTES) return null
    const m = /^FP01 E ([0-9a-f]{16}) (\d{4}) (\d{4})$/.exec(d.toString('latin1'))
    if (!m || +m[3] < 1 || +m[3] > WIRE.MAX_CHUNKS) return null
    return { kind: 'eow', id: m[1], round: +m[2], upto: +m[3] }
  }
  return null
}

// Numbers from the mod are unpadded: no leading zero, and within their bound.
const INDEX = '(?:0|[1-9]\\d{0,2})' // 0 to 999, MAX_CHUNKS - 1
const COUNT = /^(?:0|[1-9]\d{0,3})$/ // 0 to 9999, MAX_UNKNOWN_IDS

/** The ranges of a report, or null when they break the rules. `-` is an empty list. */
function parseRanges(text: string): [number, number][] | null {
  if (text === '-') return []
  const out: [number, number][] = []
  const entryPattern = new RegExp(`^(${INDEX})(?:-(${INDEX}))?$`)
  for (const entry of text.split(',')) {
    const m = entryPattern.exec(entry)
    if (!m) return null
    const first = +m[1]
    const last = m[2] === undefined ? first : +m[2]
    if (last <= first && m[2] !== undefined) return null
    if (out.length > 0 && first <= out[out.length - 1][1] + 1) return null
    out.push([first, last])
  }
  return out.length > WIRE.MAX_REPORT_RANGES ? null : out
}

/** What the bridge reads from a mod message; null is "drop". */
function parseBridgeInput(d: Buffer): Record<string, unknown> | null {
  const text = d.toString('latin1')
  const prefix = /^FP(\d\d) ([A-Z])/.exec(text)
  if (!prefix) return null
  const protocol = +prefix[1]
  // Another version: only its hello is read, from the first 6 bytes. Nothing after them is looked at.
  if (protocol !== 1) return prefix[2] === 'H' ? { protocol } : null
  const parts = text.split(' ')
  const idOrNone = /^([0-9a-f]{16}|-{16})$/
  const orNull = (s: string): string | null => (s === NO_ID ? null : s)
  switch (parts[1]) {
    case 'H':
      if (parts.length !== 5 || !idOrNone.test(parts[2]) || !COUNT.test(parts[3]) || !idOrNone.test(parts[4])) return null
      return { protocol, stored: orNull(parts[2]), unknownIds: +parts[3], assembling: orNull(parts[4]) }
    case 'R':
      return parts.length === 3 && ID.test(parts[2]) ? { protocol, id: parts[2] } : null
    case 'M': {
      if (parts.length !== 5 || !ID.test(parts[2]) || !/^\d{4}$/.test(parts[3])) return null
      const ranges = parseRanges(parts[4])
      return ranges ? { protocol, id: parts[2], round: +parts[3], missing: ranges } : null
    }
    case 'A':
      return parts.length === 4 && ID.test(parts[2]) && COUNT.test(parts[3]) ? { protocol, id: parts[2], unknownIds: +parts[3] } : null
    case 'N':
      return parts.length === 4 && ID.test(parts[2]) && /^[a-z]+$/.test(parts[3]) ? { protocol, id: parts[2], reason: parts[3] } : null
    default:
      return null
  }
}

/** The error code the bridge answers a WebSocket frame with; null when the frame is valid. */
function wsError(frame: string, d: Buffer): string | null {
  if (frame === 'binary') {
    const envelope = d.subarray(0, WIRE.WS_ENVELOPE).toString('latin1')
    if (/^FP\d\d S /.test(envelope) && !envelope.startsWith('FP01')) return 'protocol-mismatch'
    const m = /^FP01 S ([0-9a-f]{16}) (\d{7}) $/.exec(envelope)
    if (!m || +m[2] < 1) return 'bad-envelope'
    if (+m[2] > WIRE.MAX_SNAPSHOT_BYTES) return 'too-large'
    return d.length === WIRE.WS_ENVELOPE + +m[2] ? null : 'bad-envelope'
  }
  let value: { type?: unknown; protocol?: unknown; id?: unknown }
  try {
    value = JSON.parse(d.toString('utf-8'))
  } catch {
    return 'bad-message'
  }
  if (value.type !== 'announce') return 'bad-message'
  if (value.protocol !== 1) return 'protocol-mismatch'
  return typeof value.id === 'string' && ID.test(value.id) ? null : 'bad-message'
}

// --- The mod's reassembly, as the document states it ---------------------------------------------

class ReferenceMod {
  stored: { id: string; unknownIds: number; data?: Buffer } | null
  target: { id: string; count: number; bytes: number; chunks: Map<number, Buffer> } | null = null
  slot: string | null = null
  newest = NO_ID
  mismatch = false
  private readonly unknownIds: number

  constructor(c: Case) {
    this.stored = c.start.stored ? { ...c.start.stored } : null
    this.unknownIds = c.idCheck.unknownIds
  }

  private get hello(): string {
    return `FP01 H ${this.stored?.id ?? NO_ID} ${this.stored?.unknownIds ?? 0} ${this.target?.id ?? NO_ID}`
  }

  private ack(): void {
    this.slot = `FP01 A ${this.stored?.id} ${this.stored?.unknownIds}`
  }

  private finish(id: string): void {
    const t = this.target
    if (!t) return
    this.target = null
    const data = Buffer.concat(Array.from({ length: t.count }, (_, i) => t.chunks.get(i) as Buffer))
    if (data.length !== t.bytes) return void (this.slot = `FP01 N ${id} length`)
    let value: { v?: unknown }
    try {
      value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data))
    } catch {
      return void (this.slot = `FP01 N ${id} json`)
    }
    if (value.v !== SNAPSHOT_VERSION) return void (this.slot = `FP01 N ${id} version`)
    if (!SnapshotSchema.safeParse(value).success) return void (this.slot = `FP01 N ${id} invalid`)
    this.stored = { id, unknownIds: this.unknownIds, data }
    this.ack()
  }

  private report(upto: number): string {
    const t = this.target as NonNullable<ReferenceMod['target']>
    const entries: string[] = []
    let i = 0
    while (i < upto && entries.length < WIRE.MAX_REPORT_RANGES) {
      if (t.chunks.has(i)) {
        i++
        continue
      }
      const first = i
      while (i + 1 < upto && !t.chunks.has(i + 1)) i++
      entries.push(first === i ? String(first) : `${first}-${i}`)
      i++
    }
    return entries.length > 0 ? entries.join(',') : '-'
  }

  receive(d: Buffer): void {
    const p = parseModInput(d)
    if (!p) return
    if (p.kind === 'foreign') {
      this.mismatch = true
      this.slot ??= this.hello
      return
    }
    this.mismatch = false
    if (p.kind === 'ping') {
      this.newest = p.newest
      this.slot ??= this.hello
    } else if (p.kind === 'probe') {
      if (this.stored?.id === p.id) {
        this.target = null
        this.ack()
        return
      }
      if (this.target?.id !== p.id) this.target = { id: p.id, count: p.count, bytes: p.bytes, chunks: new Map() }
      this.slot = `FP01 R ${p.id}`
    } else if (p.kind === 'chunk') {
      const t = this.target
      if (!t || t.id !== p.id || t.count !== p.count || t.bytes !== p.bytes || t.chunks.has(p.index)) return
      t.chunks.set(p.index, p.payload)
      if (t.chunks.size === t.count) this.finish(p.id)
    } else if (this.stored?.id === p.id) {
      this.ack()
    } else if (this.target?.id === p.id && p.upto <= this.target.count) {
      this.slot = `FP01 M ${p.id} ${String(p.round).padStart(4, '0')} ${this.report(p.upto)}`
    }
  }

  flush(): string | null {
    const out = this.slot
    this.slot = null
    return out
  }

  get state(): ModState {
    return {
      stored: this.stored?.id ?? null,
      unknownIds: this.stored?.unknownIds ?? 0,
      assembling: this.target?.id ?? null,
      have: this.target ? [...this.target.chunks.keys()].sort((a, b) => a - b) : [],
      stale: this.stored !== null && this.newest !== NO_ID && this.newest !== this.stored.id,
      mismatch: this.mismatch,
    }
  }
}

/** The bridge's next window after a report, from "Building a window" in the document. */
function nextWindow(missing: [number, number][], upto: number, count: number, round: number): BridgeWindow {
  const indices: number[] = []
  for (const [first, last] of missing) {
    for (let i = first; i <= last && indices.length < WIRE.WINDOW_CHUNKS; i++) indices.push(i)
  }
  let next = upto
  while (indices.length < WIRE.WINDOW_CHUNKS && next < count) indices.push(next++)
  return { round, indices, upto: next }
}

// --- The tests -----------------------------------------------------------------------------------

const caseFiles = readdirSync(DATAGRAMS).filter(f => f.startsWith('case-')).sort()
const cases = caseFiles.map(f => readJson(f) as Case)
const caseNamed = (name: string): Case => cases.find(c => c.case === name) as Case
const { messages } = readJson('messages.json') as { messages: Message[] }
const { inputs } = readJson('malformed.json') as { inputs: Malformed[] }

/** A case's snapshot chunks in index order, first copy of each, from the datagrams that travel. */
function chunkPayloads(c: Case): Buffer[] {
  const id = (c.snapshot as NonNullable<Case['snapshot']>).id
  const held = new Map<number, Buffer>()
  for (const d of c.polls.flatMap(p => p.arrive)) {
    const p = parseModInput(hexBytes(d.hex))
    if (p?.kind === 'chunk' && p.id === id && !held.has(p.index)) held.set(p.index, p.payload)
  }
  return [...held.keys()].sort((a, b) => a - b).map(i => held.get(i) as Buffer)
}

describe('the document and the fixtures agree', () => {
  it.each(Object.entries(WIRE))('%s is %d in the constants table', (name, value) => {
    const row = new RegExp(`^\\| \`${name}\` \\| ([0-9,]+) `, 'm').exec(DOC)
    expect(row, `${name} has no row in the constants table`).not.toBeNull()
    expect(Number((row as RegExpExecArray)[1].replaceAll(',', ''))).toBe(value)
  })

  it('has every constant of the table in the fixtures tooling', () => {
    const names = [...DOC.matchAll(/^\| `([A-Z_]+)` \| [0-9]/gm)].map(m => m[1]).filter(n => /^[A-Z]+_[A-Z_]+$/.test(n))
    expect(names.sort()).toEqual(Object.keys(WIRE).sort())
  })

  it('states constants that follow from each other', () => {
    expect(WIRE.MAX_DATAGRAM).toBe(WIRE.CHUNK_HEADER + WIRE.CHUNK_PAYLOAD)
    expect(WIRE.MAX_DATAGRAM).toBeLessThan(9216)
    expect(WIRE.MAX_SNAPSHOT_BYTES).toBe(WIRE.MAX_CHUNKS * WIRE.CHUNK_PAYLOAD)
    expect(WIRE.QUIET_AFTER).toBe(3 * WIRE.PING_INTERVAL)
    expect(WIRE.DISCONNECT_TICKS).toBe((3 * WIRE.PING_INTERVAL + 3) * WIRE.GAME_UPS)
    // The mod compares ticks with DISCONNECT_TICKS * game.speed. Ticks run at GAME_UPS * game.speed
    // per second, so the wall-clock threshold is the same at every speed.
    for (const speed of [0.5, 1, 2, 8]) {
      expect((WIRE.DISCONNECT_TICKS * speed) / (WIRE.GAME_UPS * speed), `speed ${speed}`).toBe(3 * WIRE.PING_INTERVAL + 3)
    }
    // The frame limit holds any envelope the 7-digit field can state, and so the guard too.
    expect(WIRE.MAX_FRAME_BYTES).toBe(WIRE.WS_ENVELOPE + 9_999_999)
    expect(WIRE.MAX_FRAME_BYTES).toBeGreaterThan(WIRE.WS_ENVELOPE + WIRE.MAX_SNAPSHOT_BYTES)
    expect(String(WIRE.MAX_SNAPSHOT_BYTES).length).toBeLessThanOrEqual(7)
    expect(WIRE.MAX_REPORT_RANGES).toBe(WIRE.WINDOW_CHUNKS / 2)
    expect(WIRE.MAX_REPORT_BYTES).toBe(29 + WIRE.MAX_REPORT_RANGES * 7 + (WIRE.MAX_REPORT_RANGES - 1))
    // The window takes at most PACE_CHUNKS every PACE_INTERVAL, the spike's rate.
    expect((WIRE.PACE_CHUNKS / WIRE.PACE_INTERVAL) * 1000).toBe(200)
    expect(WIRE.WINDOW_CHUNKS).toBeLessThanOrEqual(24)
    expect(WIRE.CHUNK_PAYLOAD).toBeLessThanOrEqual(8000)
  })

  const docShows = (m: Message): boolean => DOC.includes(m.doc.replace(/ $/, ''))

  it.each([...new Set(messages.map(m => m.type))])('the document shows an example of %s', type => {
    expect(messages.filter(m => m.type === type).some(docShows)).toBe(true)
  })

  it('shows only real messages: every example line is one of the fixtures', () => {
    const fenced = [...DOC.matchAll(/^```\n([\s\S]*?)^```$/gm)].flatMap(m => m[1].split('\n'))
    const examples = fenced.filter(line => line.startsWith('FP01 ') || line.startsWith('{"type"'))
    expect(examples.length).toBeGreaterThan(20)
    for (const line of examples) {
      expect(messages.some(m => line.startsWith(m.doc.replace(/ $/, ''))), line).toBe(true)
    }
  })

  it('shows a hello of another version, which the bridge reads by its first 6 bytes alone', () => {
    const m = messages.find(x => x.name === 'hello-other-version') as Message
    expect(DOC).toContain(m.doc)
    expect(m.fields).toEqual({ protocol: 2 })
  })

  it('does not link to spec/, which it may only do once the code ships', () => {
    expect(DOC).not.toMatch(/\]\([^)]*spec\//)
  })
})

describe('the buffer budget', () => {
  const BUFFER = 262_144
  const OVERHEAD = 92
  const LARGE = WIRE.MAX_DATAGRAM + OVERHEAD
  const END = WIRE.EOW_BYTES + OVERHEAD
  const NOMINAL = WIRE.PING_BYTES + OVERHEAD
  const PESSIMISTIC = 192
  const nextGap = (silence: number): number =>
    Math.min(WIRE.PING_INTERVAL_MAX, Math.max(WIRE.PING_INTERVAL, silence / WIRE.PING_BACKOFF_DIVISOR))

  function pingsWithin(seconds: number): number {
    let at = 0
    let n = 0
    while (at <= seconds) {
      n++
      at += nextGap(at)
    }
    return n
  }

  function hoursUntil(pings: number): number {
    let at = 0
    for (let n = 0; n < pings; n++) at += nextGap(at)
    return at / 3600
  }

  const fixedRow = (cells: string): number => Number(cells.replaceAll(',', ''))

  it('keeps a window under the buffer, as measured', () => {
    expect(WIRE.WINDOW_CHUNKS * LARGE).toBe(195_216)
    expect(WIRE.WINDOW_CHUNKS * LARGE).toBeLessThan(BUFFER)
  })

  it('states the worst case the document states', () => {
    const worst = (WIRE.WINDOW_CHUNKS + WIRE.PROBE_BURST) * LARGE + END
    expect(worst).toBe(219_743)
    expect(DOC).toContain('**219,743 B**')
    expect(DOC).toContain(`**${(BUFFER - worst).toLocaleString('en-US')} B**`)
    expect(BUFFER - (WIRE.WINDOW_CHUNKS * LARGE + END)).toBe(66_803)
    expect(DOC).toContain('66,803 B')
  })

  it.each([
    ['80 s', 80],
    ['10 minutes', 600],
    ['1 hour', 3600],
    ['8 hours', 8 * 3600],
    ['24 hours', 24 * 3600],
  ])('counts the pings of a pause of %s as the table does', (label, seconds) => {
    const row = new RegExp(`^\\| ${label} \\| ([0-9,]+) \\| (\\d+) KB \\| (\\d+) KB \\|$`, 'm').exec(DOC)
    expect(row, `${label} has no row`).not.toBeNull()
    const [, count, nominal, pessimistic] = row as RegExpExecArray
    expect(pingsWithin(seconds)).toBe(fixedRow(count))
    expect(Math.round((pingsWithin(seconds) * NOMINAL) / 1000)).toBe(+nominal)
    expect(Math.round((pingsWithin(seconds) * PESSIMISTIC) / 1000)).toBe(+pessimistic)
  })

  it('lasts as long as the document says', () => {
    const room = BUFFER - ((WIRE.WINDOW_CHUNKS + WIRE.PROBE_BURST) * LARGE + END)
    expect(hoursUntil(Math.floor(room / PESSIMISTIC)).toFixed(1)).toBe('12.7')
    expect(hoursUntil(Math.floor(room / NOMINAL)).toFixed(1)).toBe('25.0')
    const windowRoom = BUFFER - (WIRE.WINDOW_CHUNKS * LARGE + END)
    expect(hoursUntil(Math.floor(windowRoom / PESSIMISTIC)).toFixed(1)).toBe('23.3')
    expect(hoursUntil(Math.floor(windowRoom / NOMINAL)).toFixed(1)).toBe('42.7')
    expect((hoursUntil(Math.floor(BUFFER / PESSIMISTIC)) / 24).toFixed(1)).toBe('4.5')
    expect((hoursUntil(Math.floor(BUFFER / NOMINAL)) / 24).toFixed(1)).toBe('7.7')
  })

  it('states the worst case of the nudges the document states', () => {
    const room = BUFFER - ((WIRE.WINDOW_CHUNKS + WIRE.PROBE_BURST) * LARGE + END)
    const perHour = 3600 / WIRE.PING_INTERVAL
    expect(perHour).toBe(720)
    expect(Math.round((perHour * NOMINAL) / 1000)).toBe(83)
    expect(Math.round((perHour * PESSIMISTIC) / 1000)).toBe(138)
    expect(Math.round((100 * NOMINAL) / 1000)).toBe(12)
    expect(Math.round((100 * PESSIMISTIC) / 1000)).toBe(19)
    expect(100 * WIRE.PING_INTERVAL / 60).toBeGreaterThan(8)
    expect(Math.round((Math.floor(room / PESSIMISTIC) * WIRE.PING_INTERVAL) / 60)).toBe(18)
    expect(Math.round((Math.floor(room / NOMINAL) * WIRE.PING_INTERVAL) / 60)).toBe(31)
    expect(DOC).toContain('after 18 minutes at 192 B, or 31 minutes at 115 B')
  })

  it('shows why the back-off exists: a fixed ping fills the room in under an hour', () => {
    const windowRoom = BUFFER - (WIRE.WINDOW_CHUNKS * LARGE + END)
    expect(Math.floor(windowRoom / NOMINAL) * WIRE.PING_INTERVAL).toBeLessThan(3600)
    expect(Math.round((Math.floor(windowRoom / NOMINAL) * WIRE.PING_INTERVAL) / 60)).toBe(48)
  })
})

describe('contract/datagrams/messages.json', () => {
  const types = new Set(messages.map(m => `${m.link} ${m.from} ${m.type}`))

  it('has every message in every direction', () => {
    for (const t of ['ping', 'probe', 'chunk', 'end-of-window']) expect(types.has(`udp bridge ${t}`), t).toBe(true)
    for (const t of ['hello', 'ready', 'missing', 'ack', 'nack']) expect(types.has(`udp mod ${t}`), t).toBe(true)
    for (const t of ['snapshot', 'announce']) expect(types.has(`ws planner ${t}`), t).toBe(true)
    for (const t of ['status', 'error']) expect(types.has(`ws bridge ${t}`), t).toBe(true)
  })

  it('has a hello of another version, laid out differently from this one', () => {
    for (const name of ['hello-other-version', 'hello-other-version-short']) {
      const m = messages.find(x => x.name === name) as Message
      expect(parseBridgeInput(hexBytes(m.hex))).toEqual({ protocol: 2 })
    }
  })

  it('has a status for every link and every transfer state, and every error and refusal', () => {
    const statuses = messages.filter(m => m.type === 'status').map(m => m.fields as { mod: { link: string }; transfer?: { state: string } })
    expect(new Set(statuses.map(s => s.mod.link))).toEqual(new Set(['none', 'connected', 'quiet', 'mismatch']))
    expect(new Set(statuses.flatMap(s => s.transfer?.state ?? []))).toEqual(
      new Set(['waiting', 'sending', 'stalled', 'delivered', 'rejected', 'failed']),
    )
    expect(new Set(messages.filter(m => m.type === 'error').map(m => m.fields.code))).toEqual(
      new Set(['bad-envelope', 'bad-message', 'too-large', 'protocol-mismatch']),
    )
    expect(new Set(messages.filter(m => m.type === 'nack').map(m => m.fields.reason))).toEqual(new Set(['length', 'json', 'version', 'invalid']))
    for (const s of statuses) expect(JSON.stringify(s)).not.toMatch(/null/)
  })

  it.each(messages.filter(m => m.link === 'udp' && m.from === 'bridge').map(m => [m.name, m] as const))('the mod reads %s', (_, m) => {
    const parsed = parseModInput(hexBytes(m.hex)) as Parsed & Record<string, unknown>
    expect(parsed).not.toBeNull()
    const { protocol, payloadBytes, newest, ...rest } = m.fields
    expect(protocol).toBe(1)
    if (parsed.kind === 'ping') expect(parsed.newest === NO_ID ? null : parsed.newest).toBe(newest)
    else expect(parsed).toMatchObject(rest)
    if (parsed.kind === 'chunk') expect(parsed.payload.length).toBe(payloadBytes)
  })

  it.each(messages.filter(m => m.link === 'udp' && m.from === 'mod').map(m => [m.name, m] as const))('the bridge reads %s', (_, m) => {
    expect(parseBridgeInput(hexBytes(m.hex))).toEqual(m.fields)
    expect(hexBytes(m.hex).length).toBeLessThanOrEqual(WIRE.MAX_REPORT_BYTES)
  })

  it('has a probe of exactly one full datagram, padded with dots', () => {
    const probe = hexBytes((messages.find(m => m.type === 'probe') as Message).hex)
    expect(probe.length).toBe(WIRE.MAX_DATAGRAM)
    expect(probe.subarray(WIRE.PROBE_HEADER).every(b => b === 0x2e)).toBe(true)
  })

  it('has a snapshot frame the bridge accepts, and its envelope is all it reads', () => {
    const m = messages.find(x => x.type === 'snapshot') as Message
    const frame = hexBytes(m.hex)
    expect(wsError('binary', frame)).toBeNull()
    const body = frame.subarray(WIRE.WS_ENVELOPE)
    expect(createHash('sha256').update(body).digest('hex').slice(0, 16)).toBe(m.fields.id)
    expect(SnapshotSchema.safeParse(JSON.parse(body.toString('utf-8'))).success).toBe(true)
    expect(wsError('text', hexBytes((messages.find(x => x.type === 'announce') as Message).hex))).toBeNull()
  })
})

describe('contract/datagrams/malformed.json', () => {
  it('covers each reader', () => {
    expect(new Set(inputs.map(i => i.reader))).toEqual(new Set(['mod', 'bridge-udp', 'bridge-ws']))
  })

  it('has unique reasons within each reader', () => {
    const seen = inputs.map(i => `${i.reader}: ${i.why}`)
    expect(new Set(seen).size).toBe(seen.length)
  })

  it.each(inputs.filter(i => i.reader === 'mod').map(i => [i.why, i] as const))('the mod drops: %s', (_, i) => {
    expect(parseModInput(hexBytes(i.hex))).toBeNull()
  })

  it.each(inputs.filter(i => i.reader === 'bridge-udp').map(i => [i.why, i] as const))('the bridge drops: %s', (_, i) => {
    expect(parseBridgeInput(hexBytes(i.hex))).toBeNull()
  })

  it.each(inputs.filter(i => i.reader === 'bridge-ws').map(i => [i.why, i] as const))('the bridge answers an error to: %s', (_, i) => {
    expect(wsError(i.frame as string, hexBytes(i.hex))).toBe(i.error)
  })
})

describe('contract/datagrams/case-*.json', () => {
  it('covers what the document promises', () => {
    const names = cases.map(c => c.case)
    for (const name of [
      'in-order', 'two-windows', 'max-size-chunks', 'reordered', 'duplicate-chunk', 'missing-chunk', 'window-lost',
      'report-worst-case', 'report-capped', 'mixed-chunk-sizes', 'lost-end-of-window', 'multibyte-straddle', 'wrong-byte-length', 'invalid-json', 'snapshot-version', 'snapshot-invalid',
      'superseded', 'already-stored', 'lost-on-load', 'resume-after-pause', 'one-answer-per-poll', 'stale-signal',
      'no-snapshot-not-stale', 'protocol-mismatch', 'conflicting-header',
      'many-windows', 'no-progress', 'no-progress-reset', 'rejected-then-stored',
    ]) {
      expect(names, name).toContain(name)
    }
    for (const file of caseFiles) expect(file).toBe(`case-${(readJson(file) as Case).case}.json`)
  })

  it.each(cases.map(c => [c.case, c] as const))('%s replays through a reader built from the document', (_, c) => {
    const mod = new ReferenceMod(c)
    c.polls.forEach((poll, i) => {
      for (const d of poll.arrive) mod.receive(hexBytes(d.hex))
      expect(mod.flush(), `answer after poll ${i}`).toBe(poll.answer)
      expect(mod.state, `state after poll ${i}`).toEqual(poll.after)
    })
    if (c.snapshot && c.polls[c.polls.length - 1].after.stored === c.snapshot.id) {
      expect(mod.stored?.data?.toString('hex'), 'the joined bytes').toBe(c.snapshot.hex)
    }
  })

  it.each(cases.map(c => [c.case, c] as const))('%s keeps to the datagram limits', (_, c) => {
    for (const poll of c.polls) {
      for (const d of poll.arrive) {
        const bytes = hexBytes(d.hex)
        expect(bytes.length, d.text).toBeLessThanOrEqual(WIRE.MAX_DATAGRAM)
        expect(bytes.subarray(0, Buffer.byteLength(d.text, 'latin1')).toString('latin1')).toBe(d.text)
        if (d.type === 'probe') expect(bytes.length).toBe(WIRE.MAX_DATAGRAM)
      }
      if (poll.answer) {
        expect(poll.answer.length).toBeLessThanOrEqual(WIRE.MAX_REPORT_BYTES)
        expect(parseBridgeInput(Buffer.from(poll.answer, 'latin1')), poll.answer).not.toBeNull()
      }
    }
  })

  it.each(cases.filter(c => c.snapshot).map(c => [c.case, c] as const))('%s names its snapshot by content hash', (_, c) => {
    const s = c.snapshot as NonNullable<Case['snapshot']>
    const bytes = hexBytes(s.hex)
    expect(bytes.length).toBe(s.bytes)
    expect(createHash('sha256').update(bytes).digest('hex').slice(0, 16)).toBe(s.id)
    expect(SnapshotSchema.safeParse(JSON.parse(bytes.toString('utf-8'))).success).toBe(true)
  })

  it.each(cases.filter(c => c.snapshot).map(c => [c.case, c] as const))('%s cuts its snapshot at the size it declares', (_, c) => {
    const s = c.snapshot as NonNullable<Case['snapshot']>
    const payloads = chunkPayloads(c)
    expect(Buffer.concat(payloads).toString('hex')).toBe(s.hex)
    if (c.case !== 'mixed-chunk-sizes') {
      for (const p of payloads.slice(0, -1)) expect(p.length).toBe(s.chunkSize)
    }
    expect(Math.max(...payloads.map(p => p.length))).toBe(s.chunkSize)
  })

  it.each(cases.filter(c => c.bridge).map(c => [c.case, c] as const))('%s: the bridge sends what the document says', (_, c) => {
    const s = c.snapshot as NonNullable<Case['snapshot']>
    const count = Math.ceil(s.bytes / s.chunkSize)
    let upto = 0
    let round = -1
    let phase: 'active' | 'delivered' | 'rejected' | 'failed' = 'active'
    // "No progress" in the document: a report is fruitless when its ranges equal the previous
    // report's and the window it answers has the same `upto`; the run counts consecutive ones.
    let previous: { ranges: string; upto: number } | null = null
    let run = 0
    for (const step of c.bridge as BridgeStep[]) {
      const heard = parseBridgeInput(Buffer.from(step.hears, 'latin1')) as Record<string, unknown>
      expect(heard, step.hears).not.toBeNull()
      const letter = step.hears[5]
      if (phase === 'rejected' || phase === 'failed') {
        // Only a hello that shows the mod stores the target moves the bridge on.
        expect(step.sends, step.hears).toBeNull()
        if (letter === 'H' && heard.stored === s.id) phase = 'delivered'
      } else if (letter === 'A') {
        expect(step.sends).toBeNull()
        phase = 'delivered'
      } else if (letter === 'N') {
        expect(step.sends).toBeNull()
        phase = 'rejected'
      } else if (letter === 'H') {
        // Awaiting: the hello either shows the transfer still assembling, or shows the mod lost it.
        if (heard.stored === s.id) {
          expect(step.sends).toBeNull()
          phase = 'delivered'
        } else if (heard.assembling === s.id) {
          expect(step.sends).toEqual({ endOfWindow: { round, upto } })
        } else {
          expect(step.sends).toEqual({ probe: true })
          round = -1
          upto = 0
          previous = null
          run = 0
        }
      } else {
        const missing = (heard.missing as [number, number][] | undefined) ?? []
        const ranges = JSON.stringify(missing)
        run = previous && previous.ranges === ranges && previous.upto === upto ? run + 1 : 1
        previous = { ranges, upto }
        if (run >= WIRE.NO_PROGRESS_LIMIT) {
          expect(step.sends, step.hears).toBeNull()
          phase = 'failed'
        } else {
          round++
          const window = nextWindow(missing, upto, count, round)
          expect(step.sends, step.hears).toEqual(window)
          expect(window.indices.length).toBeLessThanOrEqual(WIRE.WINDOW_CHUNKS)
          upto = window.upto
        }
      }
      if (step.state) expect(phase, step.hears).toBe(step.state)
    }
  })

  it('has transcripts that agree with the mod: each window sent is the one the mod answers', () => {
    const c = caseNamed('missing-chunk')
    expect((c.bridge as BridgeStep[]).map(b => b.hears)).toEqual(c.polls.map(p => p.answer))
    const lost = caseNamed('report-capped')
    expect((lost.bridge as BridgeStep[]).map(b => b.hears)).toEqual(lost.polls.map(p => p.answer))
    const reset = caseNamed('no-progress-reset')
    expect((reset.bridge as BridgeStep[]).map(b => b.hears)).toEqual(reset.polls.map(p => p.answer))
    // The hellos the bridge hears after a refusal are the ones the mod sends, in order.
    const rejected = caseNamed('rejected-then-stored')
    const hellos = (answers: (string | null)[]): string[] => answers.filter((a): a is string => a !== null && a.startsWith('FP01 H '))
    expect(hellos((rejected.bridge as BridgeStep[]).map(b => b.hears))).toEqual(hellos(rejected.polls.map(p => p.answer)))
    expect((rejected.bridge as BridgeStep[]).map(b => b.hears)[1]).toBe(rejected.polls[1].answer)
  })

  it('straddles a 2-byte, a 3-byte and a 4-byte character, leaving a chunk that is not UTF-8 alone', () => {
    const c = caseNamed('multibyte-straddle')
    const s = c.snapshot as NonNullable<Case['snapshot']>
    const data = hexBytes(s.hex)
    // The boundaries of the chunks that really travel, not the size the case declares.
    const payloads = chunkPayloads(c)
    const split = new Set<number>()
    let at = 0
    for (const payload of payloads.slice(0, -1)) {
      at += payload.length
      if ((data[at] & 0xc0) !== 0x80) continue
      let lead = at
      while ((data[lead] & 0xc0) === 0x80) lead--
      split.add(data[lead] >= 0xf0 ? 4 : data[lead] >= 0xe0 ? 3 : 2)
    }
    expect([...split].sort()).toEqual([2, 3, 4])
    expect(s.fixture).toBe('unicode')
    const decoder = new TextDecoder('utf-8', { fatal: true })
    expect(payloads.some(p => { try { decoder.decode(p); return false } catch { return true } }), 'a chunk that is not UTF-8 alone').toBe(true)
  })

  const reportsOf = (name: string): string[] => caseNamed(name).polls.flatMap(p => p.answer ?? []).filter(a => a.startsWith('FP01 M'))

  it('stops a report at the cap, under the byte limit, when the loss is spread out', () => {
    const reports = reportsOf('report-capped')
    expect(reports[1].split(' ')[4].split(',').length).toBe(WIRE.MAX_REPORT_RANGES)
    for (const r of reports) expect(r.length).toBeLessThanOrEqual(WIRE.MAX_REPORT_BYTES)
  })

  it('reaches MAX_REPORT_BYTES exactly: twelve ranges, every index three digits', () => {
    const reports = reportsOf('report-worst-case')
    const ranges = reports[0].split(' ')[4].split(',')
    expect(ranges.length).toBe(WIRE.MAX_REPORT_RANGES)
    for (const r of ranges) expect(r, 'a range of two three-digit indices').toMatch(/^\d{3}-\d{3}$/)
    expect(reports[0].length).toBe(WIRE.MAX_REPORT_BYTES)
    for (const r of reports) expect(r.length).toBeLessThanOrEqual(WIRE.MAX_REPORT_BYTES)
    // There was a thirteenth gap, and the next round names it.
    expect(reports[1].split(' ')[4]).toBe('136-137')
  })

  it('drops a chunk whose byte length differs from the probe, when the count matches', () => {
    const c = caseNamed('conflicting-header')
    const probe = parseModInput(hexBytes(c.polls[0].arrive[0].hex)) as Parsed & { count: number; bytes: number }
    const seen = c.polls.flatMap(p => p.arrive).map(d => parseModInput(hexBytes(d.hex))).filter(p => p?.kind === 'chunk') as Extract<Parsed, { kind: 'chunk' }>[]
    expect(seen.some(p => p.count === probe.count && p.bytes !== probe.bytes), 'a chunk with only the byte length wrong').toBe(true)
    expect(seen.some(p => p.count !== probe.count && p.bytes === probe.bytes), 'a chunk with only the count wrong').toBe(true)
    // Each is dropped alone: the chunk it carries is still missing afterwards.
    expect(c.polls[1].after.have).toEqual([0])
    expect(c.polls[2].after.have).toEqual([0])
  })

  it('has chunks of different sizes, none over CHUNK_PAYLOAD, adding up to the declared bytes', () => {
    const c = caseNamed('mixed-chunk-sizes')
    const s = c.snapshot as NonNullable<Case['snapshot']>
    const sizes = chunkPayloads(c).map(p => p.length)
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(s.bytes)
    for (const size of sizes) {
      expect(size).toBeGreaterThanOrEqual(1)
      expect(size).toBeLessThanOrEqual(WIRE.CHUNK_PAYLOAD)
    }
    expect(new Set(sizes.slice(0, -1)).size, 'non-last chunks of several sizes').toBeGreaterThan(1)
    expect(sizes.slice(1, -1).some(n => n !== sizes[0]), 'a non-last chunk unlike the first').toBe(true)
    // Joining by a fixed stride would not give the snapshot.
    const stride = Buffer.alloc(s.bytes)
    chunkPayloads(c).forEach((p, i) => p.copy(stride, i * sizes[0]))
    expect(stride.toString('hex')).not.toBe(s.hex)
  })

  it('counts consecutive fruitless reports: the run starts again when a report differs', () => {
    const c = caseNamed('no-progress-reset')
    const steps = c.bridge as BridgeStep[]
    const reportSteps = steps.filter(b => b.hears.startsWith('FP01 M '))
    const reports = reportSteps.map(b => b.hears.split(' ')[4])
    // Seven identical reports, then two that differ, then identical ones.
    expect(new Set(reports.slice(0, 7))).toEqual(new Set(['0-23']))
    expect(reports[7]).not.toBe(reports[6])
    expect(reports[8]).not.toBe(reports[7])
    expect(reports.length).toBe(16)
    expect(new Set(reports.slice(8))).toEqual(new Set([reports[8]]))
    // Failed is reached at the 16th report: the 8th of the new run (reports 9 to 16), not the 8th report.
    const failedAt = steps.findIndex(b => b.state === 'failed')
    expect(failedAt).toBe(16)
    expect(failedAt).toBe(8 + WIRE.NO_PROGRESS_LIMIT)
    for (const [i, b] of steps.slice(1, failedAt).entries()) expect(b.sends, `report ${i + 1} still sends`).not.toBeNull()
    expect(steps[failedAt].sends).toBeNull()
    // `round` changes every time and does not count against the run.
    expect(new Set(reportSteps.map(b => b.hears.split(' ')[3])).size).toBe(reportSteps.length)
  })

  it('uses a full MAX_DATAGRAM chunk at the largest size', () => {
    const c = caseNamed('max-size-chunks')
    const chunks = c.polls.flatMap(p => p.arrive).filter(d => d.type === 'chunk')
    expect(hexBytes(chunks[0].hex).length).toBe(WIRE.MAX_DATAGRAM)
    expect(chunks.length).toBeGreaterThan(1)
  })

  it('leaves the previous snapshot in place whenever a transfer is refused', () => {
    for (const name of ['wrong-byte-length', 'invalid-json']) {
      const c = caseNamed(name)
      expect(c.polls[c.polls.length - 1].after.stored, name).toBe(c.start.stored?.id)
    }
  })

  it('never answers more than once per poll, and answers a backlog once', () => {
    const c = caseNamed('resume-after-pause')
    expect(c.polls[1].arrive.filter(d => d.type === 'ping').length).toBe(40)
    expect(c.polls[1].answer).toMatch(/^FP01 A /)
  })
})
