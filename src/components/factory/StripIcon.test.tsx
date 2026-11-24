import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { StripIcon } from './StripIcon'

describe('StripIcon', () => {
  it('gives each rendered struck icon its own mask id', () => {
    const { container } = render(<><StripIcon name="leftover-off" /><StripIcon name="leftover-off" /><StripIcon name="extra-add" /></>)
    const ids = [...container.querySelectorAll('mask')].map(m => m.id)
    expect(ids).toHaveLength(3)
    expect(new Set(ids).size).toBe(3)
    for (const svg of container.querySelectorAll('svg')) {
      const id = svg.querySelector('mask')?.id
      if (id) expect(svg.querySelector('g[mask]')).toHaveAttribute('mask', `url(#${id})`)
    }
  })

  it('draws a plain icon with no mask', () => {
    const { container } = render(<StripIcon name="leftover" />)
    expect(container.querySelector('mask')).toBeNull()
  })

  it('masks only the arrow of Import off, keeping the dots whole', () => {
    const { container } = render(<StripIcon name="import-off" />)
    expect(container.querySelectorAll('g[mask] circle')).toHaveLength(0)
    expect(container.querySelectorAll('circle')).toHaveLength(3)
  })

  it('draws Make more here as the assembler with a plus in the corner', () => {
    const { container } = render(<StripIcon name="make-more" />)
    expect(container.querySelector('svg')).toHaveAttribute('data-icon', 'make-more')
    expect(container.querySelector('g[mask] rect')).not.toBeNull()
    expect(container.querySelector('path[d="M9.3 7.4v3.8M7.4 9.3h3.8"]')).not.toBeNull()
  })
})
