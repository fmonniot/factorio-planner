import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { RuleIcons } from './RuleIcons'
import { makeEmptyBlock } from '../../store/blockStore'

const root = makeEmptyBlock('B').rootPlan
const plan = { ...root, subPlans: [{ id: 'L', name: 'Line L', nodes: [], subPlans: [], area: true as const, createdAt: '', updatedAt: '' }] }

describe('RuleIcons', () => {
  it('draws nothing for the default rule, nor for Leftover off alone', () => {
    const { container, rerender } = render(<RuleIcons rule={undefined} rootPlan={plan} testId="icons" iconTestId="icon" />)
    expect(container).toBeEmptyDOMElement()
    rerender(<RuleIcons rule={{ leftoverOff: true }} rootPlan={plan} testId="icons" iconTestId="icon" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('draws the preset, then Import off, each an image named by its rule with the name as tooltip', () => {
    render(<RuleIcons rule={{ makeHere: 'after-blocks', importOff: true }} rootPlan={plan} testId="icons" iconTestId="icon" />)
    const icons = screen.getAllByTestId('icon')
    expect(icons.map(i => i.getAttribute('data-rule'))).toEqual(['connections-first', 'import-off'])
    expect(icons.map(i => i.getAttribute('aria-label'))).toEqual(['Receive it first', 'Import off'])
    expect(icons.map(i => i.getAttribute('data-tip'))).toEqual(['Receive it first', 'Import off'])
    for (const i of icons) expect(i).toHaveAttribute('role', 'img')
    expect(screen.getByTestId('icons')).toContainElement(icons[0])
  })

  it("names the icons of an area's rule with the area", () => {
    render(<RuleIcons rule={{ makeHere: 'off' }} areaId="L" rootPlan={plan} testId="icons" iconTestId="icon" />)
    expect(screen.getByTestId('icon')).toHaveAttribute('aria-label', "Line L: Don't make more here")
  })

  it('adds the class it is given to the group', () => {
    render(<RuleIcons rule={{ importOff: true }} rootPlan={plan} testId="icons" iconTestId="icon" className="gap-1.5 ml-1" />)
    expect(screen.getByTestId('icons')).toHaveClass('gap-1.5', 'ml-1', 'text-teal-300')
  })
})
