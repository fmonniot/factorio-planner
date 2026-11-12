import type { SourceRule } from '../data/types'

/** The `sourceRules` map for a test written as presets and locked items: `itemSourcing`-style entries first, then the locks. */
export function sourceRulesOf(
  sourcing: Record<string, 'byproducts-first' | 'connections-first'> = {},
  locked: string[] = [],
): Record<string, SourceRule> {
  const out: Record<string, SourceRule> = {}
  for (const [id, mode] of Object.entries(sourcing)) out[id] = { makeHere: mode === 'connections-first' ? 'after-blocks' : 'off' }
  for (const id of locked) out[id] = { ...out[id], importOff: true }
  return out
}
