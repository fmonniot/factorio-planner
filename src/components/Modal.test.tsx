import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Modal } from './Modal'

const panelClass = (className?: string) => {
  render(<Modal onClose={() => {}} className={className}>x</Modal>)
  return screen.getByTestId('modal-panel').className
}

describe('Modal caps', () => {
  it('caps width and height and scrolls vertically by default', () => {
    const c = panelClass('p-4 w-80')
    expect(c).toContain('max-w-[calc(100vw-1rem)]')
    expect(c).toContain('max-h-[calc(100dvh-1rem)]')
    expect(c).toContain('overflow-y-auto')
  })

  it('leaves the width cap to a caller max-w, also behind a variant prefix', () => {
    expect(panelClass('md:max-w-lg')).not.toContain('max-w-[calc')
  })

  it('keeps the vertical scroll when the caller only sets overflow-x', () => {
    expect(panelClass('overflow-x-hidden')).toContain('overflow-y-auto')
  })

  it('leaves the scroll to a caller that sets overflow on both axes or on y', () => {
    expect(panelClass('overflow-hidden')).not.toContain('overflow-y-auto')
  })
})
