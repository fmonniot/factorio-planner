import { z } from 'zod'
import type { Snapshot } from '../snapshot/schema'

// ---------------------------------------------------------------------------
// The planner's side of the wire protocol between the planner and the bridge (WebSocket). The
// values are the bridge's: the byte layout and the constants must stay equal to
// contract/datagrams/ (src/viewer/protocol.test.ts replays those fixtures through this module).
// ---------------------------------------------------------------------------

/** Written `FP01` on the wire. Two versions are compatible only if they are equal. */
export const PROTOCOL_VERSION = 1

/** The bridge's `--game-port` default: the port shown until a status says otherwise, or when the bridge predates `gamePort`. */
export const DEFAULT_GAME_PORT = 34198

/** The bridge address offered by default; the README and the bridge's `--help` give the same one. */
export const DEFAULT_BRIDGE_URL = 'ws://127.0.0.1:34199/'

/** The largest snapshot the planner sends; the bridge refuses more with `too-large`. */
export const MAX_SNAPSHOT_BYTES = 8_000_000

/** Wait between two attempts to reach the bridge while the connection is switched on. */
export const PLANNER_RETRY_MS = 5_000

/** The envelope in front of the snapshot bytes of a `snapshot` frame. */
export const WS_ENVELOPE_BYTES = 32

const encoder = new TextEncoder()

/** The snapshot's bytes: compact JSON in UTF-8. */
export function snapshotBytes(snapshot: Snapshot): Uint8Array {
  return encoder.encode(JSON.stringify(snapshot))
}

/**
 * The snapshot id: the first 16 lowercase hexadecimal characters of the SHA-256 of the bytes.
 * Needs `crypto.subtle`, which only a secure context (HTTPS or localhost) has.
 */
export async function snapshotId(bytes: Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) throw new Error('This page cannot hash the plan: the browser only offers that on HTTPS or localhost.')
  const digest = new Uint8Array(await subtle.digest('SHA-256', bytes as BufferSource))
  let hex = ''
  for (const b of digest.subarray(0, 8)) hex += b.toString(16).padStart(2, '0')
  return hex
}

/** A `snapshot` frame: the 32-byte envelope, then the bytes. */
export function encodeSnapshotFrame(id: string, bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const envelope = `FP0${PROTOCOL_VERSION} S ${id} ${String(bytes.length).padStart(7, '0')} `
  const frame = new Uint8Array(WS_ENVELOPE_BYTES + bytes.length)
  frame.set(encoder.encode(envelope), 0)
  frame.set(bytes, WS_ENVELOPE_BYTES)
  return frame
}

/** An `announce` frame (text). */
export function encodeAnnounce(id: string): string {
  return JSON.stringify({ type: 'announce', protocol: PROTOCOL_VERSION, id })
}

// ---------------------------------------------------------------------------
// Messages from the bridge
// ---------------------------------------------------------------------------

const ModSchema = z.object({
  link: z.string(),
  protocol: z.number().optional(),
  stored: z.string().optional(),
  unknownIds: z.number().optional(),
})

const TransferSchema = z.object({
  id: z.string(),
  state: z.string(),
  sent: z.number().optional(),
  count: z.number().optional(),
  reason: z.string().optional(),
})

const StatusSchema = z.object({
  type: z.literal('status'),
  protocol: z.number(),
  bridge: z.string().optional(),
  gamePort: z.number().optional(),
  newest: z.string().optional(),
  mod: ModSchema.optional(),
  transfer: TransferSchema.optional(),
})

/** The bridge's whole state. Only `protocol` is certain to be there when it is another version's. */
export type BridgeStatus = z.output<typeof StatusSchema>

const ErrorSchema = z.object({ type: z.literal('error'), code: z.string() })

export type BridgeMessage =
  | { kind: 'status'; status: BridgeStatus }
  /** A `status` that claims our protocol version but does not have the shape that version defines. */
  | { kind: 'unreadable-status' }
  | { kind: 'error'; code: string }

/**
 * Reads a text frame from the bridge; null for anything else. A status of another protocol version
 * is accepted on its `protocol` alone, since another version may lay out the rest differently. A
 * status of our own version that breaks the schema is reported, not dropped, so the player is told.
 */
export function parseBridgeMessage(text: string): BridgeMessage | null {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  const error = ErrorSchema.safeParse(raw)
  if (error.success) return { kind: 'error', code: error.data.code }
  const status = StatusSchema.safeParse(raw)
  if (status.success) return { kind: 'status', status: status.data }
  const other = z.object({ type: z.literal('status'), protocol: z.number() }).safeParse(raw)
  if (!other.success) return null
  if (other.data.protocol !== PROTOCOL_VERSION) return { kind: 'status', status: { type: 'status', protocol: other.data.protocol } }
  return { kind: 'unreadable-status' }
}

/** What an `error` code from the bridge means for the player. */
export function describeBridgeError(code: string): string {
  switch (code) {
    case 'too-large':
      return 'The bridge refused the plan: it is too large for the in-game viewer.'
    case 'protocol-mismatch':
      return 'The bridge speaks another protocol version than this planner. Update the planner and the bridge together.'
    case 'bad-envelope':
      return 'The bridge could not read the snapshot it was sent (malformed envelope). This is a bug in the planner; please report it.'
    case 'bad-message':
      return 'The bridge could not understand a message from the planner (bad-message). This is a bug in the planner; please report it.'
    default:
      return `The bridge reported an error: ${code}.`
  }
}
