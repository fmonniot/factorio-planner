import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { TipWrap } from './TipWrap'

describe('TipWrap', () => {
  it('wraps the children in a span that carries the tip', () => {
    const { container } = render(<TipWrap tip="Why"><button>Go</button></TipWrap>)
    const span = container.querySelector('span')!
    expect(span.getAttribute('data-tip')).toBe('Why')
    expect(span.querySelector('button')).not.toBeNull()
  })
  it('renders only the children when `when` is false', () => {
    const { container } = render(<TipWrap tip="Why" when={false}><button>Go</button></TipWrap>)
    expect(container.querySelector('span')).toBeNull()
    expect(container.querySelector('button')).not.toBeNull()
  })
})
