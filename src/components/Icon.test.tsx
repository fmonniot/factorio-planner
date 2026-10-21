import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { Icon } from './Icon'
import { iconUrl, iconUrlWebp } from '../utils/iconUrl'

describe('Icon', () => {
  it('renders a hidden WebP <source> and a PNG <img> fallback', () => {
    const { container } = render(<Icon iconPath="x.png" alt="" />)
    const source = container.querySelector('source')!
    const img = container.querySelector('img')!
    expect(source.style.display, 'source hidden from layout').toBe('none')
    expect(source.type).toBe('image/webp')
    expect(source.getAttribute('srcset')).toBe(iconUrlWebp('x.png'))
    expect(img.getAttribute('src')).toBe(iconUrl('x.png'))
  })
})
