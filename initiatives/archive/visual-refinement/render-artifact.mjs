// Renders the design artifact locally and screenshots it, so a change can be checked without opening claude.ai
// (the artifact is private).
//
//   node initiatives/visual-refinement/render-artifact.mjs <assets-dir> <out-dir> [options]
//
//   <assets-dir>   folder holding sprite.webp and data.json (output of pack-assets.mjs)
//   --runtime <f>  the Design type's runtime, saved from the artifact (Artifact read, path artifact-type/dc-runtime.js)
//   --shots "name=Button label,=Exact label,slot:0,seg:2;name2=..."   one screenshot per entry; the labels are clicked in order ("=" = exact name)
//                  (toggles, block, viewport buttons), after a reset to the page's initial state
//   --size 2340x1720   page size (default: the board's size)
//   --crop frame   screenshot only the replica (the element after "Block at ..." title)
//
// The page loads `./support.js` (the runtime) and fetches two uploaded assets by /_blob/<id>: both are served here from
// <assets-dir>. The ids are read from Main.dc.html (the sprite in the helmet rule, the data in DATA_URL).
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const here = path.dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const positional = []
const opts = {}
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith('--')) opts[args[i].slice(2)] = args[++i]
  else positional.push(args[i])
}
const [assetsDir, outDir] = positional
if (!assetsDir || !outDir || !opts.runtime) {
  console.error('usage: render-artifact.mjs <assets-dir> <out-dir> --runtime <dc-runtime.js> [--shots "a=Label,Label;b=..."] [--size WxH] [--crop frame]')
  process.exit(1)
}
fs.mkdirSync(outDir, { recursive: true })
const page_html = fs.readFileSync(path.join(here, 'artifact/project/Main.dc.html'), 'utf8')
const spriteId = page_html.match(/url\(\/_blob\/([0-9a-f]{32})\)/)?.[1]
const dataId = page_html.match(/DATA_URL = '\/_blob\/([0-9a-f]{32})'/)?.[1]
const files = {
  '/': ['text/html', page_html],
  '/support.js': ['text/javascript', fs.readFileSync(opts.runtime)],
  [`/_blob/${spriteId}`]: ['image/webp', fs.readFileSync(path.join(assetsDir, 'sprite.webp'))],
  [`/_blob/${dataId}`]: ['application/json', fs.readFileSync(path.join(assetsDir, 'data.json'))],
}
const server = http.createServer((req, res) => {
  const f = files[req.url.split('?')[0]]
  if (!f) { res.writeHead(404); res.end(); return }
  res.writeHead(200, { 'content-type': f[0] }); res.end(f[1])
}).listen(0)
const port = server.address().port
const [width, height] = (opts.size ?? '2340x1720').split('x').map(Number)
const shots = (opts.shots ?? 'initial=').split(';').map(s => {
  const at = s.indexOf('=') // the first "=" only: a label may start with "=" (exact match)
  const name = at < 0 ? s : s.slice(0, at)
  return { name, labels: (at < 0 ? '' : s.slice(at + 1)).split(',').map(l => l.trim()).filter(Boolean) }
})

const browser = await chromium.launch()
const errors = []
for (const shot of shots) {
  const page = await browser.newPage({ viewport: { width, height } })
  page.on('pageerror', e => errors.push(`${shot.name}: ${e.message}`))
  page.on('console', m => { if (m.type() === 'error') errors.push(`${shot.name}: console: ${m.text()}`) })
  await page.goto(`http://localhost:${port}/`)
  await page.getByText('Production table refinement').first().waitFor({ timeout: 15000 })
  await page.waitForFunction(() => !document.body.innerText.includes('Loading the plan content'), null, { timeout: 15000 })
  // A label starting with "=" must match the button's whole accessible name (toggle descriptions also contain words like "Show all").
  for (const label of shot.labels) {
    const m = /^slot:(\d+)$/.exec(label) // "slot:N" clicks the Nth summary slot (a title or a row would match first otherwise)
    if (m) { await page.locator('#frame button.slot').nth(+m[1]).click(); continue }
    const seg = /^seg:(\d+)$/.exec(label) // "seg:N" clicks the Nth bar segment of the summary
    if (seg) { await page.locator('#frame button.seg').nth(+seg[1]).click(); continue }
    const exact = label.startsWith('=')
    await page.getByRole('button', { name: exact ? label.slice(1) : label, exact }).first().click()
  }
  await page.waitForTimeout(400)
  const file = path.join(outDir, `${shot.name}.png`)
  if (opts.crop === 'frame') {
    const box = await page.evaluate(() => {
      const el = [...document.querySelectorAll('div')].find(d => d.style.transformOrigin === '0px 0px')
      const r = el?.parentElement?.getBoundingClientRect()
      return r ? { x: r.x, y: r.y, width: r.width, height: r.height } : null
    })
    await page.screenshot({ path: file, clip: box ?? undefined })
  } else await page.screenshot({ path: file })
  await page.close()
}
await browser.close()
server.close()
console.log(`${shots.length} screenshot(s) in ${outDir}`)
if (errors.length) console.log('page errors:\n' + errors.join('\n'))
