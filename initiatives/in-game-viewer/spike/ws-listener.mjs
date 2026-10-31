// Throwaway WebSocket listener for Phase 0 step 1. No dependencies: it only
// completes the handshake, sends one text frame and logs the Origin header.
// Usage: node ws-listener.mjs [port]   (default 8787)
import http from 'node:http'
import crypto from 'node:crypto'

const port = Number(process.argv[2] ?? 8787)
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'

const server = http.createServer((req, res) => {
  res.writeHead(426).end('upgrade required')
})

server.on('upgrade', (req, socket) => {
  console.log(`${new Date().toISOString()} upgrade from Origin=${req.headers.origin ?? '(none)'} Host=${req.headers.host}`)
  const accept = crypto.createHash('sha1').update(req.headers['sec-websocket-key'] + GUID).digest('base64')
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
  )
  const msg = Buffer.from('hello from listener')
  socket.write(Buffer.concat([Buffer.from([0x81, msg.length]), msg]))
  socket.on('data', () => {}) // ignore client frames (including close)
  socket.on('error', () => {})
})

server.listen(port, '127.0.0.1', () => console.log(`listening on ws://127.0.0.1:${port}`))
