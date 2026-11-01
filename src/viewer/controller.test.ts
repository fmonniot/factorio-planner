import { describe, expect, it } from 'vitest'
import { createController, type SocketLike } from './controller'

// The adapter with a fake socket and fake timers: nothing opens unless the connection is enabled.

class FakeSocket implements SocketLike {
  binaryType = 'blob'
  readyState = 0
  onopen: SocketLike['onopen'] = null
  onclose: SocketLike['onclose'] = null
  onerror: SocketLike['onerror'] = null
  onmessage: SocketLike['onmessage'] = null
  sent: (string | Uint8Array)[] = []
  closed = false
  url: string
  constructor(url: string) { this.url = url }
  send(data: string | Uint8Array<ArrayBuffer>) { this.sent.push(data) }
  close() { this.closed = true }
  open() { this.readyState = 1; this.onopen?.(new Event('open')) }
  drop() { this.readyState = 3; this.onclose?.(new Event('close') as CloseEvent) }
  say(data: string) { this.onmessage?.(new MessageEvent('message', { data })) }
}

function setup(createSocket?: (url: string) => FakeSocket) {
  const sockets: FakeSocket[] = []
  const timers = new Map<number, { fn: () => void; ms: number }>()
  let nextTimer = 1
  const controller = createController({
    getUrl: () => 'ws://example/',
    createSocket: url => {
      const s = createSocket ? createSocket(url) : new FakeSocket(url)
      sockets.push(s)
      return s
    },
    setTimer: (fn, ms) => { timers.set(nextTimer, { fn, ms }); return nextTimer++ },
    clearTimer: h => { timers.delete(h as number) },
    retryMs: 5000,
    slowMs: 2500,
  })
  const fire = (ms: number) => {
    const entry = [...timers.entries()].find(([, t]) => t.ms === ms)
    if (!entry) throw new Error(`no timer of ${ms} ms`)
    timers.delete(entry[0])
    entry[1].fn()
  }
  return { controller, sockets, timers, fire }
}

const STATUS = JSON.stringify({ type: 'status', protocol: 1, mod: { link: 'none' } })

describe('createController', () => {
  it('opens no socket and starts no timer until enabled', () => {
    const { controller, sockets, timers } = setup()
    controller.dispatch({ type: 'solved', plan: { id: 'a'.repeat(16), size: 1 } })
    expect(sockets).toHaveLength(0)
    expect(timers.size).toBe(0)
  })

  it('connects, sends an announce after the first status, and closes when disabled', () => {
    const { controller, sockets } = setup()
    controller.dispatch({ type: 'solved', plan: { id: 'a'.repeat(16), size: 1, bytes: new Uint8Array(1) } })
    controller.dispatch({ type: 'enable' })
    expect(sockets[0].url).toBe('ws://example/')
    expect(sockets[0].binaryType).toBe('arraybuffer')
    sockets[0].open()
    sockets[0].say(STATUS)
    expect(sockets[0].sent).toEqual([JSON.stringify({ type: 'announce', protocol: 1, id: 'a'.repeat(16) })])
    controller.dispatch({ type: 'disable' })
    expect(sockets[0].closed).toBe(true)
  })

  it('sends a binary frame for Send', () => {
    const { controller, sockets } = setup()
    controller.dispatch({ type: 'enable' })
    sockets[0].open()
    sockets[0].say(STATUS)
    controller.dispatch({ type: 'solved', plan: { id: 'a'.repeat(16), size: 2, bytes: new Uint8Array([1, 2]) } })
    controller.dispatch({ type: 'send' })
    const frame = sockets[0].sent[1] as Uint8Array
    expect(frame).toBeInstanceOf(Uint8Array)
    expect(frame.length).toBe(34)
  })

  it('retries every retry interval, and not after disabling', () => {
    const { controller, sockets, timers, fire } = setup()
    controller.dispatch({ type: 'enable' })
    sockets[0].drop()
    expect(controller.getState().phase).toBe('waiting')
    fire(5000)
    expect(sockets).toHaveLength(2)
    sockets[1].drop()
    controller.dispatch({ type: 'disable' })
    expect(timers.size).toBe(0)
    expect(sockets).toHaveLength(2)
  })

  it('flags a socket that stays connecting', () => {
    const { controller, fire } = setup()
    controller.dispatch({ type: 'enable' })
    fire(2500)
    expect(controller.getState().slowConnect).toBe(true)
  })

  it('reports a browser that throws on creation and retries', () => {
    const { controller, timers } = setup(() => { throw new DOMException('insecure', 'SecurityError') })
    controller.dispatch({ type: 'enable' })
    expect(controller.getState().failure).toBe('blocked')
    expect([...timers.values()].some(t => t.ms === 5000)).toBe(true)
  })

  it('reports a malformed address', () => {
    const { controller } = setup(() => { throw new DOMException('bad', 'SyntaxError') })
    controller.dispatch({ type: 'enable' })
    expect(controller.getState().failure).toBe('bad-address')
  })

  it('ignores events of a socket it dropped', () => {
    const { controller, sockets } = setup()
    controller.dispatch({ type: 'enable' })
    const old = sockets[0]
    controller.dispatch({ type: 'disable' })
    old.open()
    old.say(STATUS)
    expect(controller.getState().phase).toBe('off')
  })
})
