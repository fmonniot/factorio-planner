import { defineConfig, devices } from '@playwright/test'

// The e2e suite runs against its own dev server on a random port, so it never
// collides with the long-running dev server (fixed on 4000) or with e2e runs in
// other worktrees. Playwright re-evaluates this file in every worker; writing the
// choice back to the environment makes them all agree with the main process.
// Set E2E_PORT yourself to pin the port (and reuse a server already running there).
const pinned = process.env.E2E_PORT !== undefined
const port = Number(process.env.E2E_PORT ?? 20000 + Math.floor(Math.random() * 40000))
process.env.E2E_PORT = String(port)
// By default the suite serves the production build in dist/ with `vite preview` (run `npm run build` first), which is what
// ships and avoids the dev server's on-demand transforms. E2E_SERVER=dev starts the dev server instead.
const useDev = process.env.E2E_SERVER === 'dev'
// A trailing slash matters: specs go to `./`, which resolves under the production base path.
const baseURL = `http://localhost:${port}${useDev ? '/' : '/factorio-planner/'}`

// The summary strip starts collapsed to one line per pane, and most specs work with its slots and its Add product button.
// Every test therefore starts with the choice stored as "expanded", the way a user who expanded it once would; a spec for the
// default or for the collapsed summary opts out with `test.use({ storageState: { cookies: [], origins: [] } })`.
const summaryExpanded = {
  cookies: [],
  origins: [{ origin: new URL(baseURL).origin, localStorage: [{ name: 'factorio-planner:ui', value: JSON.stringify({ summaryCollapsed: false }) }] }],
}

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL,
    storageState: summaryExpanded,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: useDev ? `npm run dev -- --port ${port}` : `npm run preview -- --port ${port} --strictPort`,
    url: baseURL,
    reuseExistingServer: pinned,
  },
})
