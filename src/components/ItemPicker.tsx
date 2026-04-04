import { useState, useEffect, useRef } from 'react'
import { useGameDataStore, selectGameData } from '../store/gameDataStore'
import type { Item } from '../data/types'

// ---------------------------------------------------------------------------
// Fuzzy matching — case-insensitive substring on name or id
// ---------------------------------------------------------------------------

function matches(query: string, item: Item): boolean {
  if (!query) return true
  const q = query.toLowerCase()
  return item.name.toLowerCase().includes(q) || item.id.toLowerCase().includes(q)
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface ItemPickerProps {
  onSelect: (itemId: string) => void
  onClose: () => void
}

export function ItemPicker({ onSelect, onClose }: ItemPickerProps) {
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

  const items = gameData
    ? Object.values(gameData.items).filter(item => matches(query, item))
    : []

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
            placeholder={gameData ? 'Search items…' : 'No game data loaded'}
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
          {gameData && items.length === 0 && (
            <li className="px-4 py-3 text-gray-500 text-sm">No items match</li>
          )}
          {items.map(item => (
            <li key={item.id}>
              <button
                className="w-full text-left px-4 py-2 text-sm text-gray-200 hover:bg-gray-800 focus:bg-gray-800 outline-none"
                onClick={() => { onSelect(item.id); onClose() }}
              >
                <span className="font-medium">{item.name}</span>
                <span className="text-gray-500 ml-2 text-xs">{item.id}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
