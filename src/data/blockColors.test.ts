import { describe, it, expect } from 'vitest'
import { BLOCK_PALETTE, assignMissingBlockColors, hueSaturation, pickBlockColor, pickBlockColorForIcon, withAlpha } from './blockColors'

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

describe('hueSaturation', () => {
  it('returns the HSV hue in degrees and the saturation', () => {
    expect(hueSaturation('#ff0000')).toEqual({ hue: 0, saturation: 1 })
    expect(hueSaturation('#00ff00')).toEqual({ hue: 120, saturation: 1 })
    expect(hueSaturation('#0000ff')).toEqual({ hue: 240, saturation: 1 })
    expect(hueSaturation('#ffff00').hue).toBe(60)
    expect(hueSaturation('#808080')).toEqual({ hue: 0, saturation: 0 })
  })
})

describe('pickBlockColorForIcon', () => {
  it('takes the only palette colour near the icon hue whatever the random draw', () => {
    for (const r of [0, 0.5, 0.999]) expect(pickBlockColorForIcon('#ffff00', [], { random: () => r })).toBe('#a3e635')
  })

  it('breaks ties between near colours with the random draw', () => {
    expect(pickBlockColorForIcon('#00ff00', [], { random: () => 0 })).toBe('#a3e635')
    expect(pickBlockColorForIcon('#00ff00', [], { random: () => 0.999 })).toBe('#86efac')
  })

  it('prefers the least-used colour among the near ones', () => {
    expect(pickBlockColorForIcon('#00ff00', ['#a3e635'], { random: () => 0 })).toBe('#86efac')
    expect(pickBlockColorForIcon('#ff0000', ['#fca5a5'], { random: () => 0 })).toBe('#fda4af')
    expect(pickBlockColorForIcon('#ff0000', ['#fda4af'], { random: () => 0 })).toBe('#fca5a5')
  })

  it('is case-insensitive', () => {
    expect(pickBlockColorForIcon('#FFFF00', ['#A3E635'], { random: () => 0 })).toBe('#a3e635')
  })

  it('falls back to a random pick for grey, missing or invalid colours', () => {
    const used = BLOCK_PALETTE.slice(0, 15)
    for (const c of ['#7a7a79', '#1a0000', '#3f0000', undefined, '#xyz']) {
      expect(pickBlockColorForIcon(c, used, { random: () => 0 })).toBe(BLOCK_PALETTE[15])
    }
  })

  it('always returns a palette colour', () => {
    for (let h = 0; h < 360; h += 30) {
      const [r, g, b] = [0, 8, 4].map(k => {
        const x = (k + h / 60) % 6
        return Math.round(255 * (1 - Math.max(0, Math.min(1, Math.min(x, 4 - x)))))
      })
      const hex = `#${[r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')}`
      expect(BLOCK_PALETTE).toContain(pickBlockColorForIcon(hex, []))
    }
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
