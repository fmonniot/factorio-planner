#!/usr/bin/env node
// Fails when tracked Markdown links to a relative path that does not exist,
// or (outside initiatives/) names a repo path in inline code that does not
// exist. initiatives/archive/ is frozen history and is skipped; the backlog
// and active initiatives may name files that are yet to be written.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, normalize } from 'node:path'

const LINK = /\]\(([^)#\s]+)(#[^)]*)?\)/g
const CODE_PATH = /`((?:src|scripts|e2e|public|spec|initiatives|\.github)\/[^`\s*{}<>]+)`/g

const files = execFileSync('git', ['ls-files', '*.md'], { encoding: 'utf8' })
  .split('\n')
  .filter(f => f && !f.startsWith('initiatives/archive/') && existsSync(f))

const problems = []
for (const file of files) {
  const checkCodePaths = !file.startsWith('initiatives/')
  let inFence = false
  readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence
    if (inFence) return
    for (const [, target] of line.replace(/`[^`]*`/g, '').matchAll(LINK)) {
      if (/^[a-z]+:/i.test(target)) continue
      if (!existsSync(normalize(join(dirname(file), target)))) {
        problems.push(`${file}:${i + 1}  link  ${target}`)
      }
    }
    if (!checkCodePaths) return
    for (const [, raw] of line.matchAll(CODE_PATH)) {
      const target = raw.replace(/\/$/, '').split(':')[0]
      if (!existsSync(target)) problems.push(`${file}:${i + 1}  path  ${target}`)
    }
  })
}

if (problems.length) {
  console.error(problems.join('\n'))
  console.error(`\n${problems.length} broken doc reference(s) in ${files.length} files`)
  process.exit(1)
}
console.log(`Doc links OK (${files.length} files)`)
