import { readFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import sharp from 'sharp'

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  // The desktop app (src-tauri/) serves its build from its own origin, at the root; the Tauri CLI sets
  // TAURI_ENV_PLATFORM for the build it runs, so a build for the web keeps the GitHub Pages path. The two builds go to
  // separate folders, so a desktop build never leaves dist/ with the wrong base for `npm run preview` or the e2e suite.
  base: mode === 'production' && !process.env.TAURI_ENV_PLATFORM ? '/factorio-planner/' : '/',
  build: {
    outDir: process.env.TAURI_ENV_PLATFORM ? 'dist-desktop' : 'dist',
    rolldownOptions: {
      output: {
        // Chunks the browser can cache and fetch side by side, so that no single one passes the 500 kB size warning:
        // third-party code (it changes far less often than the planner's own), and the solver. The two big modals
        // (src/components/lazyModals.ts) are split off by dynamic import instead.
        codeSplitting: {
          groups: [
            { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/, priority: 3 },
            { name: 'lp-solver', test: /node_modules[\\/]javascript-lp-solver[\\/]/, priority: 2 },
            { name: 'solver', test: /[\\/]src[\\/]solver[\\/]/, priority: 2 },
            { name: 'vendor', test: /node_modules/, priority: 1 },
          ],
        },
      },
    },
  },
  // Fixed: the bridge's default allowed origins assume it. Playwright overrides it with --port. The Rust folders are not
  // watched: cargo writes tens of thousands of files under their target/ on every build.
  server: { port: 4000, strictPort: true, watch: { ignored: ['**/src-tauri/**', '**/bridge/**'] } },
  // `npm run tauri dev` shares the terminal with cargo; clearing it would hide cargo's errors.
  clearScreen: !process.env.TAURI_ENV_PLATFORM,
  plugins: [
    react(),
    tailwindcss(),
    // Lazy-convert icon PNGs to WebP on dev-server requests so <picture>
    // sources resolve in dev the same way they do in prod (postbuild generates
    // siblings into dist/). Cached in-process per PNG modification time, so a
    // regenerated icon is re-converted; cold-cache cost ~5–20 ms/icon.
    {
      name: 'serve-webp-icons-dev',
      apply: 'serve',
      configureServer(server) {
        const cache = new Map<string, { mtimeMs: number; buf: Buffer }>()
        server.middlewares.use(async (req, res, next) => {
          const url = req.url ?? ''
          const match = url.match(/^(\/data\/.+\.webp)(?:\?.*)?$/)
          if (!match) return next()
          const webpUrl = match[1]
          const pngFsPath = resolve('public' + webpUrl.replace(/\.webp$/, '.png'))
          let buf: Buffer
          try {
            const { mtimeMs } = await stat(pngFsPath)
            const cached = cache.get(webpUrl)
            if (cached?.mtimeMs === mtimeMs) {
              buf = cached.buf
            } else {
              buf = await sharp(await readFile(pngFsPath)).webp({ quality: 80, effort: 1 }).toBuffer()
              cache.set(webpUrl, { mtimeMs, buf })
            }
          } catch {
            return next()
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
}))
