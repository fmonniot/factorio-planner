import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, act } from '@testing-library/react'
import { useNarrowTable } from './useNarrowTable'

function Probe({ id }: { id: number }) {
  return <span data-testid={`probe-${id}`}>{useNarrowTable() ? 'narrow' : 'wide'}</span>
}

describe('useNarrowTable', () => {
  afterEach(() => vi.unstubAllGlobals())

  function stubMedia(matches: boolean) {
    const listeners = new Set<() => void>()
    const mql = {
      matches,
      media: '(min-width: 768px)',
      addEventListener: vi.fn((_: string, l: () => void) => listeners.add(l)),
      removeEventListener: vi.fn((_: string, l: () => void) => listeners.delete(l)),
    }
    vi.stubGlobal('matchMedia', () => mql)
    return { mql, change: (next: boolean) => { mql.matches = next; listeners.forEach(l => l()) } }
  }

  it('shares one media query listener between every row, and follows the screen', () => {
    const media = stubMedia(false)
    const { getByTestId, unmount } = render(<>{[1, 2, 3, 4, 5].map(i => <Probe key={i} id={i} />)}</>)
    expect(media.mql.addEventListener).toHaveBeenCalledTimes(1)
    expect(getByTestId('probe-3')).toHaveTextContent('narrow')

    act(() => media.change(true))
    for (let i = 1; i <= 5; i++) expect(getByTestId(`probe-${i}`)).toHaveTextContent('wide')

    unmount()
    expect(media.mql.removeEventListener).toHaveBeenCalledTimes(1)
  })

  it('is wide in a DOM without media queries', () => {
    vi.stubGlobal('matchMedia', undefined)
    const { getByTestId } = render(<Probe id={1} />)
    expect(getByTestId('probe-1')).toHaveTextContent('wide')
  })
})
