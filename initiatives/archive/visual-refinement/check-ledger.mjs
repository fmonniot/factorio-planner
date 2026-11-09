#!/usr/bin/env node
// Keeps implementation.md honest: every change the owner accepted in the design artifact has exactly one ledger row,
// one spec bullet in the section of the PR that implements it, and an artifact check that exists; every rejected
// variant is gone from the page; nothing in the initiative's documents names a change that is not classified.
//
//   node initiatives/visual-refinement/check-ledger.mjs            # run by `npm run lint:docs`
//   node initiatives/visual-refinement/check-ledger.mjs --audit    # also fails while any Landed cell is still "—"
//
// When the initiative is archived, remove this script from the `lint:docs` line in package.json in the same commit.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const read = name => readFileSync(join(here, name), 'utf8')
const audit = process.argv.includes('--audit')
const problems = []
const fail = msg => problems.push(msg)

// ---- the artifact: what is decided, what exists
const page = read('artifact/project/Main.dc.html')
const decided = [...(page.match(/const DECIDED = \[([^\]]*)\]/)?.[1] ?? '').matchAll(/'(\w+)'/g)].map(m => m[1])
const groupsBlock = page.slice(page.indexOf('const GROUPS = ['), page.indexOf('const ALL_IDS'))
const pageIds = [...groupsBlock.matchAll(/^\s+\['(\w+)', '/gm)].map(m => m[1])
if (decided.length === 0) fail('Main.dc.html: could not read DECIDED')
if (pageIds.length === 0) fail('Main.dc.html: could not read the toggles in GROUPS')
for (const id of decided) if (!pageIds.includes(id)) fail(`Main.dc.html: DECIDED names ${id}, which is not a toggle in GROUPS`)

// ---- implementation.md
const doc = read('implementation.md')
const between = (from, to) => {
  const a = doc.indexOf(from)
  const b = doc.indexOf(to, a + from.length)
  if (a < 0 || b < 0) { fail(`implementation.md: missing the section between "${from}" and "${to}"`); return '' }
  return doc.slice(a, b)
}

const ledger = new Map()
for (const m of between('\n## Ledger', '\n## Rejected').matchAll(/^\| `(\w+)` \| (\d+) \| (\d+) \| (none|`[^`]+`) \| (—|#\d+) \|$/gm)) {
  const [, id, finding, pr, check, landed] = m
  if (ledger.has(id)) fail(`ledger: ${id} appears twice`)
  ledger.set(id, { finding: +finding, pr: +pr, check: check === 'none' ? null : check.slice(1, -1), landed })
}

const rejected = new Set()
for (const m of between('\n## Rejected', '\n## PR 1').matchAll(/^\| `(\w+)` \| (\d+) \| /gm)) rejected.add(m[1])

// accepted <-> artifact
for (const id of decided) if (!ledger.has(id)) fail(`the artifact accepts ${id} (DECIDED) but the ledger has no row for it`)
for (const id of ledger.keys()) if (!decided.includes(id)) fail(`the ledger lists ${id}, which is not in DECIDED in Main.dc.html`)

// rejected: classified once, and gone from the page
for (const id of rejected) {
  if (ledger.has(id)) fail(`${id} is both accepted and rejected`)
  if (pageIds.includes(id) || new RegExp(`tg\\.${id}\\b`).test(page)) fail(`${id} is rejected but still in Main.dc.html`)
}

// artifact checks exist
const checks = read('check-artifact.mjs')
for (const [id, row] of ledger) {
  if (row.check && !checks.includes(`check('${row.check}`)) fail(`ledger: ${id} names the artifact check "${row.check}", which check-artifact.mjs does not have`)
  if (audit && row.landed === '—') fail(`audit: ${id} has not landed (PR ${row.pr})`)
}

// one spec bullet per accepted change, in the section of its PR
const specs = new Map()
const sections = doc.split(/^## PR (\d+) · .*$/m)
for (let i = 1; i < sections.length; i += 2) {
  const pr = +sections[i]
  for (const m of sections[i + 1].matchAll(/^- \*\*(.+?)\*\*/gm)) {
    for (const [, id] of m[1].matchAll(/`(\w+)`/g)) {
      if (specs.has(id)) fail(`PR sections: ${id} is specified twice`)
      specs.set(id, pr)
    }
  }
}
for (const [id, row] of ledger) {
  if (!specs.has(id)) fail(`PR sections: ${id} (PR ${row.pr}) has no bullet`)
  else if (specs.get(id) !== row.pr) fail(`${id}: the ledger says PR ${row.pr}, the bullet is under PR ${specs.get(id)}`)
}
for (const id of specs.keys()) if (!ledger.has(id)) fail(`PR sections: a bullet is about ${id}, which is not in the ledger`)

// no unclassified change named anywhere in the initiative's documents
const TOGGLE_LIKE = /^(?:(?:sum|leg|ov|ing|chip|grp|ph|pan|sel|tabs|ws|block|add|narrow|col|hide|top)[A-Z]\w*|contrast)$/
for (const file of ['plan.md', 'HANDOFF.md', 'implementation.md']) {
  for (const m of read(file).matchAll(/`([A-Za-z]+)`/g)) {
    if (TOGGLE_LIKE.test(m[1]) && !ledger.has(m[1]) && !rejected.has(m[1])) fail(`${file}: names ${m[1]}, which is neither accepted nor rejected in implementation.md`)
  }
}

if (problems.length) {
  console.error(`check-ledger: ${problems.length} problem${problems.length === 1 ? '' : 's'}`)
  for (const p of problems) console.error('  ' + p)
  process.exit(1)
}
console.log(`check-ledger: ${ledger.size} accepted changes, ${rejected.size} rejected${audit ? ', all landed' : ''}`)
