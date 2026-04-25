import { useState } from 'react'
import type { GameData } from '../../data/types'
import { useBlockStore } from '../../store/blockStore'
import { Popover } from './Popover'

interface MachinePopoverProps {
  nodeId: string
  recipeId: string
  recipeCategory: string
  currentMachineId: string | undefined
  gameData: GameData
  onClose: () => void
}

export function MachinePopover({
  nodeId,
  recipeId,
  recipeCategory,
  currentMachineId,
  gameData,
  onClose,
}: MachinePopoverProps) {
  const updateNodeMachine = useBlockStore(s => s.updateNodeMachine)
  const updateNodeRecipe = useBlockStore(s => s.updateNodeRecipe)

  const machines = Object.values(gameData.machines)
    .filter(m => !m.hidden && m.craftingCategories.includes(recipeCategory))
    .sort((a, b) => a.name.localeCompare(b.name))

  // Alternate recipes for the primary product of the current recipe
  const recipe = gameData.recipes[recipeId]
  const primaryItemId = recipe?.mainProduct ?? recipe?.products[0]?.itemId
  const altRecipes = primaryItemId
    ? Object.values(gameData.recipes).filter(
        r => !r.hidden && r.id !== recipeId && r.products.some(p => p.itemId === primaryItemId)
      )
    : []

  function selectMachine(machineId: string | undefined) {
    updateNodeMachine(nodeId, machineId)
    onClose()
  }

  function selectRecipe(newRecipeId: string) {
    updateNodeRecipe(nodeId, newRecipeId)
    onClose()
  }

  return (
    <Popover onClose={onClose} className="w-56 p-2 space-y-2 text-xs">
      <div>
        <div className="text-gray-500 text-[10px] uppercase tracking-wide mb-1">Machine</div>
        <div className="space-y-0.5">
          <button
            onClick={() => selectMachine(undefined)}
            className={`w-full text-left px-2 py-1 rounded hover:bg-gray-700 ${!currentMachineId ? 'text-teal-400' : 'text-gray-300'}`}
          >
            Default
          </button>
          {machines.map(m => (
            <button
              key={m.id}
              onClick={() => selectMachine(m.id)}
              className={`w-full text-left px-2 py-1 rounded hover:bg-gray-700 ${
                m.id === currentMachineId ? 'text-teal-400' : 'text-gray-300'
              }`}
            >
              {m.name}
            </button>
          ))}
        </div>
      </div>

      {altRecipes.length > 0 && (
        <div>
          <div className="text-gray-500 text-[10px] uppercase tracking-wide mb-1">Alternate recipe</div>
          <div className="space-y-0.5">
            {altRecipes.map(r => (
              <button
                key={r.id}
                onClick={() => selectRecipe(r.id)}
                className="w-full text-left px-2 py-1 rounded hover:bg-gray-700 text-gray-300"
              >
                {r.name}
              </button>
            ))}
          </div>
        </div>
      )}
    </Popover>
  )
}

// ---------------------------------------------------------------------------
// Trigger wrapper — shows machine count + opens popover on click
// ---------------------------------------------------------------------------

interface MachineCellProps {
  nodeId: string
  recipeId: string
  recipeCategory: string
  machineId: string | undefined
  machineCountCeil: number
  gameData: GameData
}

export function MachineCell({
  nodeId,
  recipeId,
  recipeCategory,
  machineId,
  machineCountCeil,
  gameData,
}: MachineCellProps) {
  const [open, setOpen] = useState(false)
  const resolvedId = machineId ?? gameData.defaultMachines[recipeCategory]
  const machine = resolvedId ? gameData.machines[resolvedId] : undefined

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1 text-xs text-gray-300 hover:text-gray-100"
        title={machine?.name ?? 'Select machine'}
      >
        <span className="font-mono tabular-nums">{machineCountCeil}</span>
        <span className="truncate max-w-[6rem]">{machine?.name ?? '—'}</span>
      </button>

      {open && (
        <MachinePopover
          nodeId={nodeId}
          recipeId={recipeId}
          recipeCategory={recipeCategory}
          currentMachineId={machineId}
          gameData={gameData}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  )
}
