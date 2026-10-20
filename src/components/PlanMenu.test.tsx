import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PlanMenu } from './PlanMenu'
import { useGameDataStore } from '../store/gameDataStore'
import { usePlansStore } from '../store/plansStore'
import { useBlockStore, makeEmptyBlock } from '../store/blockStore'
import { activateDataSet } from '../store/persistence'
import type { GameData } from '../data/types'

const loaded = () => useGameDataStore.setState({
  status: { type: 'loaded', gameData: {} as unknown as GameData, sourceId: 'nullius' },
})

beforeEach(() => {
  localStorage.clear()
  usePlansStore.setState({ sourceId: null, index: null })
  const block = makeEmptyBlock('Factory')
  useBlockStore.setState({ blocks: [block], activeBlockId: block.id, horizonTechnologyIds: [], history: {} })
  useGameDataStore.setState({ status: { type: 'empty' } })
})

afterEach(() => { usePlansStore.setState({ sourceId: null, index: null }) })

function activate() {
  loaded()
  activateDataSet('nullius')
}

const trigger = () => screen.getByRole('button', { name: /^Plan: / })
const openMenu = () => userEvent.click(trigger())
const planNames = () => usePlansStore.getState().index!.plans.map(p => p.name)

describe('PlanMenu', () => {
  it('renders nothing before a data set is active', () => {
    render(<PlanMenu />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('is disabled while game data is loading', () => {
    activate()
    useGameDataStore.setState({ status: { type: 'loading' } })
    render(<PlanMenu />)
    expect(trigger()).toBeDisabled()
  })

  it('names its trigger after the active plan', () => {
    activate()
    render(<PlanMenu />)
    expect(screen.getByRole('button', { name: 'Plan: Plan 1' })).toBeEnabled()
  })

  it('lists the plans, then New plan, Rename…, Duplicate and Delete…', async () => {
    activate()
    render(<PlanMenu />)
    await openMenu()
    const names = Array.from(screen.getByRole('menu').querySelectorAll('[role^="menuitem"]')).map(el => el.textContent?.replace('✓', '').trim())
    expect(names).toEqual(['Plan 1', 'New plan', 'Rename…', 'Duplicate', 'Delete…'])
    expect(screen.getByRole('menuitemradio', { name: 'Plan 1' })).toHaveAttribute('aria-checked', 'true')
  })

  it('switches plan when a radio item is picked', async () => {
    activate()
    render(<PlanMenu />)
    await openMenu()
    await userEvent.click(screen.getByRole('menuitem', { name: 'New plan' }))
    expect(screen.getByRole('button', { name: 'Plan: Plan 2' })).toBeInTheDocument()
    await openMenu()
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'Plan 1' }))
    expect(screen.getByRole('button', { name: 'Plan: Plan 1' })).toBeInTheDocument()
  })

  describe('rename', () => {
    async function openRename() {
      activate()
      render(<PlanMenu />)
      await openMenu()
      await userEvent.click(screen.getByRole('menuitem', { name: 'Rename…' }))
      return screen.getByRole('textbox', { name: 'Plan name' })
    }

    it('submits with Enter', async () => {
      const input = await openRename()
      await userEvent.clear(input)
      await userEvent.type(input, 'Late game{Enter}')
      expect(planNames()).toEqual(['Late game'])
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    })

    it('cancels with Escape', async () => {
      const input = await openRename()
      await userEvent.type(input, 'x{Escape}')
      expect(planNames()).toEqual(['Plan 1'])
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    })

    it('disables Rename for a blank name', async () => {
      const input = await openRename()
      await userEvent.clear(input)
      expect(screen.getByRole('button', { name: 'Rename' })).toBeDisabled()
    })
  })

  describe('delete', () => {
    it('asks first, and Cancel keeps the plan', async () => {
      activate()
      render(<PlanMenu />)
      await openMenu()
      await userEvent.click(screen.getByRole('menuitem', { name: 'Delete…' }))
      expect(screen.getByRole('heading', { name: 'Delete plan "Plan 1"?' })).toBeInTheDocument()
      expect(screen.getByText(/An empty plan replaces it\./)).toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
      expect(planNames()).toEqual(['Plan 1'])
    })

    it('deletes after confirmation', async () => {
      activate()
      render(<PlanMenu />)
      await openMenu()
      await userEvent.click(screen.getByRole('menuitem', { name: 'New plan' }))
      await openMenu()
      await userEvent.click(screen.getByRole('menuitem', { name: 'Delete…' }))
      await userEvent.click(screen.getByRole('button', { name: 'Delete plan' }))
      expect(planNames()).toEqual(['Plan 1'])
    })
  })
})
