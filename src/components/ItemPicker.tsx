import { useState, useEffect, useRef } from 'react'
import { useGameDataStore, selectGameData } from '../store/gameDataStore'
import type { Item, Recipe } from '../data/types'

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
// Component
// ---------------------------------------------------------------------------

interface ItemPickerProps {
  onSelect: (id: string) => void
  onClose: () => void
  /** Whether to search items (default) or recipes. */
  source?: 'items' | 'recipes'
}

export function ItemPicker({ onSelect, onClose, source = 'items' }: ItemPickerProps) {
  const [query, setQuery] = useState('')
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
          .filter(r => !r.hidden && matchesRecipe(query, r))
          .map(r => ({ id: r.id, name: r.name }))
      : Object.values(gameData.items)
          .filter(item => !item.hidden && matchesItem(query, item))
          .map(item => ({ id: item.id, name: item.name }))
    : []

  const placeholder = gameData
    ? source === 'recipes' ? 'Search recipes…' : 'Search items…'
    : 'No game data loaded'

  const emptyLabel = source === 'recipes' ? 'No recipes match' : 'No items match'

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-start justify-center pt-24 z-50"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}
    >
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
              >
                <span className="font-medium">{entry.name}</span>
                <span className="text-gray-500 ml-2 text-xs">{entry.id}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
