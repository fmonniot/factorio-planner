import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { RailLine, RailList, type RailTarget } from './RailList'

function lineOf(target: RailTarget, extra: Partial<Parameters<typeof RailLine>[0]> = {}) {
  return <RailLine target={target} label="Label" rate="10" tip="tip" {...extra} />
}

describe('RailList', () => {
  it('closes the list with a down chevron at the foot', () => {
    render(<RailList arrow="foot" label="L" testId="list">{lineOf({ kind: 'row' })}</RailList>)
    const list = screen.getByTestId('list')
    expect(list.getAttribute('data-arrow')).toBe('foot')
    const last = list.lastElementChild!
    expect(last.querySelector('svg')).not.toBeNull()
    expect(last.getAttribute('aria-hidden')).toBe('true')
    expect(screen.getByTestId('rail-stem').className).toContain('top-2.5')
    expect(screen.getByTestId('rail-stem').className).toContain('bottom-0.5')
  })

  it('opens the list with a chevron at the head', () => {
    render(<RailList arrow="head" label="L" testId="list">{lineOf({ kind: 'row' })}</RailList>)
    const list = screen.getByTestId('list')
    expect(list.children[1].querySelector('svg')).not.toBeNull()
    expect(screen.getByTestId('rail-stem').className).toContain('top-1 ')
    expect(screen.getByTestId('rail-stem').className).toContain('bottom-2.5')
  })

  it('shares one 14px column between the rail and the icon cells', () => {
    render(<RailList arrow="foot" label="L">{lineOf({ kind: 'row' })}</RailList>)
    expect(screen.getByTestId('rail-stem').className).toMatch(/left-1\.5 .*w-0\.5/)
    const cell = document.querySelector('[data-icon]')!
    expect(cell.className).toContain('w-3.5')
    expect(cell.className).toContain('h-3.5')
    expect(cell.className).toContain('group-hover:bg-[#1a2333]')
  })

  it('passes className to the list', () => {
    render(<RailList arrow="foot" label="L" testId="list" className="mr-8">{lineOf({ kind: 'row' })}</RailList>)
    expect(screen.getByTestId('list').className).toContain('mr-8')
  })

  it.each(['row', 'area', 'product', 'left', 'import', 'missing'] as const)('draws the %s icon', kind => {
    render(<RailList arrow="foot" label="L">{lineOf({ kind })}</RailList>)
    expect(document.querySelector(`[data-icon="${kind}"]`)).not.toBeNull()
    expect(screen.getByTestId('rail-line').getAttribute('data-target')).toBe(kind)
  })

  it('draws a block as a swatch in the given colour', () => {
    render(<RailList arrow="foot" label="L">{lineOf({ kind: 'block', color: '#123456' })}</RailList>)
    expect(document.querySelector('[data-icon="block"]')).not.toBeNull()
    expect((screen.getByTestId('rail-block-color') as HTMLElement).style.background).toBe('#123456')
  })

  it('colours the missing icon amber and a warn rate amber', () => {
    render(<RailList arrow="foot" label="L">{lineOf({ kind: 'missing' }, { tone: 'warn' })}</RailList>)
    expect(document.querySelector('[data-icon="missing"]')!.className).toContain('text-amber-300')
    expect(screen.getByTestId('rail-line-rate').className).toContain('text-amber-300')
  })

  it('shows the tip, the detail, and keeps the tag out of the truncating label', () => {
    render(<RailList arrow="foot" label="L">{lineOf({ kind: 'row' }, { detail: '2 × Furnace', tag: <span data-testid="tag">!</span> })}</RailList>)
    expect(screen.getByTestId('rail-line').getAttribute('data-tip')).toBe('tip')
    expect(screen.getByText('2 × Furnace')).toBeTruthy()
    expect(screen.getByTestId('rail-line-label').contains(screen.getByTestId('tag'))).toBe(false)
  })
})
