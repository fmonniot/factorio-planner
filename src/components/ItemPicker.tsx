import { useState, useEffect, useMemo, useRef } from 'react'
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
// Recipe detail panel — shown on hover/focus of a recipe slot
// ---------------------------------------------------------------------------

function fmtAmount(amount: number): string {
  if (Number.isInteger(amount)) return String(amount)
  return amount.toFixed(2)
}

function ItemRow({
  iconPath, name, amount, probability,
}: { iconPath: string | undefined; name: string; amount: number; probability?: number }) {
  const prob = probability ?? 1
  return (
    <div className="flex items-center gap-2 py-1">
      {iconPath
        ? <img src={iconUrl(iconPath)} alt={name} className="w-6 h-6 object-contain shrink-0" />
        : <span className="w-6 h-6 shrink-0" />
      }
      <span className="font-semibold text-gray-100 shrink-0">
        {fmtAmount(amount)}{prob < 1 ? ` ×${prob}` : ''} ×
      </span>
      <span className="text-gray-300 truncate">{name}</span>
    </div>
  )
}

function RecipeDetailPanel({ recipeId, gameData }: { recipeId: string; gameData: GameData }) {
  const recipe = gameData.recipes[recipeId]
  if (!recipe) return null

  return (
    <div
      data-testid="recipe-detail-panel"
      className="w-72 bg-gray-900 border border-gray-700 rounded-lg shadow-2xl flex flex-col text-sm overflow-hidden"
    >
      {/* Header */}
      <div className="px-3 py-2 bg-gray-800 border-b border-gray-700">
        <span className="font-semibold text-gray-100">{recipe.name}</span>
        <span className="text-gray-500"> (Recipe)</span>
      </div>

      {/* Ingredients */}
      <div className="px-3 py-2 border-b border-gray-800">
        <div className="text-gray-200 font-bold mb-1">Ingredients:</div>
        {recipe.ingredients.map((ing, i) => {
          const item = gameData.items[ing.itemId]
          return (
            <ItemRow
              key={i}
              iconPath={item?.iconPath}
              name={item?.name ?? ing.itemId}
              amount={ing.amount}
            />
          )
        })}
        {/* Crafting time as the last row */}
        <div className="flex items-center gap-2 py-1 text-gray-400">
          <span className="w-6 h-6 shrink-0 flex items-center justify-center">⏱</span>
          <span className="font-semibold text-gray-100 shrink-0">{recipe.craftingTime} s</span>
          <span className="text-gray-400">Crafting time</span>
        </div>
      </div>

      {/* Products */}
      {recipe.products.length > 0 && (
        <div className="px-3 py-2 border-b border-gray-800">
          <div className="text-gray-200 font-bold mb-1">Products:</div>
          {recipe.products.map((prod, i) => {
            const item = gameData.items[prod.itemId]
            return (
              <ItemRow
                key={i}
                iconPath={item?.iconPath}
                name={item?.name ?? prod.itemId}
                amount={prod.amount}
                probability={prod.probability}
              />
            )
          })}
        </div>
      )}

      {/* Made in */}
      {recipe.madeIn.length > 0 && (
        <div className="px-3 py-2">
          <div className="text-gray-200 font-bold mb-1">Made in:</div>
          {recipe.madeIn.map(machineId => {
            const machine = gameData.machines[machineId]
            return (
              <div key={machineId} className="flex items-center gap-2 py-1">
                {machine?.iconPath
                  ? <img src={iconUrl(machine.iconPath)} alt={machine.name} className="w-6 h-6 object-contain shrink-0" />
                  : <span className="w-6 h-6 shrink-0" />
                }
                <span className="text-gray-300 truncate">{machine?.name ?? machineId}</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Shared modal frame
// ---------------------------------------------------------------------------

function PickerFrame({
  onClose, sidePanel, children, width = 'w-[32rem]',
}: {
  onClose: () => void
  sidePanel?: React.ReactNode
  children: React.ReactNode
  width?: string
}) {
  // Close on Escape.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-start justify-center pt-16 z-50"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}
    >
      {/* Anchor: positions the picker centered while letting the side panel float to the right without shifting layout. */}
      <div className="relative">
        <div className={`bg-gray-900 border border-gray-700 rounded-lg ${width} max-h-[85vh] flex flex-col shadow-2xl`}>
          {children}
        </div>
        {sidePanel && (
          <div className="absolute top-0 left-full ml-3">{sidePanel}</div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Recipes-mode picker
// ---------------------------------------------------------------------------

interface RecipePickerBodyProps {
  gameData: GameData
  filterByItemId?: string
  initialQuery: string
  onSelect: (id: string) => void
  onClose: () => void
}

function RecipePickerBody({ gameData, filterByItemId, initialQuery, onSelect, onClose }: RecipePickerBodyProps) {
  const [query, setQuery] = useState(initialQuery)
  const [showHidden, setShowHidden] = useState(false)
  const [hoveredRecipeId, setHoveredRecipeId] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  // Group recipes by subgroup (fallback to category).
  const groups = useMemo(() => {
    const filtered = Object.values(gameData.recipes)
      .filter(r => showHidden || !r.hidden)
      .filter(r => !filterByItemId || r.products.some(p => p.itemId === filterByItemId))
      .filter(r => matchesRecipe(query, r))

    const byGroup = new Map<string, Recipe[]>()
    for (const r of filtered) {
      const key = r.subgroup || r.category
      const arr = byGroup.get(key) ?? []
      arr.push(r)
      byGroup.set(key, arr)
    }
    for (const arr of byGroup.values()) {
      arr.sort((a, b) => (a.order || a.name).localeCompare(b.order || b.name))
    }
    return [...byGroup.entries()]
      .sort((a, b) => {
        const aMin = a[1].reduce((m, r) => r.order && r.order < m ? r.order : m, '￿')
        const bMin = b[1].reduce((m, r) => r.order && r.order < m ? r.order : m, '￿')
        return aMin.localeCompare(bMin)
      })
  }, [gameData, query, showHidden, filterByItemId])

  const subtitle = filterByItemId
    ? `Choose a recipe to produce '${gameData.items[filterByItemId]?.name ?? filterByItemId}'`
    : 'Choose a recipe'

  const sidePanel = hoveredRecipeId
    ? <RecipeDetailPanel recipeId={hoveredRecipeId} gameData={gameData} />
    : null

  return (
    <PickerFrame onClose={onClose} sidePanel={sidePanel}>
      {/* Header: title + search + close */}
      <div className="p-3 border-b border-gray-700 flex items-center gap-3">
        <h2 className="text-lg font-semibold text-amber-200 shrink-0">Add recipe</h2>
        <input
          ref={inputRef}
          type="text"
          placeholder="Search…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          className="flex-1 bg-gray-800 text-gray-100 px-3 py-1.5 rounded text-sm placeholder-gray-500 outline-none focus:ring-1 focus:ring-blue-500"
        />
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="px-2 py-1 text-gray-400 hover:text-gray-200 leading-none"
        >×</button>
      </div>

      {/* Subtitle */}
      <div className="px-3 py-2 border-b border-gray-700 text-sm text-gray-300">{subtitle}</div>

      {/* Toggle: show hidden recipes */}
      <div className="px-3 py-2 border-b border-gray-700 flex items-center gap-2 text-sm">
        <span className="text-gray-400">Show</span>
        <label className="inline-flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showHidden}
            onChange={e => setShowHidden(e.target.checked)}
            className="accent-amber-400"
          />
          <span className={showHidden ? 'text-amber-300' : 'text-gray-500'}>Hidden recipes</span>
        </label>
      </div>

      {/* Body: grouped rows */}
      <div className="overflow-y-auto flex-1 p-2 space-y-2">
        {groups.length === 0 && (
          <div className="px-2 py-3 text-gray-500 text-sm">No recipes match</div>
        )}
        {groups.map(([groupKey, recipes]) => {
          // Left cell: unique ingredient icons across the row's recipes. Skip
          // ingredients whose iconPath is missing so the cell never falls back
          // to ugly text fragments.
          const ingredientItems: Item[] = []
          const seen = new Set<string>()
          for (const r of recipes) {
            for (const ing of r.ingredients) {
              if (seen.has(ing.itemId)) continue
              const it = gameData.items[ing.itemId]
              if (it?.iconPath) {
                ingredientItems.push(it)
                seen.add(ing.itemId)
              }
            }
          }
          return (
            <div
              key={groupKey}
              data-testid="recipe-group"
              data-subgroup={groupKey}
              className="bg-gray-800 border border-gray-700 rounded p-2 flex items-start gap-3"
            >
              {/* Left: ingredient icons (max 3 — fits one row in w-20) */}
              <div className="w-20 shrink-0 flex flex-wrap gap-0.5 justify-center items-center pt-1">
                {ingredientItems.slice(0, 3).map(it => (
                  <img key={it.id} src={iconUrl(it.iconPath)} alt={it.name} title={it.name} className="w-6 h-6 object-contain" />
                ))}
              </div>
              {/* Right: recipe slots */}
              <div className="flex-1 grid grid-cols-6 gap-1">
                {recipes.map(r => {
                  // Pick the first product (main first) that actually has an icon.
                  const candidates = [r.mainProduct, ...r.products.map(p => p.itemId)]
                    .filter((id): id is string => !!id)
                  const product = candidates
                    .map(id => gameData.items[id])
                    .find(it => it?.iconPath)
                  return (
                    <button
                      key={r.id}
                      type="button"
                      data-testid="recipe-slot"
                      data-recipe-id={r.id}
                      title={r.name}
                      onClick={() => { onSelect(r.id); onClose() }}
                      onMouseEnter={() => setHoveredRecipeId(r.id)}
                      onMouseLeave={() => setHoveredRecipeId(null)}
                      onFocus={() => setHoveredRecipeId(r.id)}
                      onBlur={() => setHoveredRecipeId(null)}
                      className="aspect-square flex items-center justify-center bg-green-900/40 hover:bg-green-700/60 border border-green-800/60 rounded outline-none focus:ring-1 focus:ring-blue-500"
                    >
                      {product
                        ? <img src={iconUrl(product.iconPath)} alt={product.name} className="w-8 h-8 object-contain" />
                        : <span className="text-[10px] text-gray-400 leading-tight text-center px-0.5 break-words">{r.name.slice(0, 8)}</span>
                      }
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </PickerFrame>
  )
}

// ---------------------------------------------------------------------------
// Items-mode (goal) picker
// ---------------------------------------------------------------------------

interface ItemPickerBodyProps {
  gameData: GameData
  initialQuery: string
  onSelect: (id: string, rate: number) => void
  onClose: () => void
}

function ItemPickerBody({ gameData, initialQuery, onSelect, onClose }: ItemPickerBodyProps) {
  const [query, setQuery] = useState(initialQuery)
  const [amountText, setAmountText] = useState('60')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  // All non-hidden items matching the search.
  const filteredItems = useMemo(
    () => Object.values(gameData.items).filter(it => !it.hidden && matchesItem(query, it)),
    [gameData, query],
  )

  // Groups present after filtering, sorted by group order.
  const visibleGroups = useMemo(() => {
    const subgroups = gameData.itemSubgroups ?? {}
    const itemGroups = gameData.itemGroups ?? {}
    const presentGroupIds = new Set<string>()
    for (const it of filteredItems) {
      const sg = subgroups[it.subgroup]
      const groupId = sg?.group || ''
      if (groupId) presentGroupIds.add(groupId)
    }
    return [...presentGroupIds]
      .map(id => itemGroups[id])
      .filter((g): g is NonNullable<typeof g> => !!g)
      .sort((a, b) => (a.order || a.id).localeCompare(b.order || b.id))
  }, [filteredItems, gameData])

  // The user's explicit tab selection. May not match a currently-visible group
  // (e.g. after a search narrows the list); in that case we fall through to the
  // first visible group instead of forcing it via an effect.
  const [pinnedGroupId, setPinnedGroupId] = useState<string | null>(null)
  const selectedGroupId = (pinnedGroupId && visibleGroups.find(g => g.id === pinnedGroupId))
    ? pinnedGroupId
    : (visibleGroups[0]?.id ?? null)

  // Items in the selected group, grouped by subgroup. When item-group metadata
  // is missing (e.g. older bundles or test fixtures), fall back to a single
  // bucket so the picker still works.
  const subgroupRows = useMemo(() => {
    const subgroups = gameData.itemSubgroups ?? {}
    const inGroup = selectedGroupId
      ? filteredItems.filter(it => subgroups[it.subgroup]?.group === selectedGroupId)
      : filteredItems
    const bySubgroup = new Map<string, Item[]>()
    for (const it of inGroup) {
      const key = it.subgroup || '(none)'
      const arr = bySubgroup.get(key) ?? []
      arr.push(it)
      bySubgroup.set(key, arr)
    }
    for (const arr of bySubgroup.values()) {
      arr.sort((a, b) => (a.order || a.name).localeCompare(b.order || b.name))
    }
    return [...bySubgroup.entries()]
      .sort((a, b) => {
        const aOrder = subgroups[a[0]]?.order ?? a[0]
        const bOrder = subgroups[b[0]]?.order ?? b[0]
        return aOrder.localeCompare(bOrder)
      })
  }, [filteredItems, selectedGroupId, gameData])

  function parseAmount(): number | null {
    const v = parseFloat(amountText)
    return Number.isFinite(v) && v > 0 ? v : null
  }

  function pick(itemId: string) {
    setSelectedId(itemId)
    const amount = parseAmount()
    if (amount === null) return
    onSelect(itemId, amount)
    onClose()
  }

  function submit() {
    if (!selectedId) return
    const amount = parseAmount()
    if (amount === null) return
    onSelect(selectedId, amount)
    onClose()
  }

  return (
    <PickerFrame onClose={onClose} width="w-[32rem]">
      {/* Header */}
      <div className="p-3 border-b border-gray-700 flex items-center gap-3">
        <h2 className="text-lg font-semibold text-amber-200 shrink-0">Add product</h2>
        <input
          ref={inputRef}
          type="text"
          placeholder="Search…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          className="flex-1 bg-gray-800 text-gray-100 px-3 py-1.5 rounded text-sm placeholder-gray-500 outline-none focus:ring-1 focus:ring-blue-500"
        />
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="px-2 py-1 text-gray-400 hover:text-gray-200 leading-none"
        >×</button>
      </div>

      {/* Amount field */}
      <div className="px-3 py-2 border-b border-gray-700 flex items-center gap-3 text-sm">
        <label className="text-gray-300">
          Amount
          <input
            type="number"
            min="0"
            step="any"
            value={amountText}
            onChange={e => setAmountText(e.target.value)}
            aria-label="Amount"
            className="ml-2 w-24 bg-gray-800 text-gray-100 px-2 py-1 rounded outline-none focus:ring-1 focus:ring-blue-500"
          />
        </label>
        <span className="text-gray-500">/min</span>
      </div>

      {/* Group tabs (hidden when bundle has no group metadata) */}
      {visibleGroups.length > 0 && (
      <div className="px-2 py-2 border-b border-gray-700 flex flex-wrap gap-1">
        {visibleGroups.map(g => {
          const active = g.id === selectedGroupId
          return (
            <button
              key={g.id}
              type="button"
              data-testid="item-group-tab"
              data-group-id={g.id}
              data-active={active || undefined}
              title={g.name}
              onClick={() => setPinnedGroupId(g.id)}
              className={`p-1 rounded border ${active ? 'bg-amber-900/40 border-amber-600' : 'bg-gray-800 border-gray-700 hover:bg-gray-700'}`}
            >
              {g.iconPath
                ? <img src={iconUrl(g.iconPath)} alt={g.name} className="w-7 h-7 object-contain" />
                : <span className="px-2 text-xs text-gray-200">{g.name.slice(0, 4)}</span>
              }
            </button>
          )
        })}
      </div>
      )}

      {/* Slot grid */}
      <div className="overflow-y-auto flex-1 p-2 space-y-2">
        {subgroupRows.length === 0 && (
          <div className="px-2 py-3 text-gray-500 text-sm">No items match</div>
        )}
        {subgroupRows.map(([sgId, items]) => (
          <div
            key={sgId}
            data-testid="item-subgroup-row"
            data-subgroup={sgId}
            className="grid grid-cols-10 gap-1"
          >
            {items.map(it => {
              const active = it.id === selectedId
              return (
                <button
                  key={it.id}
                  type="button"
                  data-testid="item-slot"
                  data-item-id={it.id}
                  title={it.name}
                  onClick={() => pick(it.id)}
                  className={`aspect-square flex items-center justify-center rounded border outline-none focus:ring-1 focus:ring-blue-500 ${active ? 'bg-amber-800/40 border-amber-600' : 'bg-gray-700 border-gray-600 hover:bg-gray-600'}`}
                >
                  {it.iconPath
                    ? <img src={iconUrl(it.iconPath)} alt={it.name} className="w-7 h-7 object-contain" />
                    : <span className="text-[10px] text-gray-300 leading-tight text-center px-0.5 break-words">{it.name.slice(0, 8)}</span>
                  }
                </button>
              )
            })}
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="px-3 py-2 border-t border-gray-700 flex items-center justify-between">
        <button
          type="button"
          onClick={onClose}
          className="px-3 py-1.5 rounded bg-gray-800 hover:bg-gray-700 text-sm text-gray-200"
        >Cancel</button>
        <button
          type="button"
          onClick={submit}
          disabled={!selectedId || parseAmount() === null}
          className="px-3 py-1.5 rounded bg-emerald-700 hover:bg-emerald-600 disabled:bg-gray-700 disabled:text-gray-500 text-sm text-white"
        >Submit</button>
      </div>
    </PickerFrame>
  )
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

interface BasePickerProps {
  onClose: () => void
  /** Pre-populate the search box. */
  initialQuery?: string
}

interface RecipeModeProps extends BasePickerProps {
  source: 'recipes'
  onSelect: (recipeId: string) => void
  /** When set, only show recipes that produce this item. */
  filterByItemId?: string
}

interface ItemModeProps extends BasePickerProps {
  source?: 'items'
  /** Items mode passes the chosen rate (items/min) alongside the item id. */
  onSelect: (itemId: string, rate: number) => void
}

export type ItemPickerProps = RecipeModeProps | ItemModeProps

export function ItemPicker(props: ItemPickerProps) {
  const gameData = useGameDataStore(selectGameData)

  if (!gameData) {
    return (
      <PickerFrame onClose={props.onClose}>
        <div className="p-4 text-gray-500 text-sm">
          Load game data first (header → Load game data)
        </div>
      </PickerFrame>
    )
  }

  if (props.source === 'recipes') {
    return (
      <RecipePickerBody
        gameData={gameData}
        filterByItemId={props.filterByItemId}
        initialQuery={props.initialQuery ?? ''}
        onSelect={props.onSelect}
        onClose={props.onClose}
      />
    )
  }

  return (
    <ItemPickerBody
      gameData={gameData}
      initialQuery={props.initialQuery ?? ''}
      onSelect={props.onSelect}
      onClose={props.onClose}
    />
  )
}
