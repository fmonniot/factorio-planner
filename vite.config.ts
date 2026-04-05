import { createReadStream, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

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
  ],
})
