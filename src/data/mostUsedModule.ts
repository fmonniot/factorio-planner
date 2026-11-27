import type { ModuleConfig } from './types'

/**
 * The module type with the most modules in total (entries of one module add up); on a tie the first by module id.
 * The rule for "the module a configuration shows" in the table's module chips.
 */
export function mostUsedModule(modules: readonly ModuleConfig[]): string | undefined {
  const counts = new Map<string, number>()
  for (const m of modules) counts.set(m.moduleId, (counts.get(m.moduleId) ?? 0) + m.count)
  let best: [string, number] | undefined
  for (const entry of counts) if (!best || entry[1] > best[1] || (entry[1] === best[1] && entry[0] < best[0])) best = entry
  return best?.[0]
}
