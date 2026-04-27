import { useState, useEffect, useRef } from 'react'
import { useGameDataStore, selectGameData } from '../store/gameDataStore'
import { iconUrl } from '../utils/iconUrl'
import type { Item, Recipe, GameData } from '../data/types'

// ---------------------------------------------------------------------------
// Fuzzy matching — case-insensitive substring on name or id
// ---------------------------------------------------------------------------

function matchesItem(query: string, item: Item): boolean {
  if (!query) return true
  const q = query.toLowerCase()
  return item.name.toLowerCase().includes(q) || item.id.toLowerCase().includes(q)
}

function matchesRecipe(query: string, recipe: Recipe): boolean {
  if (!query) return true
  const q = query.toLowerCase()
  return recipe.name.toLowerCase().includes(q) || recipe.id.toLowerCase().includes(q)
}

// ---------------------------------------------------------------------------
// Recipe detail panel — shown on hover/focus of a recipe result row
// ---------------------------------------------------------------------------

function fmtAmount(amount: number): string {
  if (Number.isInteger(amount)) return String(amount)
  return amount.toFixed(2)
}

function RecipeDetailPanel({ recipeId, gameData }: { recipeId: string; gameData: GameData }) {
  const recipe = gameData.recipes[recipeId]
  if (!recipe) return null

  const machineName = (() => {
    const defaultId = gameData.defaultMachines[recipe.category]
    if (defaultId) return gameData.machines[defaultId]?.name ?? recipe.category
    return recipe.category
  })()

  return (
    <div className="w-64 bg-gray-900 border border-gray-700 rounded-lg shadow-2xl flex flex-col text-xs overflow-hidden transition-opacity duration-100">
      {/* Header */}
      <div className="px-3 py-2 border-b border-gray-700">
        <div className="font-medium text-gray-100 leading-snug">{recipe.name}</div>
        {recipe.name !== recipe.id && (
          <div className="text-gray-500 mt-0.5">{recipe.id}</div>
        )}
      </div>

      {/* Machine + crafting time */}
      <div className="px-3 py-1.5 border-b border-gray-800 flex items-center gap-2 text-gray-400">
        <span className="truncate">{machineName}</span>
        <span className="shrink-0 text-gray-600">·</span>
        <span className="shrink-0">{recipe.craftingTime}s</span>
      </div>

      {/* Ingredients */}
      {recipe.ingredients.length > 0 && (
        <div className="px-3 py-2 border-b border-gray-800">
          <div className="text-gray-500 font-medium mb-1">Ingredients</div>
          {recipe.ingredients.map((ing, i) => {
            const item = gameData.items[ing.itemId]
            return (
              <div key={i} className="flex items-center gap-1.5 mb-0.5">
                {item?.iconPath
                  ? <img src={iconUrl(item.iconPath)} alt={item.name} title={item.name} className="w-5 h-5 object-contain shrink-0" />
                  : <span className="w-5 h-5 shrink-0" />
                }
                <span className="flex-1 truncate text-gray-300">{item?.name ?? ing.itemId}</span>
                <span className="text-gray-500 shrink-0">{fmtAmount(ing.amount)}</span>
              </div>
            )
          })}
        </div>
      )}

      {/* Products */}
      {recipe.products.length > 0 && (
        <div className="px-3 py-2">
          <div className="text-gray-500 font-medium mb-1">Products</div>
          {recipe.products.map((prod, i) => {
            const item = gameData.items[prod.itemId]
            const prob = prod.probability ?? 1
            return (
              <div key={i} className="flex items-center gap-1.5 mb-0.5">
                {item?.iconPath
                  ? <img src={iconUrl(item.iconPath)} alt={item.name} title={item.name} className="w-5 h-5 object-contain shrink-0" />
                  : <span className="w-5 h-5 shrink-0" />
                }
                <span className="flex-1 truncate text-gray-300">{item?.name ?? prod.itemId}</span>
                <span className={`shrink-0 ${prob < 1 ? 'text-amber-400' : 'text-gray-500'}`}>
                  {prob < 1 ? `${fmtAmount(prod.amount)} ×${prob}` : fmtAmount(prod.amount)}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface ItemPickerProps {
  onSelect: (id: string) => void
  onClose: () => void
  /** Whether to search items (default) or recipes. */
  source?: 'items' | 'recipes'
  /** When set with source="recipes", only show recipes that produce this item. */
  filterByItemId?: string
  /** Pre-populate the search box. */
  initialQuery?: string
}

export function ItemPicker({ onSelect, onClose, source = 'items', filterByItemId, initialQuery }: ItemPickerProps) {
  const [query, setQuery] = useState(initialQuery ?? '')
  const [hoveredRecipeId, setHoveredRecipeId] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const gameData = useGameDataStore(selectGameData)

  // Auto-focus search input on mount.
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Close on Escape.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const results: { id: string; name: string }[] = gameData
    ? source === 'recipes'
      ? Object.values(gameData.recipes)
          .filter(r => !r.hidden)
          .filter(r => !filterByItemId || r.products.some(p => p.itemId === filterByItemId))
          .filter(r => matchesRecipe(query, r))
          .map(r => ({ id: r.id, name: r.name }))
      : Object.values(gameData.items)
          .filter(item => !item.hidden && matchesItem(query, item))
          .map(item => ({ id: item.id, name: item.name }))
    : []

  const placeholder = gameData
    ? filterByItemId
      ? `Recipes producing ${gameData.items[filterByItemId]?.name ?? filterByItemId}…`
      : source === 'recipes' ? 'Search recipes…' : 'Search items…'
    : 'No game data loaded'

  const emptyLabel = source === 'recipes' ? 'No recipes match' : 'No items match'

  // Show detail panel only when hovering a recipe result.
  const showDetail = source === 'recipes' && hoveredRecipeId !== null && gameData !== null

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-start justify-center pt-24 z-50 gap-3"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}
    >
      {/* Picker panel */}
      <div className="bg-gray-900 border border-gray-700 rounded-lg w-96 max-h-96 flex flex-col shadow-2xl">
        {/* Search input */}
        <div className="p-3 border-b border-gray-700">
          <input
            ref={inputRef}
            type="text"
            placeholder={placeholder}
            disabled={!gameData}
            value={query}
            onChange={e => setQuery(e.target.value)}
            className="w-full bg-gray-800 text-gray-100 px-3 py-2 rounded text-sm placeholder-gray-500 outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-40"
          />
        </div>

        {/* Results list */}
        <ul className="overflow-y-auto flex-1 py-1">
          {!gameData && (
            <li className="px-4 py-3 text-gray-500 text-sm">
              Load game data first (header → Load game data)
            </li>
          )}
          {gameData && results.length === 0 && (
            <li className="px-4 py-3 text-gray-500 text-sm">{emptyLabel}</li>
          )}
          {results.map(entry => (
            <li key={entry.id}>
              <button
                className="w-full text-left px-4 py-2 text-sm text-gray-200 hover:bg-gray-800 focus:bg-gray-800 outline-none"
                onClick={() => { onSelect(entry.id); onClose() }}
                onMouseEnter={() => source === 'recipes' && setHoveredRecipeId(entry.id)}
                onMouseLeave={() => source === 'recipes' && setHoveredRecipeId(null)}
                onFocus={() => source === 'recipes' && setHoveredRecipeId(entry.id)}
                onBlur={() => source === 'recipes' && setHoveredRecipeId(null)}
              >
                <span className="font-medium">{entry.name}</span>
                <span className="text-gray-500 ml-2 text-xs">{entry.id}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>

      {/* Recipe detail panel — appears to the right on hover/focus */}
      {showDetail && (
        <div className="mt-0 self-start">
          <RecipeDetailPanel recipeId={hoveredRecipeId!} gameData={gameData!} />
        </div>
      )}
    </div>
  )
}
