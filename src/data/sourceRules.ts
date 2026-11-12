import type { SourceRule } from './types'

// The mapping between a rule's `makeHere` and the preset names the solver docs and the UI keep, and the
// reads of a rule map every layer needs. Lowest layer: imports nothing but types.

/** A preset other than Make it here, as the controls and the sentences name it. */
export type SourcingPreset = 'byproducts-first' | 'connections-first'

/** The `makeHere` value a preset stores; undefined (Make it here) stores nothing. */
export function makeHereOf(preset: SourcingPreset | undefined): 'after-blocks' | 'off' | undefined {
  return preset === 'connections-first' ? 'after-blocks' : preset === 'byproducts-first' ? 'off' : undefined
}

/** The preset a rule chooses: where its `makeHere` sits; undefined (Make it here) when it has none. */
export function presetOf(rule: SourceRule | undefined): SourcingPreset | undefined {
  return rule?.makeHere === 'after-blocks' ? 'connections-first' : rule?.makeHere === 'off' ? 'byproducts-first' : undefined
}

/** Items whose rule has Import off, in map order. */
export function importOffItems(rules: Record<string, SourceRule> | undefined): string[] {
  return Object.entries(rules ?? {}).filter(([, r]) => r.importOff).map(([id]) => id)
}
