import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TraceChip } from './TraceChip'
import { segmentLook } from './segmentLooks'

function chip(onClear = vi.fn()) {
  const look = segmentLook('source', '#336699')
  render(<TraceChip rowKey="source:b1" kind="source" name="← Ores" look={look} onClear={onClear} />)
  return { onClear, look }
}

describe('TraceChip', () => {
  it('is a group named after what it traces, with the name and the colour swatch', () => {
    const { look } = chip()
    const group = screen.getByRole('group', { name: 'Tracing ← Ores' })
    expect(group).toHaveAttribute('data-key', 'source:b1')
    expect(group).toHaveAttribute('data-kind', 'source')
    expect(screen.getByTestId('summary-trace-name')).toHaveTextContent('← Ores')
    const swatch = screen.getByTestId('summary-trace-swatch')
    expect(swatch.style.background).not.toBe('')
    expect(swatch.style.borderStyle).toBe(look.borderStyle)
  })

  it('has a Stop tracing button that clears on click, Enter and Space', async () => {
    const user = userEvent.setup()
    const { onClear } = chip()
    const button = screen.getByRole('button', { name: 'Stop tracing' })
    await user.click(button)
    expect(onClear).toHaveBeenCalledTimes(1)
    button.focus()
    await user.keyboard('{Enter}')
    expect(onClear).toHaveBeenCalledTimes(2)
    await user.keyboard(' ')
    expect(onClear).toHaveBeenCalledTimes(3)
  })
})
