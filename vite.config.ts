import { createReadStream, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import sharp from 'sharp'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // Serve bundled game datasets during development.
    // In production the prebuild script copies the files into public/ first.
    {
      name: 'serve-bundled-game-data',
      configureServer(server) {
        server.middlewares.use('/data/nullius/game-data.json', (_req, res) => {
          const filePath = resolve('data/samples/nullius/game-data.json')
          try {
            const stat = statSync(filePath)
            res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': stat.size })
            createReadStream(filePath).pipe(res)
          } catch {
            res.writeHead(404)
            res.end()
          }
        })
      },
    },
    // Lazy-convert icon PNGs to WebP on dev-server requests so <picture>
    // sources resolve in dev the same way they do in prod (postbuild generates
    // siblings into dist/). Cached in-process; cold-cache cost ~5–20 ms/icon.
    {
      name: 'serve-webp-icons-dev',
      apply: 'serve',
      configureServer(server) {
        const cache = new Map<string, Buffer>()
        server.middlewares.use(async (req, res, next) => {
          const url = req.url ?? ''
          const match = url.match(/^(\/data\/.+\.webp)(?:\?.*)?$/)
          if (!match) return next()
          const webpUrl = match[1]
          let buf = cache.get(webpUrl)
          if (!buf) {
            const pngFsPath = resolve('public' + webpUrl.replace(/\.webp$/, '.png'))
            try {
              const png = await readFile(pngFsPath)
              buf = await sharp(png).webp({ quality: 80, effort: 1 }).toBuffer()
              cache.set(webpUrl, buf)
            } catch {
              return next()
            }
          }
          res.writeHead(200, {
            'Content-Type': 'image/webp',
            'Content-Length': buf.length,
            'Cache-Control': 'no-cache',
          })
          res.end(buf)
        })
      },
    },
  ],
})
