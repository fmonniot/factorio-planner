import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { WebSocketServer, type RawData, type WebSocket } from 'ws'

// ---------------------------------------------------------------------------
// A fake bridge: a WebSocket server speaking the planner side of the wire protocol (binary
// `snapshot` frames with the 32-byte envelope, text `announce`, `status` and `error`). It checks the
// envelope as the real bridge does and records what the planner sent. Status messages come from the
// shared fixtures (contract/datagrams/messages.json), so a change to the wire format breaks here too.
// ---------------------------------------------------------------------------

interface FixtureMessage { name: string; frame?: string; hex: string }
const FIXTURES = (JSON.parse(readFileSync(path.resolve('contract/datagrams/messages.json'), 'utf8')) as { messages: FixtureMessage[] }).messages

/** The text of a bridge-to-planner fixture message, parsed. */
export function fixtureMessage(name: string): Record<string, unknown> {
  const m = FIXTURES.find(x => x.name === name && x.frame === 'text')
  if (!m) throw new Error(`no text fixture ${name}`)
  return JSON.parse(Buffer.from(m.hex, 'hex').toString('utf8')) as Record<string, unknown>
}

export type Received =
  | { kind: 'snapshot'; id: string; bytes: Buffer; idMatchesBytes: boolean }
  | { kind: 'announce'; id: string; protocol: number }
  | { kind: 'bad'; reason: string }

/** Parses a planner frame the way the bridge does; `bad` for what it would answer with an `error`. */
export function parseFrame(data: Buffer, isBinary: boolean): Received {
  if (!isBinary) {
    const msg = JSON.parse(data.toString('utf8')) as { type?: string; id?: string; protocol?: number }
    if (msg.type === 'announce' && typeof msg.id === 'string' && /^[0-9a-f]{16}$/.test(msg.id)) {
      return { kind: 'announce', id: msg.id, protocol: msg.protocol ?? 0 }
    }
    return { kind: 'bad', reason: 'bad-message' }
  }
  const envelope = data.subarray(0, 32).toString('latin1')
  const m = /^FP01 S ([0-9a-f]{16}) (\d{7}) $/.exec(envelope)
  if (!m) return { kind: 'bad', reason: 'bad-envelope' }
  const bytes = data.subarray(32)
  if (Number(m[2]) !== bytes.length) return { kind: 'bad', reason: 'bad-envelope' }
  const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 16)
  return { kind: 'snapshot', id: m[1], bytes: Buffer.from(bytes), idMatchesBytes: hash === m[1] }
}

export interface FakeBridge {
  /** `ws://127.0.0.1:<port>/` */
  url: string
  port: number
  /** Everything received since the last `clear()`, in order. */
  received: Received[]
  /** Connections accepted since the server started (all time). */
  connections: number
  /** The first `status` of every new connection; replace to change what the next connection sees. */
  initialStatus: Record<string, unknown>
  /** Sends a status to every connected planner. */
  broadcast: (message: Record<string, unknown>) => void
  /** Answers every connected planner with an `error`. */
  sendError: (code: string) => void
  /** If set, every frame received is answered with this error code. */
  answerWithError: string | null
  clear: () => void
  /** Closes the server and its connections. */
  stop: () => Promise<void>
  /** Starts a new server on the same port (after `stop`), with the given first status. */
  restart: (initialStatus?: Record<string, unknown>) => Promise<void>
  snapshots: () => Extract<Received, { kind: 'snapshot' }>[]
  announces: () => Extract<Received, { kind: 'announce' }>[]
}

export async function startFakeBridge(initialStatus: Record<string, unknown> = fixtureMessage('status-no-mod'), port = 0): Promise<FakeBridge> {
  let server: WebSocketServer
  const clients = new Set<WebSocket>()

  const bridge: FakeBridge = {
    url: '',
    port: 0,
    received: [],
    connections: 0,
    initialStatus,
    answerWithError: null,
    broadcast: message => { for (const c of clients) c.send(JSON.stringify(message)) },
    sendError: code => { for (const c of clients) c.send(JSON.stringify({ type: 'error', code })) },
    clear: () => { bridge.received.length = 0 },
    stop: () => new Promise<void>(resolve => {
      for (const c of clients) c.terminate()
      clients.clear()
      server.close(() => resolve())
    }),
    restart: async status => {
      if (status) bridge.initialStatus = status
      await listen(bridge.port)
    },
    snapshots: () => bridge.received.filter(r => r.kind === 'snapshot'),
    announces: () => bridge.received.filter(r => r.kind === 'announce'),
  }

  function listen(wantedPort: number): Promise<void> {
    return new Promise((resolve, reject) => {
      server = new WebSocketServer({ host: '127.0.0.1', port: wantedPort, maxPayload: 10_000_031 })
      server.once('error', reject)
      server.once('listening', () => {
        const address = server.address()
        if (typeof address === 'string' || !address) throw new Error('no address')
        bridge.port = address.port
        bridge.url = `ws://127.0.0.1:${address.port}/`
        resolve()
      })
      server.on('connection', ws => {
        clients.add(ws)
        bridge.connections++
        ws.on('close', () => clients.delete(ws))
        ws.send(JSON.stringify(bridge.initialStatus))
        ws.on('message', (data: RawData, isBinary: boolean) => {
          const frame = parseFrame(Buffer.isBuffer(data) ? data : Buffer.concat(data as Buffer[]), isBinary)
          if (frame.kind === 'bad') {
            ws.send(JSON.stringify({ type: 'error', code: frame.reason }))
            return
          }
          bridge.received.push(frame)
          if (bridge.answerWithError) ws.send(JSON.stringify({ type: 'error', code: bridge.answerWithError }))
        })
      })
    })
  }

  await listen(port)
  return bridge
}
