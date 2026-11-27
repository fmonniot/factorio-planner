import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DataSetPicker } from './DataSetPicker'
import { useGameDataStore } from '../../store/gameDataStore'
import { useUiStore } from '../../store/uiStore'
import { clearDataSetInfoCache } from '../useDataSetInfos'

const INFOS: Record<string, unknown> = {
  nullius: { factorioVersion: '2.0.76', modSet: { base: '2.0.76', nullius: '2.0.4', flib: '0.14.2' }, recipeCount: 2033 },
  'kompetenz-seablock': { factorioVersion: '2.0.77', modSet: { base: '2.0.77', 'elevated-rails': '2.0.77', SeaBlock: '0.6.0' }, recipeCount: 1 },
}

function stubInfoFetch(respond: (url: string) => Response | Promise<Response>) {
  vi.stubGlobal('fetch', vi.fn((url: string) => Promise.resolve(respond(url))))
}
const serveInfos = () => stubInfoFetch(url => {
  const id = Object.keys(INFOS).find(k => url.includes(`/${k}/`))
  return id ? Response.json(INFOS[id]) : new Response('', { status: 404 })
})

beforeEach(() => {
  clearDataSetInfoCache()
  useGameDataStore.setState({ status: { type: 'empty' } })
  useUiStore.setState({ dataSetRequest: null })
  serveInfos()
})
afterEach(() => vi.unstubAllGlobals())

describe('DataSetPicker', () => {
  it('lists each bundled data set with its versions before anything is loaded', async () => {
    render(<DataSetPicker />)
    const nullius = screen.getByRole('button', { name: 'Nullius' })
    expect(await screen.findByText('Factorio 2.0.76 · 2 mods · 2033 recipes')).toBeInTheDocument()
    expect(nullius).toHaveAccessibleDescription('2.0.4 Factorio 2.0.76 · 2 mods · 2033 recipes')
    // Built-in mods are not counted; one recipe is singular.
    expect(await screen.findByText('Factorio 2.0.77 · 1 mod · 1 recipe')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Seablock' })).toHaveAccessibleDescription('0.6.0 Factorio 2.0.77 · 1 mod · 1 recipe')
  })

  it('asks for the data set picked', async () => {
    render(<DataSetPicker />)
    await userEvent.click(screen.getByRole('button', { name: 'Seablock' }))
    expect(useUiStore.getState().dataSetRequest).toMatchObject({ id: 'kompetenz-seablock' })
  })

  it('still lists a data set whose info cannot be read, and ignores an info of the wrong shape', async () => {
    stubInfoFetch(url => (url.includes('/nullius/') ? Response.json({ nope: true }) : new Response('', { status: 500 })))
    render(<DataSetPicker />)
    await new Promise(r => setTimeout(r, 0))
    expect(screen.getByRole('button', { name: 'Nullius' })).toHaveAccessibleDescription('')
    expect(screen.getByRole('button', { name: 'Seablock' })).toBeEnabled()
    expect(screen.queryByText(/Factorio 2/)).not.toBeInTheDocument()
  })

  it('shows the error of a failed load and still lets the pick be retried', async () => {
    useGameDataStore.setState({ status: { type: 'error', message: 'Invalid JSON: nope' } })
    render(<DataSetPicker />)
    expect(screen.getByRole('alert')).toHaveTextContent('Invalid JSON: nope')
    await userEvent.click(screen.getByRole('button', { name: 'Nullius' }))
    expect(useUiStore.getState().dataSetRequest).toMatchObject({ id: 'nullius' })
  })

  it('disables the choices while a data set loads', () => {
    useGameDataStore.setState({ status: { type: 'loading' } })
    render(<DataSetPicker />)
    expect(screen.getByRole('button', { name: 'Nullius' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Seablock' })).toBeDisabled()
  })
})
