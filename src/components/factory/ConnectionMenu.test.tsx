import { useState } from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ConnectionMenu } from './ConnectionMenu'
import { useBlockStore, makeEmptyBlock } from '../../store/blockStore'
import { useUiStore } from '../../store/uiStore'
import { useGameDataStore } from '../../store/gameDataStore'
import { useSolverStore } from '../../store/solverStore'
import type { Block, GameData } from '../../data/types'

function gameData(): GameData {
  return {
    factorioVersion: '2.0.0',
    modSet: {},
    items: { ore: { id: 'ore', name: 'Ore', type: 'item', iconPath: '', hidden: false } },
    recipes: {
      'ore-synth': {
        id: 'ore-synth', name: 'Ore Synth', category: 'crafting', craftingTime: 1,
        ingredients: [], products: [{ itemId: 'ore', type: 'item', amount: 1 }],
        madeIn: [], allowProductivity: false, hidden: false, mainProduct: 'ore',
      },
    },
    machines: {}, beacons: {}, modules: {}, defaultMachines: {}, technologies: {}, startingRecipes: [],
  } as unknown as GameData
}

/** Main needs ore. A and C make it (C requests it from A, so a request to C would be ignored: blocked); B has none to spare. */
function setup() {
  const make = (id: string, over: Partial<Block> = {}): Block => ({ ...makeEmptyBlock(id), id, ...over })
  const a = make('a', { name: 'Alpha', products: [{ id: 'pa', itemId: 'ore' }] })
  const c = make('c', { name: 'Charlie', products: [{ id: 'pc', itemId: 'ore' }], inputConnections: [{ id: 'k', itemId: 'ore', fromBlockId: 'a' }] })
  const d = make('d', { name: 'Delta', products: [{ id: 'pd', itemId: 'ore' }] })
  useBlockStore.setState({ blocks: [make('main', { name: 'Main' }), a, c, d], activeBlockId: 'main', history: {} })
  useUiStore.setState({ rateUnit: 'min' })
  useGameDataStore.setState({ status: { type: 'loaded', gameData: gameData(), sourceId: 'test' } })
  useSolverStore.setState({ status: { type: 'idle' }, lastResult: undefined, lastResults: {}, flows: [], _setStatus: () => {} })
}

const items = () => screen.getAllByRole('menuitem')
const names = () => items().map(i => i.textContent)

beforeEach(() => setup())

describe('ConnectionMenu keyboard', () => {
  it('does not take focus when it opens, and the first ArrowDown enters it at the first item, ArrowUp at the last', () => {
    const { unmount } = render(<ConnectionMenu itemId="ore" x={10} y={10} onClose={() => {}} onMakeInNewBlock={() => {}} />)
    expect(items().some(i => i === document.activeElement)).toBe(false)
    fireEvent.keyDown(document.body, { key: 'ArrowDown' })
    expect(items()[0]).toHaveFocus()
    unmount()
    render(<ConnectionMenu itemId="ore" x={10} y={10} onClose={() => {}} onMakeInNewBlock={() => {}} />)
    fireEvent.keyDown(document.body, { key: 'ArrowUp' })
    expect(items()[items().length - 1]).toHaveTextContent('Make in a new block')
  })

  it('walks the enabled items in order and wraps, skipping a blocked request', () => {
    render(<ConnectionMenu itemId="ore" x={10} y={10} onClose={() => {}} onMakeInNewBlock={() => {}} />)
    const blocked = screen.getByRole('menuitem', { name: 'Charlie' })
    expect(blocked).toBeDisabled()
    expect(names().filter(n => n !== 'Charlie')).toEqual(['Alpha', 'Delta', 'Make in a new block…'])
    const seen: (string | null)[] = []
    for (let i = 0; i < 4; i++) {
      fireEvent.keyDown(document.activeElement ?? document.body, { key: 'ArrowDown' })
      seen.push(document.activeElement!.textContent)
    }
    expect(seen).toEqual(['Alpha', 'Delta', 'Make in a new block…', 'Alpha'])
  })

  it('Enter on a focused request connects it and closes the menu', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<ConnectionMenu itemId="ore" x={10} y={10} onClose={onClose} onMakeInNewBlock={() => {}} />)
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}')
    const main = useBlockStore.getState().blocks.find(b => b.id === 'main')!
    expect(main.inputConnections).toEqual([expect.objectContaining({ itemId: 'ore', fromBlockId: 'd' })])
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes on Tab once, and gives the focus back to the button that opened it', () => {
    render(<button type="button">Receive from…</button>)
    const opener = screen.getByRole('button', { name: 'Receive from…' })
    opener.focus()
    const onClose = vi.fn()
    render(<ConnectionMenu itemId="ore" x={10} y={10} onClose={onClose} onMakeInNewBlock={() => {}} />)
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' })
    expect(opener).not.toHaveFocus()
    expect(!fireEvent.keyDown(document.activeElement!, { key: 'Tab', cancelable: true }), 'the browser carries on').toBe(false)
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(opener).toHaveFocus()
  })

  it('Escape closes it and gives the focus back to the opener', () => {
    function Host() {
      const [open, setOpen] = useState(false)
      return (
        <div>
          <button type="button" onClick={() => setOpen(true)}>Receive from…</button>
          {open && <ConnectionMenu itemId="ore" x={10} y={10} onClose={() => setOpen(false)} onMakeInNewBlock={() => {}} />}
        </div>
      )
    }
    render(<Host />)
    const opener = screen.getByRole('button', { name: 'Receive from…' })
    opener.focus()
    fireEvent.click(opener)
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' })
    expect(items()[0]).toHaveFocus()
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(opener).toHaveFocus()
  })
})
