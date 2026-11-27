import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NoPlanScreen } from './NoPlanScreen'
import { useGameDataStore } from '../../store/gameDataStore'
import { usePlansStore } from '../../store/plansStore'
import { useUiStore } from '../../store/uiStore'
import { activateDataSet, deletePlan } from '../../store/persistence'
import { makeMenuGameData } from '../../test/menuGameData'

beforeEach(() => {
  localStorage.clear()
  usePlansStore.setState({ sourceId: null, index: null })
  useUiStore.setState({ planImportRequest: null })
  useGameDataStore.setState({ status: { type: 'loaded', gameData: makeMenuGameData(), sourceId: 'nullius' } })
  activateDataSet('nullius')
  deletePlan(usePlansStore.getState().index!.activePlanId!)
})

describe('NoPlanScreen', () => {
  it('says no plan is open and offers a new plan and an import', () => {
    render(<NoPlanScreen />)
    expect(screen.getByRole('heading', { name: 'No plan open' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New plan' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Import plan…' })).toBeEnabled()
  })

  it('New plan opens "Plan 1"', async () => {
    render(<NoPlanScreen />)
    await userEvent.click(screen.getByRole('button', { name: 'New plan' }))
    const index = usePlansStore.getState().index!
    expect(index.plans.map(p => p.name)).toEqual(['Plan 1'])
    expect(index.activePlanId).toBe(index.plans[0].id)
  })

  it('shows why a refused New plan did nothing', async () => {
    render(<NoPlanScreen />)
    useGameDataStore.setState({ status: { type: 'loading' } })
    await userEvent.click(screen.getByRole('button', { name: 'New plan' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Load game data first.')
    expect(usePlansStore.getState().index!.plans).toEqual([])
  })

  it('Import plan… asks the workspace menu to run the import', async () => {
    render(<NoPlanScreen />)
    await userEvent.click(screen.getByRole('button', { name: 'Import plan…' }))
    expect(useUiStore.getState().planImportRequest).not.toBeNull()
  })
})
