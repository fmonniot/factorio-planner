import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WorkspaceMenu } from './WorkspaceMenu'
import { useGameDataStore } from '../store/gameDataStore'
import { usePlansStore } from '../store/plansStore'
import { useBlockStore, makeEmptyBlock } from '../store/blockStore'
import { activateDataSet } from '../store/persistence'
import { makeMenuGameData } from '../test/menuGameData'

const loaded = () => useGameDataStore.setState({
  status: { type: 'loaded', gameData: makeMenuGameData(), sourceId: 'nullius' },
})

beforeEach(() => {
  localStorage.clear()
  usePlansStore.setState({ sourceId: null, index: null })
  const block = makeEmptyBlock('Factory')
  useBlockStore.setState({ blocks: [block], activeBlockId: block.id, horizonTechnologyIds: [], defaultMachineOverrides: {}, history: {} })
  useGameDataStore.setState({ status: { type: 'empty' } })
})

afterEach(() => { usePlansStore.setState({ sourceId: null, index: null }) })

function activate() {
  loaded()
  activateDataSet('nullius')
}

const trigger = () => screen.getByRole('button', { name: /^(Plan: |Choose game data)/ })
const openMenu = () => userEvent.click(trigger())
const planNames = () => usePlansStore.getState().index!.plans.map(p => p.name)

describe('Plans section of the workspace menu', () => {
  it('has no Plans section or action tiles before a data set is active', async () => {
    render(<WorkspaceMenu />)
    await openMenu()
    expect(screen.queryByRole('group', { name: 'Plans' })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'New plan' })).not.toBeInTheDocument()
  })

  it('keeps the trigger enabled and disables the action tiles while game data is loading', async () => {
    activate()
    useGameDataStore.setState({ status: { type: 'loading' } })
    render(<WorkspaceMenu />)
    const loadingTrigger = screen.getByRole('button', { name: 'Plan: Plan 1, loading' })
    expect(loadingTrigger).toBeEnabled()
    await userEvent.click(loadingTrigger)
    for (const name of ['New plan', 'Rename plan', 'Duplicate plan', 'Delete plan']) {
      expect(screen.getByRole('menuitem', { name }), name).toBeDisabled()
    }
    expect(screen.getByRole('menuitemradio', { name: 'Plan 1' })).toBeDisabled()
  })

  it('names its trigger after the active plan', () => {
    activate()
    render(<WorkspaceMenu />)
    expect(screen.getByRole('button', { name: 'Plan: Plan 1' })).toBeEnabled()
  })

  it('lists the plans, then the plan actions', async () => {
    activate()
    render(<WorkspaceMenu />)
    await openMenu()
    const names = Array.from(screen.getByRole('menu').querySelectorAll('[role^="menuitem"]')).map(el => el.getAttribute('aria-label') ?? el.textContent?.replace('✓', '').trim())
    expect(names.slice(0, 5)).toEqual(['Plan 1', 'New plan', 'Rename plan', 'Duplicate plan', 'Delete plan'])
    expect(screen.getByRole('menuitemradio', { name: 'Plan 1' })).toHaveAttribute('aria-checked', 'true')
  })

  it('switches plan when a radio item is picked', async () => {
    activate()
    render(<WorkspaceMenu />)
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
      render(<WorkspaceMenu />)
      await openMenu()
      await userEvent.click(screen.getByRole('menuitem', { name: 'Rename plan' }))
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
      render(<WorkspaceMenu />)
      await openMenu()
      await userEvent.click(screen.getByRole('menuitem', { name: 'Delete plan' }))
      expect(screen.getByRole('heading', { name: 'Delete plan "Plan 1"?' })).toBeInTheDocument()
      expect(screen.getByText(/An empty plan replaces it\./)).toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
      expect(planNames()).toEqual(['Plan 1'])
    })

    it('deletes after confirmation', async () => {
      activate()
      render(<WorkspaceMenu />)
      await openMenu()
      await userEvent.click(screen.getByRole('menuitem', { name: 'New plan' }))
      await openMenu()
      await userEvent.click(screen.getByRole('menuitem', { name: 'Delete plan' }))
      await userEvent.click(screen.getByRole('button', { name: 'Delete plan' }))
      expect(planNames()).toEqual(['Plan 1'])
    })
  })

  it('shows the message when an action is refused', async () => {
    activate()
    render(<WorkspaceMenu />)
    await openMenu()
    await userEvent.click(screen.getByRole('menuitem', { name: 'Rename plan' }))
    const input = screen.getByRole('textbox', { name: 'Plan name' })
    await userEvent.clear(input)
    await userEvent.type(input, 'New name')
    // The loaded game data changes under the open dialog.
    useGameDataStore.setState({ status: { type: 'loaded', gameData: makeMenuGameData(), sourceId: 'kompetenz-seablock' } })
    await userEvent.click(screen.getByRole('button', { name: 'Rename' }))
    expect(screen.getByText('The loaded game data changed; pick the file again.')).toBeInTheDocument()
    expect(planNames()).toEqual(['Plan 1'])
    await userEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByText('The loaded game data changed; pick the file again.')).not.toBeInTheDocument()
  })
})
