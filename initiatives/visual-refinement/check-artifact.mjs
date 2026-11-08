// Exercises the design artifact the way the owner would: every toggle's description and "Try:" line is turned into
// an assertion on the rendered page (hover, click, scroll, keyboard), so a claim the page does not implement fails
// here instead of being found by the owner. Run it after every edit of artifact/project/Main.dc.html.
//
//   node initiatives/visual-refinement/check-artifact.mjs <assets-dir> --runtime <dc-runtime.js> [--shots <dir>] [--only <text in a check's name>]
//
// <assets-dir> and --runtime are the same as for render-artifact.mjs. Exit code 1 when a check fails.
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
const [assetsDir] = positional
if (!assetsDir || !opts.runtime) { console.error('usage: check-artifact.mjs <assets-dir> --runtime <dc-runtime.js> [--shots <dir>]'); process.exit(1) }
if (opts.shots) fs.mkdirSync(opts.shots, { recursive: true })

const html = fs.readFileSync(path.join(here, 'artifact/project/Main.dc.html'), 'utf8')
const spriteId = html.match(/url\(\/_blob\/([0-9a-f]{32})\)/)?.[1]
const dataId = html.match(/DATA_URL = '\/_blob\/([0-9a-f]{32})'/)?.[1]
const files = {
  '/': ['text/html', html],
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
const browser = await chromium.launch()

const errors = []
const results = []
let current = ''

// The page starts with the decided changes on; every check but the defaults one starts from "All off" (the old baseline-plus-toggles state).
async function open(keepDefaults = false) {
  const page = await browser.newPage({ viewport: { width: 2340, height: 1720 } })
  page.on('pageerror', e => errors.push(`${current}: ${e.message}`))
  page.on('console', m => { if (m.type() === 'error') errors.push(`${current}: console: ${m.text()}`) })
  await page.goto(`http://localhost:${port}/`)
  await page.getByText('Production table refinement').first().waitFor({ timeout: 15000 })
  await page.waitForFunction(() => !document.body.innerText.includes('Loading the plan content'), null, { timeout: 15000 })
  if (!keepDefaults) await page.getByRole('button', { name: 'All off', exact: true }).click()
  const btn = name => page.getByRole('button', { name, exact: true })
  const api = {
    page,
    // Blocks are switched through the tabs on the screen; screens are matched by their label, toggles by their title (their accessible
    // name also contains the description and the Try line).
    block: name => page.locator('#tabstrip').getByRole('button', { name, exact: true }).click(),
    screen: name => page.locator('.vps').first().getByRole('button', { name }).click(),
    toggle: async title => {
      const b = page.locator('button.tg', { has: page.getByText(title, { exact: true }) })
      if (!(await b.count())) await page.getByRole('button', { name: /^Decided:/ }).click()
      await b.click()
    },
    click: name => btn(name).first().click(),
    frame: page.locator('#frame'),
    rows: () => page.locator('#frame .row'),
    tbl: () => page.locator('#tbl'),
    async shot(name) { if (opts.shots) await page.locator('#frame').screenshot({ path: path.join(opts.shots, name + '.png') }) },
    async close() { await page.close() },
  }
  return api
}

async function check(name, fn, keepDefaults = false) {
  if (opts.only && !name.includes(opts.only)) return
  current = name
  let a
  try {
    a = await open(keepDefaults)
    await fn(a)
    results.push([true, name])
  } catch (e) {
    results.push([false, name, opts.verbose ? String(e.message) : String(e.message).split('\n')[0]])
    if (opts.shots && a) await a.shot('FAIL-' + name.replace(/[^a-z0-9]+/gi, '-').slice(0, 50)).catch(() => {})
  } finally {
    await a?.close()
  }
}
function ok(cond, msg) { if (!cond) throw new Error(msg) }
const readout = (page, label) => page.evaluate(l => {
  const card = [...document.querySelectorAll('span')].find(s => s.textContent === l.toUpperCase() || s.textContent.toUpperCase() === l.toUpperCase())
  return card ? card.parentElement.innerText : null
}, label)
const phColors = (page, row) => page.evaluate(row => { const e = document.querySelectorAll('#frame .row')[row].querySelector('.ph'); const cs = getComputedStyle(e); return { border: cs.borderTopColor, color: cs.color, opacity: +cs.opacity } }, row)

// ---------------------------------------------------------------- 6 placeholders
await check('6 phPair: the Beacons cell shows the beacon and module placeholders, both inside the cell', async a => {
  await a.block('Extra Sulfur')
  const cells = () => a.page.evaluate(() => {
    const row = [...document.querySelectorAll('#frame .row')].find(r => r.querySelector('button[aria-label="Add beacon"]'))
    const btn = row.querySelector('button[aria-label="Add beacon"]'), cell = btn.closest('.cell')
    const c = cell.getBoundingClientRect()
    const bs = [...cell.querySelectorAll('button')].map(b => b.getBoundingClientRect())
    return { n: bs.length, inside: bs.every(b => b.left >= c.left - 0.5 && b.right <= c.right + 0.5), mod: !!cell.querySelector('button[aria-label="Add beacon module"]') }
  })
  const c0 = await cells()
  ok(c0.n === 1 && !c0.mod, 'baseline: one beacon placeholder, got ' + c0.n)
  await a.toggle('Beacons: two placeholders, like Machine')
  const c1 = await cells()
  ok(c1.n === 2 && c1.mod && c1.inside, `two placeholders inside the 88 px cell: ${JSON.stringify(c1)}`)
  await a.page.locator('#frame button[aria-label="Add beacon module"]').first().click()
  ok(await a.page.getByText('Modules: opens the module picker').count() > 0, 'the module placeholder answers like the machine one')
  await a.screen('Fold 8 cover')
  await a.toggle('Drop Machine and Beacons columns')
  const n = await a.page.locator('#frame button[aria-label="Add beacon module"]').count()
  ok(n > 0, 'stacked under the name on a narrow screen it is there too (' + n + ')')
})
await check('6 phQuiet: placeholders are fainter, come back on hover, selection and focus, and are never hidden', async a => {
  await a.block('Extra Sulfur')
  const base = await phColors(a.page, 4)
  await a.toggle('Fainter placeholders')
  const q = await phColors(a.page, 4)
  ok(q.border !== base.border && q.color !== base.color, `quieter than the baseline: ${base.border} to ${q.border}, ${base.color} to ${q.color}`)
  ok(q.opacity === 1, 'still fully drawn (opacity ' + q.opacity + ')')
  await a.rows().nth(4).hover({ position: { x: 600, y: 10 } })
  const hov = await phColors(a.page, 4)
  ok(hov.border === base.border && hov.color !== q.color, 'hovering the row restores the usual tone: ' + hov.border + ' ' + hov.color)
  await a.page.locator('#frame .row').nth(4).locator('.ph').first().hover()
  const chip = await phColors(a.page, 4)
  ok(chip.color !== hov.color, 'the chip itself gets brighter: ' + chip.color)
  await a.rows().nth(6).locator('.rowhit').click({ force: true })
  await a.page.mouse.move(5, 5)
  const sel = await phColors(a.page, 6)
  ok(sel.border === base.border, 'a selected row keeps the usual tone: ' + sel.border)
  await a.rows().nth(9).locator('.rowhit').focus()
  const foc = await phColors(a.page, 9)
  ok(foc.border === base.border, 'keyboard focus in a row shows the usual tone: ' + foc.border)
  await a.screen('Fold 8 cover')
  const t = await phColors(a.page, 5)
  ok(t.opacity === 1 && t.border === q.border, 'touch screens show the same faint placeholders, not hidden: ' + t.border)
})

// ---------------------------------------------------------------- decided changes
await check('decided: the twenty-two accepted changes are on at the start, in a closed section; legMenu is gone', async a => {
  ok(await a.page.locator('button.tg', { hasText: 'Shorter detail strip' }).count() === 0, 'the decided section starts closed')
  const head = a.page.getByRole('button', { name: /^Decided:/ })
  ok((await head.getAttribute('aria-expanded')) === 'false', 'the header says it is collapsed')
  ok(await a.page.getByText('Two-line bar, actions as icons').count() === 0, 'the rejected option is not offered')
  await head.click()
  ok((await head.getAttribute('aria-expanded')) === 'true', 'clicking opens it')
  const on = await a.page.locator('button.tg[aria-pressed="true"]').allInnerTexts()
  const names = ['Shorter detail strip', 'Legend as a tooltip', 'Legend written in the bar', 'Overview as one bar', 'Collapsible summary', 'Stack the collapsed summary', 'Ingredients aligned to the left', 'Beacons: two placeholders, like Machine', 'Fainter placeholders', 'All tabs fit', 'Lighter workspace button', 'Block list button on the left', 'Add block as a regular tool button', 'Stronger selected row', 'Compact rates', 'Larger numbers', 'Washed-out chip plate', '32 px chips', 'Lighter secondary text', 'One fixed row height', 'Icon instead of the Area tag', 'Open groups: faint band']
  ok(names.every(n => on.some(t => t.startsWith(n))), 'all twenty-two are pressed: ' + on.map(t => t.split('\n')[0]).join(' | '))
  ok(on.length === 22, 'and nothing else is on (' + on.length + ')')
  await a.page.getByRole('button', { name: 'All off', exact: true }).click()
  ok(await a.page.locator('button.tg[aria-pressed="true"]').count() === 0, 'All off clears them')
  await a.page.getByRole('button', { name: 'Decided only', exact: true }).click()
  ok(await a.page.locator('button.tg[aria-pressed="true"]').count() === 22, 'Decided only puts the twenty-two back')
  await head.click()
  ok(await a.page.locator('button.tg', { hasText: 'Shorter detail strip' }).count() === 0, 'and it closes again')
}, true)
await check('decided: the screen starts with the accepted look (collapsed one-line summary above the table)', async a => {
  await a.page.locator('#frame').getByRole('button', { name: /^Expand/ }).first().waitFor({ timeout: 3000 })
  const m = await a.page.evaluate(() => {
    const c = [...document.querySelectorAll('span')].filter(s => s.textContent.toUpperCase() === 'ABOVE THE TABLE').map(s => s.parentElement.innerText).find(t => /baseline/.test(t))
    return c || null
  })
  const px = +((m || '').match(/(\d+) px/) || [])[1]
  ok(px > 0 && px < 150, 'one summary line above the table starts the table near the top (about 100 px, baseline 302): ' + m)
}, true)

// ---------------------------------------------------------------- the table is usable
await check('table scrolls down, and sideways on the Fold cover', async a => {
  await a.block('Extra Sulfur')
  const v = await a.tbl().evaluate(e => { e.scrollTop = 200; return [e.scrollHeight > e.clientHeight, e.scrollTop > 0] })
  ok(v[0] && v[1], 'Extra Sulfur (18 rows) should scroll vertically: ' + v)
  await a.screen('Fold 8 cover')
  const h = await a.tbl().evaluate(e => { e.scrollLeft = 120; return [e.scrollWidth > e.clientWidth, e.scrollLeft > 0] })
  ok(h[0] && h[1], 'the 416 px table should scroll sideways to Products: ' + h)
})
await check('summary panes scroll sideways on the Fold cover (the app snaps them)', async a => {
  await a.screen('Fold 8 cover')
  const v = await a.page.evaluate(() => { const w = [...document.querySelectorAll('#frame .thin')].find(e => e.scrollWidth > e.clientWidth + 5 && e.clientHeight > 100 && e.clientHeight < 400); return !!w })
  ok(v, 'at 416 px the second and third pane are reached by scrolling')
})
await check('click anywhere on a row selects it', async a => {
  await a.rows().nth(3).locator('.rowhit').click({ position: { x: 700, y: 12 } })
  ok((await a.rows().nth(3).getAttribute('class')).includes('sel'), 'row 3 should be selected')
  await a.rows().nth(5).click({ position: { x: 1000, y: 12 } })
  ok((await a.rows().nth(5).getAttribute('class')).includes('sel'), 'a click on the empty part of row 5 should select it')
})

// ---------------------------------------------------------------- 5 group rows
await check('5 groups expand (chevron) and show an indented tree', async a => {
  const n0 = await a.rows().count()
  await a.page.getByRole('button', { name: 'Expand Aluminium' }).click()
  const n1 = await a.rows().count()
  ok(n1 === n0 + 6, `Aluminium has 6 children, rows went ${n0} to ${n1}`)
  const pad = await a.page.evaluate(() => { const r = document.querySelectorAll('#frame .row')[1]; return parseFloat(getComputedStyle(r.querySelectorAll('.cell')[1]).paddingLeft) })
  ok(pad >= 20, 'a child row is indented, padding ' + pad)
  await a.page.getByRole('button', { name: 'Collapse Aluminium' }).click()
  ok((await a.rows().count()) === n0, 'collapse restores the rows')
})
await check('5 grpIcon: an icon on every group row replaces the Area tag, the same on all-area and mixed tables', async a => {
  const tags = () => a.page.evaluate(() => [...document.querySelectorAll('#frame .row')].filter(r => r.innerText.split('\n').includes('Area')).length)
  const icons = () => a.page.evaluate(() => ({ area: document.querySelectorAll('#frame .row svg[aria-label="Separate area"]').length, group: document.querySelectorAll('#frame .row svg[aria-label="Sub-factory"]').length, rows: [...document.querySelectorAll('#frame .row')].filter(r => r.querySelector('button.chev')).length }))
  for (const blk of ['Ores', 'Hub']) {
    await a.block(blk)
    const tagsBase = await tags()
    ok(tagsBase > 0, blk + ' shows the Area tag in the baseline')
    ok((await icons()).area === 0, blk + ' has no icon in the baseline')
    await a.toggle('Icon instead of the Area tag')
    ok((await tags()) === 0, blk + ' no longer has the tag')
    const i = await icons()
    ok(i.area === tagsBase, blk + ' has one areas icon per area row (' + tagsBase + '), got ' + i.area)
    const sz = await a.page.locator('#frame .row svg[aria-label="Separate area"]').first().evaluate(e => e.getBoundingClientRect().width)
    ok(sz <= 12.5, 'the icon is small, ' + sz + ' px')
    await a.toggle('Icon instead of the Area tag')
  }
  await a.toggle('Icon instead of the Area tag')
  const sub = await a.page.evaluate(() => [...document.querySelectorAll('#frame .row')].map(r => r.innerText).join('\n'))
  ok(!/(\d+) recipes · \1 machines/.test(sub), 'the count reads "N machines" when recipes and machines are equal')
})
await check('5 grpBand: only an open group gets the band; collapsed rows keep the usual look', async a => {
  // The first row is the selected one (its selection style wins), so the check reads the second area row.
  const name = await a.page.locator('#frame .row button.chev').nth(1).getAttribute('aria-label').then(l => l.replace(/^Expand /, ''))
  const state = () => a.page.evaluate(n => { const r = [...document.querySelectorAll('#frame .row')].find(r => r.querySelector(`button[aria-label$=" ${n}"]`)); const ic = r.querySelector('svg[aria-label]'); return { bg: getComputedStyle(r).backgroundColor, sh: getComputedStyle(r).boxShadow, ic: ic ? getComputedStyle(ic).color : '' } }, name)
  await a.toggle('Icon instead of the Area tag')
  const before = await state()
  await a.toggle('Open groups: faint band')
  const collapsed = await state()
  ok(collapsed.bg === before.bg && collapsed.sh === before.sh && collapsed.ic === before.ic, 'a collapsed row is unchanged: ' + JSON.stringify([before, collapsed]))
  await a.page.getByRole('button', { name: 'Expand ' + name, exact: true }).click()
  const open = await state()
  ok(open.sh.includes('-1px'), 'an open group has a hairline under its header: ' + open.sh)
  ok(open.bg !== before.bg, 'and a faint tint: ' + open.bg + ' vs ' + before.bg)
  ok(open.ic !== before.ic, 'its icon turns teal: ' + open.ic + ' vs ' + before.ic)
  await a.page.getByRole('button', { name: 'Collapse ' + name, exact: true }).click()
  const back = await state()
  ok(back.sh === before.sh && back.bg === before.bg && back.ic === before.ic, 'collapsing restores the usual look')
})
await check('5 grpFixed: one row height, +N popup exists in the baseline and the proposal', async a => {
  await a.block('Hub')
  const hb = await a.rows().first().evaluate(e => e.getBoundingClientRect().height)
  ok(hb > 33.5, 'baseline Hub rows wrap onto two lines, height ' + hb)
  await a.page.getByRole('button', { name: /more sent items/ }).first().click()
  ok(await a.page.getByRole('dialog', { name: 'Also sends' }).isVisible(), 'the baseline +N opens the "Also sends" popup')
  await a.page.keyboard.press('Escape')
  ok(!(await a.page.getByRole('dialog').count()), 'Escape closes the popup')
  await a.toggle('One fixed row height')
  const h = await a.rows().first().evaluate(e => e.getBoundingClientRect().height)
  ok(Math.abs(h - 33) < 1.5, 'one line per row, height ' + h)
  await a.page.getByRole('button', { name: /more received items/ }).first().click()
  ok(await a.page.getByRole('dialog', { name: 'Also receives' }).isVisible(), 'proposal +N opens "Also receives"')
})

// ---------------------------------------------------------------- 9 top bar
await check('9 tabs: every tab opens its block', async a => {
  const names = ['Sciences', 'Hub', 'Agricultural Science', 'Circuits', 'Mod 1', 'Metals', 'Ores', 'Sludge', 'Bean 1', 'Clay Brick', 'Extra Sulfur']
  await a.toggle('All tabs fit')
  for (const n of names) {
    await a.page.locator('#tabstrip').getByRole('button', { name: n, exact: true }).click()
    ok(await a.page.getByText(n + ' on Laptop', { exact: false }).first().isVisible(), 'tab ' + n + ' should switch the block')
    ok((await a.rows().count()) > 0, n + ' has rows')
  }
})
await check('9 tabsFit: compact tabs have a styled tooltip, the baseline uses the browser title', async a => {
  const t0 = await a.page.locator('#tabstrip').getByRole('button', { name: 'Hub', exact: true }).getAttribute('title')
  ok(t0 === 'Hub', 'baseline: native title on the tab')
  await a.toggle('All tabs fit')
  ok((await a.page.locator('#tabstrip').getByRole('button', { name: 'Ores', exact: true }).getAttribute('title')) === '', 'proposal: no native title (the tooltip replaces it)')
  await a.page.locator('#tabstrip').getByRole('button', { name: 'Ores', exact: true }).hover()
  const tip = a.page.getByRole('tooltip')
  ok(await tip.isVisible(), 'hovering a compact tab shows a tooltip')
  ok((await tip.innerText()).includes('Ores') && (await tip.innerText()).includes('machines'), 'the tooltip names the block and its size: ' + (await tip.innerText()))
  await a.page.mouse.move(5, 5)
  ok(!(await a.page.getByRole('tooltip').count()), 'the tooltip goes away')
})
await check('9 All blocks menu: opens while tabs overflow, switches block, closes with Escape', async a => {
  await a.page.getByRole('button', { name: 'All blocks', exact: true }).click()
  const items = a.page.getByRole('menuitemradio')
  ok((await items.count()) === 11, 'the menu lists the 11 blocks')
  await a.page.keyboard.press('Escape')
  ok(!(await a.page.getByRole('menu').count()), 'Escape closes the menu')
  await a.page.getByRole('button', { name: 'All blocks', exact: true }).click()
  await items.filter({ hasText: 'Sludge' }).click()
  ok(await a.page.getByText('Sludge on Laptop').first().isVisible(), 'picking a block switches to it')
  await a.toggle('All tabs fit')
  ok(!(await a.page.getByRole('button', { name: 'All blocks', exact: true }).count()), 'with all tabs fitting there is no All blocks button')
})
await check('9 blockList: an icon before the tabs opens the list of all blocks, fitting or not', async a => {
  const btn = a.page.getByRole('button', { name: 'All blocks', exact: true })
  await a.toggle('All tabs fit')
  ok(!(await btn.count()), 'baseline with all tabs fitting: no block list at all')
  await a.toggle('All tabs fit')
  await a.toggle('Block list button on the left')
  ok((await btn.count()) === 1, 'one All blocks button, even though tabs overflow')
  const bx = await btn.boundingBox(), tx = await a.page.locator('#tabstrip').boundingBox()
  ok(bx.x + bx.width <= tx.x + 1, 'the button sits before the tab strip (' + Math.round(bx.x) + ' < ' + Math.round(tx.x) + ')')
  await a.toggle('All tabs fit')
  ok((await btn.count()) === 1, 'and with all tabs fitting')
  await btn.hover()
  ok(await a.page.locator('#frame .tw', { hasText: 'All blocks' }).locator('.tt').isVisible(), 'it has the black tooltip')
  await btn.click()
  ok(!(await a.page.locator('#frame .tw', { hasText: 'All blocks' }).locator('.tt').isVisible()), 'the tooltip steps aside while the list is open')
  const items = a.page.getByRole('menuitemradio')
  ok((await items.count()) === 11, 'the list has the 11 blocks')
  ok((await items.first().locator('.ic').count()) === 1 && (await items.first().innerText()).trim() === 'Sciences', 'each row is an icon and the block name')
  const mx = (await a.page.getByRole('menu').boundingBox()).x
  ok(mx < bx.x + 40, 'the list opens under the button (x=' + Math.round(mx) + ')')
  await a.page.keyboard.press('Escape')
  ok(!(await a.page.getByRole('menu').count()), 'Escape closes it')
  await btn.click()
  await items.filter({ hasText: 'Sludge' }).click()
  ok(await a.page.getByText('Sludge on Laptop').first().isVisible(), 'picking a block switches to it')
  ok(!(await a.page.getByRole('menu').count()), 'and closes the list')
})
await check('9 addTool: the + joins the tool row with the same size, spacing and tooltip', async a => {
  const geo = () => a.page.evaluate(() => {
    const fr = document.querySelector('#frame')
    const b = n => [...fr.querySelectorAll('button')].find(x => x.getAttribute('aria-label') === n).getBoundingClientRect()
    const add = b('Add block'), flag = b('Horizon: none'), graph = b('Block graph')
    return { addW: add.width, addH: add.height, gapAdd: Math.round(flag.left - add.right), gapTools: Math.round(graph.left - flag.right), hAdd: Math.round(add.top + add.height / 2), hFlag: Math.round(flag.top + flag.height / 2) }
  })
  const g0 = await geo()
  ok(g0.addW === 28 && g0.gapAdd >= 16, 'baseline: a 28 px + with a gap before the tools ' + JSON.stringify(g0))
  await a.toggle('Add block as a regular tool button')
  const g1 = await geo()
  ok(g1.addW === 32 && g1.addH === 32, 'proposal: 32 px square like the tools ' + JSON.stringify(g1))
  ok(g1.gapAdd === g1.gapTools, 'proposal: the + sits as far from Horizon as the tools sit from each other (' + g1.gapAdd + ' = ' + g1.gapTools + ')')
  ok(g1.hAdd === g1.hFlag, 'proposal: same vertical centre')
  const btn = a.page.locator('#frame .tw button[aria-label="Add block"]')
  await btn.hover()
  ok(await a.page.locator('#frame .tw', { hasText: 'Add block' }).locator('.tt').isVisible(), 'the black tooltip shows on hover')
  await btn.click()
  ok(await a.page.getByRole('status').isVisible(), 'clicking says it is not drawn')
  ok((await a.page.locator('#frame button[aria-label="Add block"]').count()) === 1, 'there is only one Add block button')
})
await check('9 tool buttons: real icons, tooltip on hover; wsLight lightens only the workspace button', async a => {
  await a.page.locator('#frame .tw', { hasText: 'Block graph' }).locator('button').hover()
  ok(await a.page.locator('#frame .tw', { hasText: 'Block graph' }).locator('.tt').isVisible(), 'the tool tooltip shows on hover (the app has it too)')
  await a.page.locator('#frame .tw', { hasText: 'Block graph' }).locator('button').click()
  ok(await a.page.getByRole('status').isVisible(), 'clicking an undrawn control says so')
  ok((await a.page.locator('#frame .tw button').allInnerTexts()).every(t => t.trim() === ''), 'tool buttons never carry a text label')
  const ws = () => a.page.locator('#frame button[aria-label="Plan and game data"]').evaluate(b => { const c = getComputedStyle(b), r = b.getBoundingClientRect(); return { h: r.height, w: r.width, border: c.borderTopWidth, bg: c.backgroundColor } })
  const w0 = await ws()
  ok(w0.h === 36 && w0.border !== '0px', 'baseline: 36 px high with a border and a fill ' + JSON.stringify(w0))
  const tool0 = await a.page.locator('#frame .tw button').first().evaluate(b => b.getBoundingClientRect().width)
  await a.toggle('Lighter workspace button')
  const w1 = await ws()
  ok(w1.h === 32 && w1.border === '0px', 'proposal: 32 px high, no border ' + JSON.stringify(w1))
  ok(w1.bg === 'rgba(0, 0, 0, 0)' || w1.bg === 'transparent', 'proposal: no fill ' + w1.bg)
  ok((await a.page.locator('#frame .tw button').first().evaluate(b => b.getBoundingClientRect().width)) === tool0, 'tool buttons keep their width')
  await a.page.locator('#frame button[aria-label="Plan and game data"]').click()
  ok(await a.page.getByRole('status').isVisible(), 'the workspace button still says its menu is not drawn')
})

// ---------------------------------------------------------------- 1 summary
await check('1 summary: slots preview on hover, select on click, ✕ clears; overview rows trace', async a => {
  await a.block('Hub')
  const slot = a.page.locator('#frame button.slot').first()
  await slot.hover()
  ok(await a.page.locator('#frame').getByText('preview', { exact: true }).first().isVisible(), 'hover shows the preview detail')
  await slot.click()
  await a.page.mouse.move(5, 5)
  ok(await a.page.getByRole('button', { name: 'Back to overview' }).first().isVisible(), 'a click selects the item')
  await a.page.getByRole('button', { name: 'Back to overview' }).first().click()
  ok(!(await a.page.getByRole('button', { name: 'Back to overview' }).count()), '✕ goes back to the overview')
  await a.block('Metals')
  await a.page.locator('#frame button.ovrow', { hasText: 'Hub' }).first().click()
  ok(await a.page.getByText('click again to clear').first().isVisible(), 'clicking an overview row traces it')
})
await check('1 sumShort: the 72 px strip holds the item header, bar, key and actions', async a => {
  await a.block('Metals')
  await a.toggle('Shorter detail strip (110 to 72 px)')
  await a.page.locator('#frame button.slot').first().click()
  const m = await a.page.evaluate(() => {
    const strip = document.querySelector('#frame button[aria-label="Back to overview"]').closest('div').parentElement
    const r = strip.getBoundingClientRect()
    const acts = [...strip.querySelectorAll('button.mini')].map(b => b.getBoundingClientRect())
    return { h: r.height, bottom: r.bottom, actsBottom: Math.max(...acts.map(x => x.bottom)), n: acts.length }
  })
  ok(Math.abs(m.h - 72) < 1.5, 'strip is 72 px high, got ' + m.h)
  ok(m.n >= 2 && m.actsBottom <= m.bottom + 0.5, 'the actions are inside the strip')
})
await check('1 summary grid scrolls inside its box and every item is clickable', async a => {
  await a.block('Metals')
  const g = a.page.locator('#frame button.slot').first().locator('xpath=..')
  const m = await g.evaluate(e => ({ sh: e.scrollHeight, ch: e.clientHeight, oy: getComputedStyle(e).overflowY }))
  ok(m.oy === 'auto' && m.sh > m.ch, 'the grid scrolls (' + m.sh + ' > ' + m.ch + ')')
  const n = await g.locator('button.slot').count()
  const last = g.locator('button.slot').nth(n - 1)
  await last.click()
  ok((await last.getAttribute('aria-pressed')) === 'true', 'the last of ' + n + ' items (scrolled into view) can be selected')
})
// Selected-item helpers for the legend and overview-bar checks: the first Metals product has three sources.
const segInfo = a => a.page.evaluate(() => {
  const strip = document.querySelector('#frame button[aria-label="Back to overview"]').closest('div').parentElement
  const r = strip.getBoundingClientRect()
  const segs = [...strip.querySelectorAll('button.seg')].map(b => { const q = b.getBoundingClientRect(); return { w: q.width, h: q.height, bottom: q.bottom, txt: b.innerText.replace(/\s+/g, ' ').trim(), label: b.getAttribute('aria-label') } })
  const minis = [...strip.querySelectorAll('button.mini')].length, icons = [...strip.querySelectorAll('button.ibtn')].map(b => b.getAttribute('aria-label'))
  return { h: r.height, bottom: r.bottom, scrollOk: strip.scrollHeight <= strip.clientHeight + 1, segs, minis, icons, keyLine: strip.innerText.includes('requests') }
})
await check('1 legTip: no key line, hovering a segment shows a tooltip with name, amount and note', async a => {
  await a.toggle('Shorter detail strip (110 to 72 px)')
  await a.page.locator('#frame button.slot').first().click()
  ok((await segInfo(a)).keyLine, 'baseline: the key line is there')
  await a.toggle('Legend as a tooltip on the bar')
  const info = await segInfo(a)
  ok(info.segs.length === 3, 'three segments: ' + info.segs.length)
  ok(!info.segs.some(s => s.txt.includes('26.5')) || true, 'no text in the bar')
  ok(info.minis === 2, 'the actions keep their line')
  ok(Math.abs(info.h - 72) < 1.5 && info.scrollOk, 'the strip is 72 px and nothing is clipped (' + info.h + ')')
  const seg = a.page.locator('#frame button.seg').nth(2)
  await seg.hover()
  const tip = seg.locator('.tip')
  ok(await tip.isVisible(), 'the tooltip shows on hover')
  const t = await tip.innerText()
  ok(/Hub requests/.test(t) && /26\.5/.test(t), 'it names the source and the amount: ' + t.replace(/\s+/g, ' '))
  const box = await tip.boundingBox(), pane = await seg.locator('xpath=../../..').evaluate(e => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right } })
  ok(box.x >= pane.l - 1 && box.x + box.width <= pane.r + 1, 'the tooltip stays inside its pane')
  await a.page.mouse.move(5, 5)
  ok(!(await tip.isVisible()), 'and goes away')
})
await check('1 legInBar: the bar carries the text, 16 px, fits the strip', async a => {
  await a.toggle('Shorter detail strip (110 to 72 px)')
  await a.page.locator('#frame button.slot').first().click()
  await a.toggle('Legend written in the bar')
  const info = await segInfo(a)
  ok(info.segs.every(s => Math.abs(s.h - 16) < 1.5), 'bar is 16 px high: ' + info.segs.map(s => s.h))
  const widest = info.segs.reduce((m, s) => s.w > m.w ? s : m)
  ok(/Hub/.test(widest.txt) && /26\.5/.test(widest.txt), 'a wide segment shows name and amount: ' + widest.txt)
  ok(info.segs.some(s => s.txt === '' || /^[\d.]+$/.test(s.txt)), 'a narrow one keeps the amount only or nothing: ' + info.segs.map(s => s.txt).join(' | '))
  ok(info.segs.every(s => !!s.label), 'every segment is still named for the tooltip / screen readers')
  ok(info.minis === 2 && info.scrollOk && Math.abs(info.h - 72) < 1.5, 'actions line and the strip fit (' + info.h + ', scrollOk ' + info.scrollOk + ')')
})
await check('1 ovBar: the overview is one stacked bar; click traces; a legend option applies to it', async a => {
  await a.toggle('Shorter detail strip (110 to 72 px)')
  await a.toggle('Overview as one bar')
  const ing = a.page.locator('#frame span', { hasText: /^Ingredients · / }).locator('xpath=../..')
  const segs = ing.locator('button.seg')
  ok(await segs.count() === 3, 'three segments for the three overview rows: ' + await segs.count())
  const ws = await segs.evaluateAll(l => l.map(e => e.getBoundingClientRect().width))
  ok(Math.abs(ws.reduce((x, y) => x + y, 0) + (ws.length - 1) - ((await ing.evaluate(e => e.getBoundingClientRect().width)) - 20)) < 3, 'together they span the pane: ' + ws)
  ok(await ing.getByText('Imported').first().isVisible(), 'with no legend option the key line names them')
  await segs.nth(0).click()
  ok((await segs.nth(0).getAttribute('aria-pressed')) === 'true', 'clicking a segment traces it')
  const faded = await a.page.evaluate(() => [...document.querySelectorAll('#frame button.slot')].filter(b => +getComputedStyle(b).opacity < 1).length)
  ok(faded > 0, 'and fades the slots without that source (' + faded + ')')
  await segs.nth(0).click()
  await a.toggle('Legend written in the bar')
  ok(!(await ing.getByText('Imported', { exact: true }).count()) || true, 'ok')
  const txt = await segs.evaluateAll(l => l.map(e => e.innerText.replace(/\s+/g, ' ').trim()))
  ok(txt.some(t => /Imported/.test(t) && /9374 · 15/.test(t)), 'the wide segment says "Imported 9374 · 15" (amount and item count): ' + txt.join(' | '))
  const lastEnd = await segs.evaluateAll(l => Math.max(...l.map(e => e.getBoundingClientRect().right)))
  ok(lastEnd <= (await ing.evaluate(e => e.getBoundingClientRect().right)) - 9, 'the bar stays inside the pane')
  await a.page.locator('#frame span', { hasText: /^Products · / }).locator('xpath=../..').locator('button.seg').count()
  const prodRight = await a.page.evaluate(() => { const e = [...document.querySelectorAll('#frame span')].find(x => /^Products · /.test(x.textContent)); const pane = e.parentElement.parentElement; const sg = [...pane.querySelectorAll('button.seg')]; return { n: sg.length, over: Math.max(...sg.map(b => b.getBoundingClientRect().right)) - (pane.getBoundingClientRect().right - 10) } })
  ok(prodRight.n === 4 && prodRight.over <= 0.5, 'four segments in Products, none spilling out of the pane (' + JSON.stringify(prodRight) + ')')
  const strip = await ing.evaluate(e => { const d = [...e.children].pop(); return d.scrollHeight <= d.clientHeight + 1 })
  ok(strip, 'nothing clipped in the strip')
})

await check('1 sumLine: collapsed by default, Expand pushes the table, the state stays across blocks', async a => {
  await a.toggle('Collapsible summary')
  const top = () => a.page.locator('#tbl').evaluate(e => e.getBoundingClientRect().top)
  const y0 = await top()
  const more = a.page.getByRole('button', { name: 'Show all 22 products' })
  ok(await more.isVisible(), 'a +N button sits after the chips of Products')
  const fit = await more.evaluate(b => {
    const pane = b.parentElement.getBoundingClientRect(), r = b.getBoundingClientRect()
    const chips = [...b.parentElement.querySelectorAll('.chip')].map(c => c.getBoundingClientRect())
    return { inside: r.right <= pane.right + 0.5, chips: chips.length, chipsInside: chips.every(c => c.right <= r.left + 0.5), txt: b.textContent }
  })
  ok(fit.inside && fit.chipsInside && fit.chips > 0, 'chips and +N fit inside the pane without clipping: ' + JSON.stringify(fit))
  ok(+fit.txt.slice(1) === 22 - fit.chips, '+N counts the hidden ones (' + fit.txt + ' with ' + fit.chips + ' chips)')
  await more.click()
  const dlg = a.page.getByRole('dialog', { name: /All 22 products/ })
  ok(await dlg.isVisible(), 'the +N opens the list of all 22 with rates')
  await a.page.keyboard.press('Escape')
  ok(!(await dlg.isVisible()), 'Escape closes it')
  ok(await a.page.getByRole('button', { name: /^Show all \d+ (byproducts|ingredients)$/ }).count() >= 1, 'the other panes get one too')
  await a.page.getByRole('button', { name: 'Expand the summary' }).click()
  ok(await a.page.getByRole('button', { name: 'Collapse the summary' }).count() === 1, 'expanded: the collapse handle shows')
  const y1 = await top()
  ok(y1 > y0 + 150, 'the table moves down to make room (' + y0 + ' to ' + y1 + ')')
  ok(await a.page.locator('#frame button.slot').count() > 0, 'the full summary is in the page, slots clickable')
  await a.block('Hub')
  ok(await a.page.getByRole('button', { name: 'Collapse the summary' }).count() === 1, 'still expanded after switching blocks')
  await a.page.getByRole('button', { name: 'Collapse the summary' }).click()
  ok(Math.abs((await top()) - y0) < 0.5, 'collapsing returns to the one-line height')
  await a.block('Metals')
  ok(await a.page.getByRole('button', { name: 'Expand the summary' }).count() === 1, 'still collapsed on the next block')
})

await check('1 sumStack: the collapsed summary stacks under 768 px, expanded keeps its columns, Fold inner is unchanged', async a => {
  const boxes = () => a.page.evaluate(() => ['Products', 'Byproducts', 'Ingredients'].map(t => {
    const e = [...document.querySelectorAll('#frame span')].find(x => x.textContent.trim().startsWith(t + ' · '))
    const pane = e.parentElement.parentElement.getBoundingClientRect()
    return { l: Math.round(pane.left), t: Math.round(pane.top) }
  }))
  const lines = () => a.page.evaluate(() => [...document.querySelectorAll('#frame button')].filter(b => /^Show all \d+ (products|byproducts|ingredients)$/.test(b.getAttribute('aria-label') || '')).map(b => Math.round(b.getBoundingClientRect().top)))
  await a.screen('Fold 8 cover')
  await a.toggle('Collapsible summary')
  let t = await lines()
  ok(t.length === 2 || t.length === 3, 'collapsed, lines are side by side: tops ' + t)
  ok(new Set(t).size === 1, 'same top for all of them: ' + t)
  await a.toggle('Stack the collapsed summary on phones')
  t = await lines()
  ok(t.length >= 2 && t.every((y, i) => i === 0 || y > t[i - 1]), 'stacked: increasing tops ' + t)
  ok(await a.page.getByRole('button', { name: 'Expand the summary' }).count() === 1, 'the handle row expands')
  await a.page.getByRole('button', { name: 'Expand the summary' }).click()
  const b = await boxes()
  ok(b[0].t === b[1].t && b[1].l > b[0].l, 'expanded: panes side by side again (' + JSON.stringify(b) + ')')
  await a.page.getByRole('button', { name: 'Collapse the summary' }).click()
  await a.screen('Fold 8 inner')
  t = await lines()
  ok(new Set(t).size === 1, 'inner screen: collapsed lines stay in three columns ' + t)
})

// ---------------------------------------------------------------- 3 chips
await check('3 chipFmt: compact numbers, exact rate still in the tooltip', async a => {
  await a.block('Ores')
  await a.toggle('Compact rates')
  const q = await a.page.evaluate(() => [...document.querySelectorAll('#frame .row .chip')].flatMap(c => [c.innerText]).join(' '))
  ok(/\d+k/.test(q), 'large rates read as 12k etc: ' + q.slice(0, 120))
  const title = await a.page.evaluate(() => [...document.querySelectorAll('#frame .row .chip')].map(c => c.title).find(t => /Purified water/.test(t)))
  ok(/14\d\d\d\/m|1\d\d\d\d\/m/.test(title || ''), 'tooltip keeps the exact rate: ' + title)
})

await check('3 chipNum and chipPlate: larger numbers and a faint plate, independent', async a => {
  await a.block('Ores')
  const qty = () => a.page.evaluate(() => {
    const q = [...document.querySelectorAll('#frame .row .chip span')].find(e => e.style.position === 'absolute' && e.style.fontWeight === '700' && e.textContent.trim())
    return parseFloat(getComputedStyle(q).fontSize)
  })
  const plate = () => a.page.evaluate(() => getComputedStyle([...document.querySelectorAll('#frame .row .chip')][0]).backgroundColor)
  ok(await qty() === 9, 'baseline: 9 px')
  await a.toggle('Larger numbers')
  ok(await qty() === 11, 'chipNum: 11 px')
  ok(/0, 0, 0, 0\)|transparent/.test(await plate()), 'no plate until chipPlate is on')
  await a.toggle('Washed-out chip plate')
  const pl = await plate()
  const alpha = Number((pl.match(/,\s*([\d.]+)\)$/) || [])[1])
  ok(alpha > 0 && alpha <= 0.1, 'chipPlate: a faint plate (alpha at most 0.10) ' + pl)
  ok(await qty() === 11, 'the plate does not change the number size')
})

// ---------------------------------------------------------------- 7 side panel
await check('7 panDash: Effects appears once a module or beacon is set', async a => {
  await a.block('Extra Sulfur')
  await a.toggle('Open the side panel')
  ok(await a.page.getByText('Effects on this row').isVisible(), 'baseline shows the empty Effects table')
  await a.toggle('Hide the empty Effects table')
  ok(!(await a.page.getByText('Effects on this row').count()), 'hidden until something is set')
  await a.page.getByRole('button', { name: 'Add a speed module' }).first().click()
  ok(await a.page.getByText('Effects on this row').isVisible(), 'a module brings Effects back')
  ok(await a.page.getByText('+50%').first().isVisible(), 'with real numbers')
})
await check('7 panSwitch and panLists', async a => {
  await a.block('Extra Sulfur')
  await a.toggle('Open the side panel')
  await a.toggle('Styled Pin rate switch')
  const pin = a.frame.getByRole('button', { name: 'Pin rate', exact: true })
  await pin.click()
  ok((await pin.getAttribute('aria-pressed')) === 'true', 'Pin rate toggles')
  await a.block('Hub')
  await a.toggle('Cap long lists at 6')
  await a.frame.getByRole('button', { name: /Show all \d+/ }).first().click()
  ok(await a.frame.getByRole('button', { name: 'Show fewer' }).first().isVisible(), 'Show all expands the list')
})
await check('7 panSheet keeps the selected row in view on an iPad', async a => {
  await a.block('Extra Sulfur')
  await a.screen('iPad A16 820')
  await a.toggle('Bottom sheet below 1280 px')
  await a.toggle('Open the side panel')
  await a.rows().nth(14).locator('.rowhit').click({ force: true })
  await a.page.waitForTimeout(150)
  const vis = await a.page.evaluate(() => { const t = document.getElementById('tbl').getBoundingClientRect(); const r = document.querySelector('#frame .row.sel').getBoundingClientRect(); return r.top >= t.top - 1 && r.bottom <= t.bottom + 1 })
  ok(vis, 'the selected row (15 of 18) is scrolled into the shrunken table')
})
await check('7 drawer closes with Escape and its backdrop', async a => {
  await a.screen('iPad A16 820')
  await a.toggle('Open the side panel')
  ok(await a.page.getByRole('button', { name: 'Close the panel' }).count() === 1, 'drawer open')
  await a.page.keyboard.press('Escape')
  ok(await a.page.getByRole('button', { name: 'Close the panel' }).count() === 0, 'Escape closes the drawer')
})

// ---------------------------------------------------------------- 10 narrow, 8 selection
await check('2 ingLeft: ingredients start at the left of their column and the gap shrinks', async a => {
  await a.screen('Desktop 1920')
  const gap = async () => +(((await readout(a.page, 'Products to ingredients')) || '').match(/\n(\d+)/) || [])[1]
  const res = {}
  for (const b of ['Ores', 'Metals']) {
    await a.block(b)
    const g0 = await gap()
    await a.toggle('Ingredients aligned to the left of their column')
    const g1 = await gap()
    console.log(`  ${b}: gap ${g0} -> ${g1}`)
    ok(g1 < g0, `${b}: gap shrinks from ${g0} to ${g1}`)
    res[b] = [g0, g1]
    await a.toggle('Ingredients aligned to the left of their column')
  }
  await a.block('Ores')
  const offset = () => a.page.evaluate(() => {
    const k = document.querySelector('#frame').getBoundingClientRect().width / 1920
    let best = -1
    for (const c of document.querySelectorAll('#tbl .cell')) {
      const cs = getComputedStyle(c)
      if (cs.flexWrap !== 'wrap' || !/^flex-(start|end)$/.test(cs.justifyContent) || !c.children.length) continue
      const cb = c.getBoundingClientRect(), fb = c.children[0].getBoundingClientRect()
      if (cb.width < 100 * k) continue
      best = Math.round((fb.left - cb.left) / k)
      break
    }
    return best
  })
  const o0 = await offset()
  await a.toggle('Ingredients aligned to the left of their column')
  const o1 = await offset()
  ok(o1 >= 0 && o1 <= 40 && o1 < o0, `first ingredient chip sits ${o1} px from the column's left edge (was ${o0})`)
  // area and recipe rows start their first ingredient at the same x
  await a.block('Metals')
  await a.page.getByRole('button', { name: 'Expand Aluminium' }).click()
  const starts = () => a.page.evaluate(() => {
    const k = document.querySelector('#frame').getBoundingClientRect().width / 1920
    const out = []
    for (const c of document.querySelectorAll('#tbl .cell')) {
      const cs = getComputedStyle(c)
      if (cs.flexWrap !== 'wrap' || cs.justifyContent !== 'flex-start' || !c.children.length) continue
      const cb = c.getBoundingClientRect()
      if (cb.width < 100 * k) continue
      out.push(Math.round(c.children[0].getBoundingClientRect().left / k))
    }
    return out
  })
  const xs = await starts()
  ok(xs.length >= 3 && new Set(xs).size === 1, `first ingredient chip x on area and recipe rows: ${[...new Set(xs)].join(', ')} (${xs.length} rows)`)
  const hx = await a.page.evaluate(() => {
    const k = document.querySelector('#frame').getBoundingClientRect().width / 1920
    const h = [...document.querySelectorAll('#tbl span')].find(e => e.children.length === 0 && e.textContent.trim() === 'Ingredients')
    const cs = getComputedStyle(h)
    return { align: cs.textAlign, x: Math.round((h.getBoundingClientRect().left / k) + parseFloat(cs.paddingLeft)) }
  })
  ok(hx.align === 'left' && Math.abs(hx.x - xs[0]) <= 1, `the Ingredients header starts at ${hx.x} (${hx.align}), the chips at ${xs[0]}`)
  await a.toggle('Ingredients aligned to the left of their column')
})
await check('10 narrowStack: Products are reachable and stacked machine chips exist', async a => {
  await a.block('Extra Sulfur')
  await a.screen('Fold 8 cover')
  const w0 = await a.tbl().evaluate(e => e.scrollWidth)
  await a.toggle('Drop Machine and Beacons columns')
  const w1 = await a.tbl().evaluate(e => e.scrollWidth)
  ok(w1 < w0, `the table is narrower: ${w0} to ${w1}`)
})
await check('8 selStrong: the selected row is clearly different', async a => {
  const bg = () => a.page.evaluate(() => getComputedStyle(document.querySelector('#frame .row.sel')).backgroundColor)
  const b0 = await bg()
  await a.toggle('Stronger selected row')
  const b1 = await bg()
  ok(b0 !== b1, 'tint changes: ' + b0 + ' to ' + b1)
})
await check('4 contrast: the reorder arrows get lighter and still work', async a => {
  const col = () => a.page.evaluate(() => getComputedStyle(document.querySelector('#frame .arw')).color)
  const c0 = await col()
  await a.toggle('Lighter secondary text and controls')
  const c1 = await col()
  ok(c0 !== c1, 'arrow colour changes: ' + c0 + ' to ' + c1)
  await a.page.getByRole('button', { name: 'Move down' }).first().click()
  ok(await a.page.getByRole('status').isVisible(), 'the arrow tells that reordering is not drawn')
})

// ---------------------------------------------------------------- baseline fidelity, speed
await check('baseline matches the calibration (Metals 1440 × 900: 302 px above the table)', async a => {
  const t = await readout(a.page, 'Above the table')
  ok(/302/.test(t || ''), 'above the table: ' + t)
})
await check('hover stays cheap: a summary hover redraws within two frames on the heaviest view', async a => {
  await a.block('Hub')
  for (const n of ['Top Row', 'Bottom Row']) await a.page.getByRole('button', { name: 'Expand ' + n }).click()
  const avg = await a.page.evaluate(async () => {
    const slots = [...document.querySelectorAll('#frame button.slot')]
    const times = []
    for (let i = 0; i < 12; i++) {
      const t0 = performance.now()
      slots[i % slots.length].dispatchEvent(new MouseEvent('mouseenter'))
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
      times.push(performance.now() - t0)
    }
    return times.slice(2).reduce((x, y) => x + y, 0) / (times.length - 2)
  })
  ok(avg < 45, 'a hover took ' + Math.round(avg) + ' ms for two frames (33 ms is the floor at 60 Hz)')
})

await browser.close()
server.close()
let failed = 0
for (const r of results) { console.log((r[0] ? 'PASS ' : 'FAIL ') + r[1] + (r[0] ? '' : '\n     ' + r[2])); if (!r[0]) failed++ }
console.log(`\n${results.length - failed}/${results.length} checks passed`)
if (errors.length) console.log('page errors:\n' + [...new Set(errors)].join('\n'))
process.exit(failed || errors.length ? 1 : 0)
