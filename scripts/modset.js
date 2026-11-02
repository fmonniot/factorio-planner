/**
 * modset.js
 *
 * Pure mod-set comparison used by the bundle patch modes. `base` and the
 * planner's own viewer mod add no game data (the viewer only adds a GUI
 * sprite), so they are ignored on both sides.
 */

export const IGNORED_MODS = ['base', 'factorio-planner-viewer']

/** Lines describing every mod whose version differs between two mod sets (empty when they match). */
export function modSetDiffs(bundleSet = {}, dumpSet = {}) {
  const diffs = []
  for (const name of new Set([...Object.keys(bundleSet), ...Object.keys(dumpSet)])) {
    if (IGNORED_MODS.includes(name)) continue
    if (bundleSet[name] !== dumpSet[name]) {
      diffs.push(`  ${name}: bundle=${bundleSet[name] ?? '(missing)'} dump=${dumpSet[name] ?? '(missing)'}`)
    }
  }
  return diffs
}
