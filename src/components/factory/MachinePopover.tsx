import type { GameData } from '../../data/types'
import { useBlockStore } from '../../store/blockStore'
import { Popover } from './Popover'
import { iconUrl } from '../../utils/iconUrl'

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
  onOpenEdit: () => void
}

export function MachineCell({
  recipeCategory,
  machineId,
  machineCountCeil,
  gameData,
  onOpenEdit,
}: MachineCellProps) {
  const resolvedId = machineId ?? gameData.defaultMachines[recipeCategory]
  const machine = resolvedId ? gameData.machines[resolvedId] : undefined

  return (
    <button
      type="button"
      onClick={onOpenEdit}
      className="relative w-7 h-7 shrink-0 hover:ring-1 hover:ring-gray-500 rounded"
      title={machine?.name ?? 'Edit machine'}
    >
      {machine?.iconPath ? (
        <img
          src={iconUrl(machine.iconPath)}
          alt={machine.name}
          className="w-full h-full object-contain"
        />
      ) : (
        <span className="w-full h-full bg-gray-700 rounded flex items-center justify-center text-[9px] text-gray-400">
          ?
        </span>
      )}
      <span className="absolute bottom-0 right-0 text-[9px] text-white leading-none px-px"
        style={{ textShadow: '0 0 2px #000, 0 0 2px #000' }}>
        {machineCountCeil}
      </span>
    </button>
  )
}
