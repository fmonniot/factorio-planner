import { defineConfig, devices } from '@playwright/test'

// The e2e suite runs against its own dev server on a random port, so it never
// collides with the long-running dev server (fixed on 4000) or with e2e runs in
// other worktrees. Playwright re-evaluates this file in every worker; writing the
// choice back to the environment makes them all agree with the main process.
// Set E2E_PORT yourself to pin the port (and reuse a server already running there).
const pinned = process.env.E2E_PORT !== undefined
const port = Number(process.env.E2E_PORT ?? 20000 + Math.floor(Math.random() * 40000))
process.env.E2E_PORT = String(port)
const baseURL = `http://localhost:${port}`

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: `npm run dev -- --port ${port}`,
    url: baseURL,
    reuseExistingServer: pinned,
  },
})
