import { describe, it, expect } from 'vitest'
import { iconUrl, iconUrlWebp } from './iconUrl'

const base = import.meta.env.BASE_URL
const expected = `${base}data/nullius/icons/a.png`

describe('iconUrl', () => {
  it('prefixes BASE_URL to a public-relative path', () => {
    expect(iconUrl('/data/nullius/icons/a.png')).toBe(expected)
  })

  it('still accepts legacy absolute paths containing /public/', () => {
    expect(iconUrl('//Users/x/public/data/nullius/icons/a.png')).toBe(expected)
  })

  it('swaps the extension for WebP', () => {
    expect(iconUrlWebp('/data/nullius/icons/a.png')).toBe(`${base}data/nullius/icons/a.webp`)
  })
})
