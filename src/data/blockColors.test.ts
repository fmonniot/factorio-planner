import { describe, it, expect } from 'vitest'
import { BLOCK_PALETTE, assignMissingBlockColors, pickBlockColor, withAlpha } from './blockColors'

describe('pickBlockColor', () => {
  it('returns the only unused colour whatever the random draw', () => {
    const used = BLOCK_PALETTE.slice(0, 15)
    expect(pickBlockColor(used, { random: () => 0 })).toBe(BLOCK_PALETTE[15])
    expect(pickBlockColor(used, { random: () => 0.999 })).toBe(BLOCK_PALETTE[15])
  })

  it('draws from the whole palette when nothing is used', () => {
    expect(pickBlockColor([], { random: () => 0 })).toBe(BLOCK_PALETTE[0])
    expect(pickBlockColor([], { random: () => 0.999 })).toBe(BLOCK_PALETTE[15])
  })

  it('never returns a colour that is used more than another', () => {
    const used = [...BLOCK_PALETTE, '#60a5fa']
    for (const r of [0, 0.3, 0.6, 0.999]) {
      expect(pickBlockColor(used, { random: () => r })).not.toBe('#60a5fa')
    }
  })

  it('honours exclude even when it is the only least-used colour', () => {
    const used = BLOCK_PALETTE.slice(0, 15)
    expect(pickBlockColor(used, { exclude: BLOCK_PALETTE[15], random: () => 0 })).not.toBe(BLOCK_PALETTE[15])
  })

  it('compares colours case-insensitively', () => {
    const used = ['#60A5FA', ...BLOCK_PALETTE.slice(1, 15)]
    expect(pickBlockColor(used, { random: () => 0 })).toBe(BLOCK_PALETTE[15])
  })
})

describe('withAlpha', () => {
  it('converts a hex colour to rgba', () => {
    expect(withAlpha('#60a5fa', 0.35)).toBe('rgba(96, 165, 250, 0.35)')
  })
})

describe('assignMissingBlockColors', () => {
  const colors = (raw: unknown) => ((raw as { blocks: { color: string }[] }).blocks).map(b => b.color)

  it('gives colourless blocks palette colours in order', () => {
    expect(colors(assignMissingBlockColors({ blocks: [{}, {}] }))).toEqual([BLOCK_PALETTE[0], BLOCK_PALETTE[1]])
  })

  it('keeps an existing colour and skips it for the others', () => {
    expect(colors(assignMissingBlockColors({ blocks: [{ color: '#60a5fa' }, {}] }))).toEqual(['#60a5fa', BLOCK_PALETTE[1]])
    expect(colors(assignMissingBlockColors({ blocks: [{}, { color: '#60a5fa' }] }))).toEqual([BLOCK_PALETTE[1], '#60a5fa'])
  })

  it('replaces an invalid colour', () => {
    expect(colors(assignMissingBlockColors({ blocks: [{ color: 'red' }, { color: 42 }] }))).toEqual([
      BLOCK_PALETTE[0],
      BLOCK_PALETTE[1],
    ])
  })

  it('lower-cases a valid colour', () => {
    expect(colors(assignMissingBlockColors({ blocks: [{ color: '#ABCDEF' }] }))).toEqual(['#abcdef'])
  })

  it('passes non-objects and blockless objects through', () => {
    expect(assignMissingBlockColors(null)).toBeNull()
    expect(assignMissingBlockColors('x')).toBe('x')
    const noBlocks = { blocks: 'nope' }
    expect(assignMissingBlockColors(noBlocks)).toBe(noBlocks)
  })

  it('does not mutate its input', () => {
    const raw = { blocks: [{ name: 'a' }] }
    const copy = structuredClone(raw)
    assignMissingBlockColors(raw)
    expect(raw).toEqual(copy)
  })

  it('wraps around the palette past 16 colourless blocks', () => {
    const out = colors(assignMissingBlockColors({ blocks: Array.from({ length: 17 }, () => ({})) }))
    expect(out[16]).toBe(BLOCK_PALETTE[16 % 16])
  })
})
