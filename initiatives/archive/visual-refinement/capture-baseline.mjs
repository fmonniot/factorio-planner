// Screenshots the planner for the visual-refinement initiative.
//
//   npm run dev -- --port 4173          (in another terminal)
//   node initiatives/visual-refinement/capture-baseline.mjs <plan.json> <out-dir> [options]
//
// Options:
//   --blocks "Hub,Metals"   block names to capture, in order (default: the plan's active block)
//   --size 1440x900         viewport (default 1440x900)
//   --suffix wide           appended to every file name, to keep several sizes apart
//   --url http://...        planner URL (default http://localhost:4173/, or $PLANNER_URL)
//
// Seeds the plan into localStorage under the data set named by its `dataSet` stamp (Nullius when
// it has none), waits for the solve, then for each block activates its tab and writes
// <out-dir>/<block-slug>[-<suffix>].png, and, when the table has a recipe row, a second
// <block-slug>[-<suffix>]-selected.png with that row selected (side panel open).
// Needs `npx playwright install chromium` once.
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from '@playwright/test'

const args = process.argv.slice(2)
const positional = []
const opts = {}
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith('--')) opts[args[i].slice(2)] = args[++i]
  else positional.push(args[i])
}
const [planPath, outDir] = positional
if (!planPath || !outDir) {
  console.error('usage: capture-baseline.mjs <plan.json> <out-dir> [--blocks A,B] [--size WxH] [--suffix s] [--url u]')
  process.exit(1)
}
const [width, height] = (opts.size ?? '1440x900').split('x').map(Number)
const url = opts.url ?? process.env.PLANNER_URL ?? 'http://localhost:4173/'
const planJson = fs.readFileSync(planPath, 'utf8')
const plan = JSON.parse(planJson)
const sourceId = plan.dataSet?.id ?? 'nullius'
const blockNames = opts.blocks
  ? opts.blocks.split(',').map(s => s.trim())
  : [plan.blocks.find(b => b.id === plan.activeBlockId)?.name ?? plan.blocks[0].name]
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
fs.mkdirSync(outDir, { recursive: true })

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width, height } })
// The legacy single-plan key is migrated into the plan list on load (see e2e/support/loadPlan.ts).
await page.addInitScript(
  ({ id, json }) => {
    localStorage.setItem(`factorio-planner:app-state:${id}`, json)
    localStorage.setItem('factorio-planner:game-data-source', id)
  },
  { id: sourceId, json: planJson },
)
await page.goto(url)
await page.getByText('Load game data to begin').waitFor({ state: 'detached', timeout: 60000 })
await page.waitForTimeout(4000) // first solve of every block

for (const name of blockNames) {
  const tab = page.getByTestId('block-tab').filter({ hasText: name }).locator('button').first()
  if (await tab.count()) await tab.click()
  else console.warn(`no tab named "${name}"; capturing the active block`)
  await page.waitForTimeout(1500)
  const base = path.join(outDir, slug(name) + (opts.suffix ? `-${opts.suffix}` : ''))
  await page.screenshot({ path: `${base}.png` })

  const recipe = page.locator('tr[data-node-id] button[aria-pressed]').first()
  if (await recipe.count()) {
    await recipe.click()
    await page.waitForTimeout(800)
    await page.screenshot({ path: `${base}-selected.png` })
    // Escape does not close the panel yet; below xl it is a drawer that would cover the tabs.
    await page.getByRole('button', { name: 'Close panel' }).click()
  }
}
await browser.close()
