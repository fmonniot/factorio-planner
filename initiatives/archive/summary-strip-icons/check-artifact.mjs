// Turns every claim of artifact/index.html (the design spec) into an assertion.
// Run from the repository root, after `npx playwright install chromium`:
//   node initiatives/archive/summary-strip-icons/check-artifact.mjs [--shots <dir>] [--channel chrome]
// It opens the page as a file, clicks through both replicas at the four pane widths and exits 1 on any failure.
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const here = path.dirname(fileURLToPath(import.meta.url))
const file = 'file://' + path.join(here, 'artifact', 'index.html')
const arg = name => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : null)
const shotsDir = arg('--shots')
const channel = arg('--channel')
let fails = 0
const ok = (cond, msg) => { console.log((cond ? 'ok   ' : 'FAIL ') + msg); if (!cond) fails++ }

;(async () => {
  const browser = await chromium.launch(channel ? { channel } : {})
  const page = await browser.newPage({ viewport: { width: 1200, height: 1400 } })
  const errors = []
  page.on('pageerror', e => errors.push(String(e)))
  page.on('console', m => { if (m.type() === 'error' && !/fonts\.g/.test(m.text())) errors.push(m.text()) })
  await page.goto(file)
  const width = w => page.click(`[data-w="${w}"]`)
  const pv = v => page.click(`#prodTabs [data-v="${v}"]`)
  const iv = v => page.click(`#ingTabs [data-v="${v}"]`)
  const overflow = pane => page.evaluate(p => {
    const row = document.querySelector(`#prodStage [data-row="${p}"]`)
    let last = null
    for (const c of row.children) if (!c.hidden && c.offsetWidth) last = c
    return last.offsetLeft + last.offsetWidth - row.clientWidth
  }, pane)
  const ingH = () => page.evaluate(() => document.querySelector('#ingStage [data-strip="ing"]').offsetHeight)
  const shot = async (name, sel) => { if (shotsDir) await (await page.$(sel)).screenshot({ path: path.join(shotsDir, name + '.png') }) }
  ok((await page.$$eval('#prodTabs .vtab', t => t.length)) === 2 && (await page.$$eval('#ingTabs .vtab', t => t.length)) === 2, 'each section has only Current and Proposed')
  ok(await page.getAttribute('#prodTabs [data-v="b"]', 'aria-pressed') === 'true' && await page.getAttribute('#ingTabs [data-v="d"]', 'aria-pressed') === 'true', 'the page opens on the proposals')

  // --- Products: Current overflows, Proposed does not
  await width(413); await pv('current')
  ok(await overflow('products') > 100, 'Current @413: the actions row runs past the pane edge (' + await overflow('products') + ' px)')
  ok((await page.textContent('#prodRead')).includes('past the edge'), 'the readout says so')
  await shot('prod-current-413', '#products .stagebox')
  await width(260)
  ok(await overflow('products') > 300, 'Current @260 overflows by more (' + await overflow('products') + ' px)')
  await pv('b')
  for (const w of [260, 333, 413, 467]) { await width(w); ok(await overflow('products') <= 0, `Proposed @${w}: no overflow (${await overflow('products')})`) }
  await width(260)
  ok(await page.$$eval('#prodStage [data-strip="products"] .btn.ico[data-tip]', b => b.length >= 4), 'icon buttons carry tooltips')
  ok(await page.$$eval('#prodStage [data-strip="products"] .acts button', b => b.every(x => x.textContent.trim() || x.getAttribute('aria-label'))), 'every button has a name')
  ok(await page.$eval('#prodStage [data-strip="products"]', s => s.offsetHeight) === 72, 'the strip keeps its 72 px')
  await shot('prod-b-260', '#products .stagebox')

  // actions on the list
  await width(467)
  const order = () => page.$$eval('#prodStage .slot', s => s.slice(0, 4).map(x => x.getAttribute('aria-label').split(',')[0]))
  const before = await order()
  await page.click('#prodStage [data-strip="products"] [data-act="later"]')
  const after = await order()
  ok(before.join() !== after.join() && after[2] === 'Steel plate', 'Move later reorders the list: ' + after.join(' > '))
  await page.click('#prodStage [data-strip="products"] [data-act="rmextra"]')
  ok(!(await page.textContent('#prodStage [data-strip="products"] .hdr')).includes('extra'), 'Remove extra clears the extra in the header')
  ok(await page.$('#prodStage [data-strip="products"] [data-act="extra"]') !== null, '+ Extra output is offered again')
  await page.click('#prodStage [data-strip="products"] [data-act="extra"]')
  ok((await page.textContent('#prodStage [data-strip="products"] .hdr')).includes('+ 10 extra'), '+ Extra output adds one')
  await page.click('#prodStage [data-slot="sulfur"]')
  ok(await page.$eval('#prodStage [data-strip="products"] [data-act="later"]', b => b.disabled), 'Move later is disabled on the last product')
  await page.click('#prodStage [data-strip="products"] [data-act="remove"]')
  ok((await page.textContent('#prodLog')).includes('asks to confirm'), 'Remove product says it would ask to confirm')
  await page.click('#prodStage [data-slot="sulfur"]')
  await page.click('#prodStage [data-slot="steel"]')

  // byproducts at 260
  await width(260)
  await page.click('#prodStage [data-slot="b-slag"]')
  ok(await overflow('byps') <= 0, 'Byproducts @260: no overflow')
  ok(await page.$$eval('#prodStage [data-strip="byps"] .acts button', b => b.length === 4 && b.every(x => x.getAttribute('data-tip') && x.getAttribute('aria-label') && x.classList.contains('ico'))), 'Byproducts: four icon buttons, all with tooltips and names')
  ok(await page.$$eval('#prodStage [data-strip="byps"] .acts button', b => b.map(x => x.getAttribute('aria-label')).join('|') === 'Add consumer recipe…|Served order… · 2 not ranked|Use it all here|Make it a product'), 'Byproducts: the icons are in the order the spec gives')
  await shot('prod-b-byp-260', '#products .stagebox')
  await pv('current')
  ok(await overflow('byps') > 0, 'Current @260: the byproduct actions overflow too (' + await overflow('byps') + ' px)')
  await pv('b')

  // --- served order popover from the icon toolbar
  await width(413)
  await page.click('#prodStage [data-slot="steel"]')
  await page.click('#prodStage [data-slot="steel"]')
  const served = '#prodStage [data-strip="products"] [data-act="served"]'
  ok(await page.textContent(served + ' .badge') === '2', 'the served icon carries the 2 not-ranked badge')
  await page.click(served)
  ok(await page.$('#svHost [data-testid="served-order-popover"]') !== null, 'the icon opens the served-order popover')
  ok((await page.getAttribute('#svHost [role="dialog"]', 'aria-label')) === 'Served order of Steel plate', 'popover is named after the item')
  const counts = async () => page.evaluate(() => ({ ranked: document.querySelectorAll('#svHost [data-testid="served-ranked"] li').length, unranked: document.querySelectorAll('#svHost [data-testid="served-unranked"] li').length }))
  let c = await counts()
  ok(c.ranked === 1 && c.unranked === 2, 'one ranked line, two not ranked: ' + JSON.stringify(c))
  const lineText = k => page.textContent(`#svHost li[data-k="${k}"]`)
  ok((await lineText('hub')).includes('got 35/m'), 'Hub got its 35/m')
  ok((await lineText('extra')).includes('short 15/m'), 'Extra output is short 15/m (the supply runs out)')
  await shot('served-popover', '#svHost [role="dialog"]')
  await page.click('#svHost li[data-k="extra"] [data-sv-act="add"]')
  c = await counts()
  ok(c.ranked === 2 && c.unranked === 1, 'Add to list ranks the line')
  ok(!(await lineText('extra')).includes('short') && (await lineText('circ')).includes('short 15/m'), 'Extra is served now; Circuits goes short instead')
  ok(await page.textContent(served + ' .badge') === '1', 'the badge on the strip icon follows: 1 not ranked')
  await page.click('#svHost li[data-k="extra"] [data-sv-act="up"]')
  ok((await page.$$eval('#svHost [data-testid="served-ranked"] li', l => l.map(x => x.dataset.k))).join() === 'extra,hub', 'Move up reorders the ranked lines')
  ok(await page.evaluate(() => document.activeElement && document.activeElement.closest('li') && document.activeElement.closest('li').dataset.k === 'extra'), 'focus stays on the moved line')
  await page.click('#svHost li[data-k="hub"] [data-sv-act="tie"]')
  ok(await page.$('#svHost li.br') !== null && (await page.inputValue('#svHost li[data-k="hub"] input')) === '50', 'Share puts Hub in a bracket with Extra output at 50 %')
  await page.fill('#svHost li[data-k="hub"] input', '80'); await page.press('#svHost li[data-k="hub"] input', 'Enter')
  ok((await page.inputValue('#svHost li[data-k="extra"] input')) === '20' && (await page.inputValue('#svHost li[data-k="hub"] input')) === '80', 'editing a share rebalances the group (80 / 20)')
  await page.fill('#svHost li[data-k="hub"] input', '120'); await page.press('#svHost li[data-k="hub"] input', 'Enter')
  ok((await page.textContent('#prodLog')).includes('Share must be above 0') || (await page.textContent('#svHost [role="status"]')).includes('Share must be above 0'), 'an invalid share is refused with the app\'s message')
  await page.click('#svHost [data-sv-act="reset"]')
  await page.click('#svHost li[data-k="circ"] [data-sv-act="tie"]')
  await page.click('#svHost li[data-k="extra"] [data-sv-act="tie"]')
  ok((await page.$$eval('#svHost li.br', l => l.length)) === 3, 'tying twice makes one place of three lines')
  await page.fill('#svHost li[data-k="hub"] input', '60'); await page.press('#svHost li[data-k="hub"] input', 'Enter')
  ok((await lineText('hub')).includes('got 35/m') && (await lineText('extra')).includes('short 2.5/m'), 'shares split a scarce supply: Hub (60 %) is capped at its 35/m, Extra output ends 2.5/m short')
  await page.click('#svHost [data-sv-act="reset"]')
  ok((await page.textContent('#svHost .hint')).startsWith('Today'), 'Reset order returns to the solver\'s order')
  c = await counts(); ok(c.ranked === 3 && c.unranked === 0, 'all three lines are ranked again, none unranked')
  ok(await page.$(served + ' .badge') === null, 'and the icon has no badge')
  await page.dragAndDrop('#svHost li[data-k="circ"] .nm', '#svHost li[data-k="hub"]', { targetPosition: { x: 40, y: 2 } })
  ok((await page.$$eval('#svHost [data-testid="served-ranked"] li', l => l.map(x => x.dataset.k))).join() === 'circ,hub,extra', 'dragging Circuits onto Hub\'s top edge puts it first')
  await page.dragAndDrop('#svHost li[data-k="extra"] .nm', '#svHost li[data-k="hub"]', { targetPosition: { x: 40, y: 14 } })
  ok((await page.$$eval('#svHost li.br', l => l.map(x => x.dataset.k))).join() === 'hub,extra', 'dropping Extra on the middle of Hub shares its place')
  await page.keyboard.press('Escape')
  ok(await page.$('#svHost [role="dialog"]') === null, 'Esc closes the popover')
  ok(await page.evaluate(() => document.activeElement && document.activeElement.getAttribute('data-act') === 'served'), 'focus returns to the Served order icon')
  await page.click(served)
  await page.click('h1')
  ok(await page.$('#svHost [role="dialog"]') === null, 'a click outside closes it')
  await pv('current')
  await page.click('#prodStage [data-slot="steel"]'); await page.click('#prodStage [data-slot="steel"]')
  ok(await page.evaluate(() => {
    const b = document.querySelector('#prodStage [data-strip="products"] [data-act="served"]')
    b.scrollIntoView({ block: 'center' })
    const r = b.getBoundingClientRect(), hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
    return hit !== b && !b.contains(hit)
  }), 'Current @413: the Served order… button is covered by the Byproducts pane and cannot be clicked')
  await pv('b')

  // --- Ingredients
  const heights = {}
  for (const w of [260, 413]) { await width(w); for (const v of ['current', 'd']) { await iv(v); heights[v + w] = await ingH() } }
  console.log('heights', JSON.stringify(heights))
  ok(heights.current413 >= 156, 'Current is at least 156 px at 413 (' + heights.current413 + ')')
  ok(heights.d413 < heights.current413 && heights.d260 < heights.current260, `Proposed is shorter at 413 (${heights.d413} vs ${heights.current413}) and 260 (${heights.d260} vs ${heights.current260})`)
  await width(260); await iv('d')
  ok(await page.$eval('#ingStage [data-row="ing"]', r => r.scrollWidth <= r.clientWidth + 1 && r.offsetHeight < 30), '@260: the icon row fits on one line')
  ok(await page.$$eval('#ingStage [data-row="ing"] > button, #ingStage [data-row="ing"] > .presets button, #ingStage [data-row="ing"] > .anchor > button', b => b.length === 8 && b.every(x => x.getAttribute('aria-label') && x.getAttribute('data-tip'))), 'all eight icons have an accessible name and a tooltip')
  const s0 = await page.textContent('#ingStage [data-sentence]')
  await page.click('#ingStage [data-preset="receive"]')
  const s1 = await page.textContent('#ingStage [data-sentence]')
  ok((await page.getAttribute('#ingStage [data-preset="receive"]', 'aria-checked')) === 'true' && s1 !== s0 && s1.startsWith('Receives 50/m from Metals'), 'a preset icon changes the rule, the bar and the sentence: ' + s1)
  await page.click('#ingStage [data-sw="imp"]')
  const s2 = await page.textContent('#ingStage [data-sentence]')
  ok((await page.getAttribute('#ingStage [data-sw="imp"]', 'aria-checked')) === 'false' && /missing/.test(s2) && /Import is off/.test(s2) && await page.$('#ingStage .sg.miss') !== null, 'Import off shows the shortfall in the bar and the sentence: ' + s2)
  ok((await page.getAttribute('#ingStage [data-sw="imp"]', 'data-tip')).startsWith('Import off'), 'its tooltip says the state in words')
  await page.click('#ingStage [data-sw="imp"]')
  const leftBefore = await page.getAttribute('#ingStage [data-sw="left"]', 'aria-checked')
  await page.click('#ingStage [data-sw="left"]')
  ok((await page.getAttribute('#ingStage [data-sw="left"]', 'aria-checked')) !== leftBefore, 'the Leftover icon toggles')
  await page.click('#ingStage [data-act="sources"]')
  ok(!(await page.$eval('#ingStage .pop', p => p.hidden)), 'the Sources icon opens the list')
  await page.keyboard.press('Escape')
  ok(await page.$eval('#ingStage .pop', p => p.hidden), 'Esc closes it')
  await width(413)
  await shot('ing-d-413', '#ingredients .stagebox')
  await width(260)
  await shot('ing-d-260', '#ingredients .stagebox')
  await iv('current'); await width(413)
  ok(await page.$('#ingStage [data-testid="comes-from"]') !== null, 'Current still shows today\'s Comes from block for comparison')
  await shot('ing-current-413', '#ingredients .stagebox')
  await iv('d')
  await page.click('#ingStage [data-slot="i-coal"]')
  ok((await page.textContent('#ingStage .hdr')).includes('Coal'), 'selecting Coal shows its strip')
  await page.click('#ingStage [data-act="back"]')
  ok((await page.textContent('#ingStage [data-state="overview"]')).includes('Overview'), 'the ✕ returns to the overview')

  // --- spec content matches the replica
  await width(260); await iv('d'); await pv('b')
  const ensure = async (slot, strip) => { await page.click(`[data-slot="${slot}"]`); if (!(await page.$(`[data-strip="${strip}"]`))) await page.click(`[data-slot="${slot}"]`) }
  await page.click('#ingStage [data-slot="i-iron"]')
  if (!(await page.$('#ingStage [data-strip="ing"]'))) await page.click('#ingStage [data-slot="i-iron"]')
  await page.click('#prodStage [data-slot="steel"]'); if (!(await page.$('#prodStage [data-strip="products"]'))) await page.click('#prodStage [data-slot="steel"]')
  if (await page.$('#prodStage [data-strip="products"] [data-act="rmextra"]')) await page.click('#prodStage [data-strip="products"] [data-act="rmextra"]')
  ok(await page.$$eval('#prodStage [data-strip="products"] .acts button', b => b.map(x => (x.textContent.trim() || x.getAttribute('aria-label')).replace(/ · \d+ not ranked/, '')).join('|') === 'Find recipe|Served order…|Add extra output|Move earlier|Move later|Remove product'), 'Products: the controls are in the order the spec gives')
  ok(await page.getAttribute('#prodStage [data-strip="products"] [data-act="extra"]', 'data-tip') === 'Add extra output on top of what is requested', 'Products: the extra tooltip is the existing text')
  ok((await page.$$eval('#prodRead .card .s', s => s.map(x => x.textContent))).some(t => /need 160 px of the 238 px row/.test(t)), 'the readout confirms the 160 px / 238 px figures in the spec')
  await page.click('#prodStage [data-slot="b-slag"]'); if (!(await page.$('#prodStage [data-strip="byps"]'))) await page.click('#prodStage [data-slot="b-slag"]')
  ok((await page.$$eval('#prodRead .card .s', s => s.map(x => x.textContent))).some(t => /need 108 px of the 238 px row/.test(t)), 'and the 108 px figure for Byproducts')
  // one pattern across the three panes
  const rows = await page.evaluate(() => {
    const out = {}
    const read = (sel, key) => {
      const row = document.querySelector(sel); if (!row) return
      const kids = [...row.children], sp = kids.findIndex(k => k.classList.contains('sp'))
      const names = [], dims = [], icons = {}
      const visit = (b) => {
        const c = b.cloneNode(true); c.querySelectorAll('.badge').forEach(x => x.remove())
        // a preset sits inside the bordered group, which is the 22 px high part
        names.push(b.getAttribute('aria-label')); dims.push([b.offsetWidth, b.parentElement.classList.contains('presets') ? b.parentElement.offsetHeight : b.offsetHeight, c.textContent.trim()])
        icons[b.getAttribute('aria-label').replace(/ · \d+ not ranked/, '')] = b.querySelector('svg').innerHTML
      }
      kids.forEach(k => { if (k.tagName === 'BUTTON') visit(k); else if (k.matches('.pair,.presets')) k.querySelectorAll('button').forEach(visit); else if (k.classList.contains('anchor')) visit(k.querySelector('button')) })
      out[key] = { names, dims, icons, gap: getComputedStyle(row).columnGap, left: kids.slice(0, sp).filter(k => k.tagName === 'BUTTON').map(k => k.getAttribute('aria-label')), h: row.offsetHeight }
    }
    read('#prodStage [data-row="products"]', 'products'); read('#prodStage [data-row="byps"]', 'byps'); read('#ingStage [data-row="ing"]', 'ing')
    return out
  })
  await page.click('#prodStage [data-slot="steel"]'); if (!(await page.$('#prodStage [data-strip="products"]'))) await page.click('#prodStage [data-slot="steel"]')
  const all = await page.evaluate(() => {
    const row = document.querySelector('#prodStage [data-row="products"]'); const out = {}
    ;[...row.querySelectorAll('button')].forEach(b => { out[b.getAttribute('aria-label').replace(/ · \d+ not ranked/, '')] = b.querySelector('svg').innerHTML })
    return out
  })
  const pats = { ...rows, products: { ...rows.products, icons: all } }
  ok(['products', 'byps', 'ing'].every(k => pats[k] && pats[k].gap === '4px' && pats[k].h <= 24), 'all three toolbars are one 22 px row with a 4 px gap')
  const badDims = []
  for (const k of ['products', 'byps', 'ing']) pats[k].dims.forEach((d, i) => { if (!(d[0] === 24 && d[1] === 22 && d[2] === '')) badDims.push(k + ':' + pats[k].names[i] + ' ' + d.join('x')) })
  ok(badDims.length === 0, 'every control in the three toolbars is a 24 × 22 icon with no text label' + (badDims.length ? ' — ' + badDims.join('; ') : ''))
  ok(pats.products.left.join() === 'Find recipe' && pats.byps.left.join() === 'Add consumer recipe…' && pats.ing.left.slice(0, 2).join() === 'Find recipe,Receive from…', 'the left cluster is how the item is made or supplied, in every pane')
  const seen = {}, clash = []
  for (const p of ['products', 'byps', 'ing']) for (const [n, svg] of Object.entries(pats[p].icons)) { if (seen[n] && seen[n] !== svg) clash.push(n); seen[n] = svg }
  ok(clash.length === 0, 'an action has the same icon in every pane it appears in' + (clash.length ? ': ' + clash : ''))
  const byIcon = {}; for (const [n, svg] of Object.entries(seen)) (byIcon[svg] = byIcon[svg] || []).push(n)
  const shared = Object.values(byIcon).filter(v => v.length > 1)
  ok(shared.length === 0, 'no icon stands for two different actions' + (shared.length ? ': ' + JSON.stringify(shared) : ''))
  ok((await page.textContent('#ingRead')).includes('224 px of 238 px'), 'and the 224 px controls row of Ingredients')
  ok((await page.$$eval('#iconRows tr', r => r.length)) === 17 && (await page.$$eval('[data-ic]', e => e.every(x => x.querySelector('svg')))), 'the icon legend and the chips in the tables are drawn')
  ok((await page.$$eval('.widthSeg', s => s.length)) === 2, 'both replicas have a pane width control')
  await page.check('#condToggle')
  ok(await page.$('#ingStage [data-testid="no-effect"]') !== null && await page.$('#ingStage [data-testid="leftover-take-note"]') !== null, 'the conditional rows show when ticked')
  ok(/193 px/.test(await page.textContent('#ingRead')), 'the conditional rows make the strip 193 px at 260 px, as the spec says')
  await width(413)
  ok(/151 px/.test(await page.textContent('#ingRead')), 'and 151 px at 413 px')
  await page.uncheck('#condToggle')
  ok(await page.$$eval('section.spec', s => s.map(x => x.id).join()) === 'decisions,pattern,products,ingredients,served,icons,open,build,accept,proposed', 'the spec sections are in the order the contents list gives')
  ok(await page.$$eval('.toc a', a => a.every(x => document.querySelector(x.getAttribute('href')))), 'every contents link has a target')

  await page.setViewportSize({ width: 390, height: 900 }); await page.waitForTimeout(200)
  ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'no horizontal page scroll at 390 px')
  await width(467)
  ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'no horizontal page scroll at 390 px with the widest pane')
  ok(errors.length === 0, 'no console errors' + (errors.length ? ': ' + errors.join(' | ') : ''))
  await browser.close()
  console.log(fails ? fails + ' FAILED' : 'all passed')
  process.exit(fails ? 1 : 0)
})()
