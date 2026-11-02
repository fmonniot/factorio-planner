import { describe, it, expect } from 'vitest'
import { modSetDiffs } from '../modset.js'

describe('modSetDiffs', () => {
  it('ignores base and the viewer mod on both sides', () => {
    expect(modSetDiffs(
      { base: '2.0.1', seablock: '1.0.0' },
      { base: '2.0.9', seablock: '1.0.0', 'factorio-planner-viewer': '0.1.0' },
    )).toEqual([])
  })

  it('still reports any other mismatch', () => {
    const diffs = modSetDiffs(
      { seablock: '1.0.0', gone: '1.0.0' },
      { seablock: '1.0.1', 'factorio-planner-viewer': '0.1.0', added: '2.0.0' },
    )
    expect(diffs).toHaveLength(3)
    expect(diffs.join('\n')).toMatch(/seablock: bundle=1\.0\.0 dump=1\.0\.1/)
    expect(diffs.join('\n')).toMatch(/gone: bundle=1\.0\.0 dump=\(missing\)/)
    expect(diffs.join('\n')).toMatch(/added: bundle=\(missing\)/)
  })
})
