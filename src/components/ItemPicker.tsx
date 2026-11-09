import { useState, useEffect, useMemo, useRef } from 'react'
import { useGameDataStore, selectGameData } from '../store/gameDataStore'
import { useHorizon } from '../store/horizon'
import { Icon } from './Icon'
import { TechCost } from './TechCost'
import { TechIcon } from './TechIcon'
import { recipeUnlock, withinHorizon } from '../data/horizon'
import { recipeIconItem } from '../data/recipeIcon'
import { recipeMakes } from '../data/recipeProducts'
import { groupPowerRecipes, powerInputItemId, type RecipeEntry } from '../data/powerFuelGroups'
import { ENERGY_ITEM_IDS, isEnergyItem } from '../data/electricity'
import { fmtTemperatureRange } from './factory/temperature'
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
  // Tiny amounts (nuclear fuel per second) would round to 0.00.
  if (amount > 0 && amount < 0.01) return amount.toPrecision(2)
  return amount.toFixed(2)
}

function ItemRow({
  iconPath, name, amount, probability, temperature,
}: { iconPath: string | undefined; name: string; amount: number; probability?: number; temperature?: string }) {
  const prob = probability ?? 1
  return (
    <div className="flex items-center gap-2 py-1">
      {iconPath
        ? <Icon iconPath={iconPath} alt={name} className="w-6 h-6 object-contain shrink-0" />
        : <span className="w-6 h-6 shrink-0" />
      }
      <span className="font-semibold text-gray-100 shrink-0">
        {fmtAmount(amount)}{prob < 1 ? ` ×${prob}` : ''} ×
      </span>
      <span className="text-gray-300 truncate">{name}</span>
      {temperature && (
        <span data-testid="recipe-detail-temperature" className="shrink-0 text-orange-300 text-xs tabular-nums">
          {temperature}
        </span>
      )}
    </div>
  )
}

function UnlockSection({ recipeId, gameData, bordered, inside }: {
  recipeId: string; gameData: GameData; bordered: boolean; inside: ReadonlySet<string> | null
}) {
  const unlock = recipeUnlock(gameData, recipeId, inside)
  if (!unlock) return null
  return (
    <div
      data-testid="recipe-unlock"
      data-unlock-kind={unlock.kind}
      className={bordered ? 'px-3 py-2 border-t border-gray-800' : 'px-3 py-2'}
    >
      <div className="text-gray-200 font-bold mb-1">Unlocked by:</div>
      {unlock.kind === 'start' && <div className="py-1 text-gray-400">Available from the start</div>}
      {unlock.kind === 'fuel' && (
        <div className="py-1 text-gray-400">
          Needs {unlock.itemIds.map(id => gameData.items[id]?.name ?? id).join(', ')}, not yet available
        </div>
      )}
      {unlock.kind === 'none' && (
        <div className="py-1 text-gray-400">No technology unlocks this recipe</div>
      )}
      {unlock.kind === 'technologies' && unlock.technologies.map(t => (
        <div key={t.id} data-testid="recipe-unlock-tech" data-tech-id={t.id} className="flex items-center gap-2 py-1">
          <TechIcon tech={t} className="w-6 h-6 text-xs" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-gray-300">{t.name}</span>
            <TechCost cost={t.cost} trigger={t.trigger} lookup={gameData} tooltip showTime={false} />
          </span>
        </div>
      ))}
    </div>
  )
}

function RecipeDetailPanel({ recipeId, gameData, inside, machineIds }: {
  recipeId: string
  gameData: GameData
  inside: ReadonlySet<string> | null
  /** Machines inside the research horizon; null = no limit. */
  machineIds: ReadonlySet<string> | null
}) {
  const recipe = gameData.recipes[recipeId]
  if (!recipe) return null
  // Power recipes keep their full list: the exporter gives each exactly one machine, which is gated through
  // its placing item rather than the horizon. Other machines must be inside the horizon and, as for the
  // planner's default machine, not hidden.
  const madeIn = recipe.power || machineIds === null
    ? recipe.madeIn
    : recipe.madeIn.filter(id => withinHorizon(machineIds, id) && !gameData.machines[id]?.hidden)
  const hasMadeInBlock = recipe.madeIn.length > 0

  return (
    <div
      data-testid="recipe-detail-panel"
      className="w-72 bg-gray-900 border border-gray-700 rounded-lg shadow-2xl flex flex-col text-sm overflow-hidden"
    >
      {/* Header */}
      <div className="px-3 py-2 bg-gray-800 border-b border-gray-700">
        <span className="font-semibold text-gray-100">{recipe.name}</span>
        <span className="text-gray-400"> (Recipe)</span>
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
              temperature={fmtTemperatureRange(ing.minimumTemperature, ing.maximumTemperature)}
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
                temperature={fmtTemperatureRange(prod.temperature, prod.temperature)}
              />
            )
          })}
        </div>
      )}

      {/* Made in */}
      {hasMadeInBlock && (
        <div className="px-3 py-2">
          <div className="text-gray-200 font-bold mb-1">Made in:</div>
          {madeIn.length === 0 && (
            <div className="text-gray-400 py-1">No machine inside the research horizon</div>
          )}
          {madeIn.map(machineId => {
            const machine = gameData.machines[machineId]
            return (
              <div key={machineId} className="flex items-center gap-2 py-1">
                {machine?.iconPath
                  ? <Icon iconPath={machine.iconPath} alt={machine.name} className="w-6 h-6 object-contain shrink-0" />
                  : <span className="w-6 h-6 shrink-0" />
                }
                <span className="text-gray-300 truncate">{machine?.name ?? machineId}</span>
              </div>
            )
          })}
        </div>
      )}

      {/* Unlocked by */}
      <UnlockSection recipeId={recipe.id} gameData={gameData} bordered={hasMadeInBlock} inside={inside} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Shared modal frame
// ---------------------------------------------------------------------------

/** The slot grid of the pickers: fewer columns on narrow viewports. */
const PICKER_GRID = 'grid grid-cols-6 sm:grid-cols-8 md:grid-cols-10 gap-1'

function PickerFrame({
  onClose, onEscape, sidePanel, children, width = 'w-[32rem]',
}: {
  onClose: () => void
  /** Escape steps back instead of closing (a drill-in view is open). */
  onEscape?: () => void
  sidePanel?: React.ReactNode
  children: React.ReactNode
  width?: string
}) {
  // Close on Escape (or step back one level when the caller has a drill-in view open).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') (onEscape ?? onClose)()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, onEscape])

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-start justify-center pt-4 md:pt-16 z-50"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}
    >
      {/* Anchor: positions the picker centered while letting the side panel float to the right without shifting layout. */}
      <div className="relative">
        <div className={`bg-gray-900 border border-gray-700 rounded-lg ${width} max-w-[calc(100vw-1rem)] max-h-[85dvh] flex flex-col shadow-2xl`}>
          {children}
        </div>
        {sidePanel && (
          <div className="hidden xl:block absolute top-0 left-full ml-3">{sidePanel}</div>
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
  consumesItemId?: string
  /** Recipes that already have a row where the new one would go: shown disabled ("already in <where>"). */
  presentRecipes?: { ids: ReadonlySet<string>; where: string }
  initialQuery: string
  onSelect: (id: string) => void
  onClose: () => void
}

function RecipePickerBody({ gameData, filterByItemId, consumesItemId, presentRecipes, initialQuery, onSelect, onClose }: RecipePickerBodyProps) {
  const [query, setQuery] = useState(initialQuery)
  const [showHidden, setShowHidden] = useState(false)
  const [showBeyondHorizon, setShowBeyondHorizon] = useState(false)
  const [hoveredRecipeId, setHoveredRecipeId] = useState<string | null>(null)
  const [pinnedGroupId, setPinnedGroupId] = useState<string | null>(null)
  // The machine whose fuels are listed in place of the groups (the drill-in fuel view).
  const [openMachineId, setOpenMachineId] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const backRef = useRef<HTMLButtonElement>(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  const horizon = useHorizon(gameData)
  const available = horizon.recipeIds

  // Recipes that pass all filters (hidden toggle, item filter, search, research
  // horizon; hidden recipes are exempt), and how many the horizon alone removed.
  const { filteredRecipes, outsideHorizonCount } = useMemo(() => {
    const matching = Object.values(gameData.recipes)
      .filter(r => showHidden || !r.hidden)
      .filter(r => !filterByItemId || recipeMakes(r, filterByItemId))
      .filter(r => !consumesItemId || r.ingredients.some(i => i.itemId === consumesItemId))
      .filter(r => matchesRecipe(query, r))
    // Hidden recipes are never part of research progression: the horizon only applies to the others.
    // Ticking "Beyond research horizon" lifts the filter for this picker session only.
    const inside = available && !showBeyondHorizon ? matching.filter(r => r.hidden || available.has(r.id)) : matching
    return { filteredRecipes: inside, outsideHorizonCount: matching.length - inside.length }
  }, [gameData, showHidden, filterByItemId, consumesItemId, query, available, showBeyondHorizon])

  // Top-level item-groups present after filtering, sorted by group order.
  const visibleGroups = useMemo(() => {
    const subgroups = gameData.itemSubgroups ?? {}
    const itemGroups = gameData.itemGroups ?? {}
    const presentGroupIds = new Set<string>()
    for (const r of filteredRecipes) {
      const groupId = subgroups[r.subgroup]?.group || ''
      if (groupId) presentGroupIds.add(groupId)
    }
    return [...presentGroupIds]
      .map(id => itemGroups[id])
      .filter((g): g is NonNullable<typeof g> => !!g)
      .sort((a, b) => (a.order || a.id).localeCompare(b.order || b.id))
  }, [filteredRecipes, gameData])

  const selectedGroupId = (pinnedGroupId && visibleGroups.find(g => g.id === pinnedGroupId))
    ? pinnedGroupId
    : (visibleGroups[0]?.id ?? null)

  // Recipes in the selected group, bucketed by subgroup. Each bucket renders
  // as its own grid container so subgroup boundaries naturally produce row
  // breaks; small subgroups fit on one line, large ones wrap.
  const subgroupRows = useMemo(() => {
    const subgroups = gameData.itemSubgroups ?? {}
    const inGroup = selectedGroupId
      ? filteredRecipes.filter(r => subgroups[r.subgroup]?.group === selectedGroupId)
      : filteredRecipes
    const bySubgroup = new Map<string, Recipe[]>()
    for (const r of inGroup) {
      const key = r.subgroup || r.category || '(none)'
      const arr = bySubgroup.get(key) ?? []
      arr.push(r)
      bySubgroup.set(key, arr)
    }
    for (const arr of bySubgroup.values()) {
      arr.sort((a, b) => (a.order || a.name).localeCompare(b.order || b.name))
    }
    const sortedBuckets = [...bySubgroup.entries()].sort((a, b) => {
      const aOrder = subgroups[a[0]]?.order ?? a[0]
      const bOrder = subgroups[b[0]]?.order ?? b[0]
      return aOrder.localeCompare(bOrder)
    })
    // Power recipes of one machine (one per fuel) collapse into a fuel group; this runs after filtering,
    // so a search or item filter that leaves a single fuel gives a plain slot. It runs over the whole tab,
    // not per subgroup, so a machine whose recipes span subgroups still has one group; the group sits in
    // the subgroup of its first recipe.
    const keyOf = (r: Recipe) => r.subgroup || r.category || '(none)'
    const rows = new Map<string, RecipeEntry[]>(sortedBuckets.map(([sgId]) => [sgId, []]))
    for (const e of groupPowerRecipes(sortedBuckets.flatMap(([, recipes]) => recipes))) {
      rows.get(keyOf(e.kind === 'recipe' ? e.recipe : e.recipes[0]))?.push(e)
    }
    return sortedBuckets.map(([sgId]): [string, RecipeEntry[]] => [sgId, rows.get(sgId) ?? []]).filter(([, es]) => es.length > 0)
  }, [filteredRecipes, selectedGroupId, gameData])

  // The fuel group being browsed; undefined once a search or tab change leaves fewer than two fuels of it.
  const openGroup = openMachineId
    ? subgroupRows.flatMap(([, entries]) => entries).find(
        (e): e is Extract<RecipeEntry, { kind: 'fuel-group' }> => e.kind === 'fuel-group' && e.machineId === openMachineId,
      )
    : undefined
  // Drop a stale choice so that clearing the search does not reopen the fuel view by surprise.
  // The button that was hovered unmounts without a mouseleave, so the hover goes too.
  if (openMachineId && !openGroup) { setOpenMachineId(null); setHoveredRecipeId(null) }

  // The fuel view unmounts the focused group slot; put focus on Back so Escape and Tab stay in the picker.
  useEffect(() => { if (openGroup) backRef.current?.focus() }, [openGroup?.machineId]) // eslint-disable-line react-hooks/exhaustive-deps

  function closeFuelView() { setHoveredRecipeId(null); setOpenMachineId(null) }

  const subtitle = consumesItemId
    ? `Choose a recipe that consumes '${gameData.items[consumesItemId]?.name ?? consumesItemId}'`
    : filterByItemId
      ? `Choose a recipe to produce '${gameData.items[filterByItemId]?.name ?? filterByItemId}'`
      : 'Choose a recipe'

  const sidePanel = hoveredRecipeId
    ? <RecipeDetailPanel recipeId={hoveredRecipeId} gameData={gameData} inside={available} machineIds={showBeyondHorizon ? null : horizon.machineIds} />
    : null

  // Skip the tab strip when there's no choice to make (zero or one group).
  const showTabs = visibleGroups.length > 1

  function renderRecipeSlot(r: Recipe, opts?: { fuelView?: boolean }) {
    const product = recipeIconItem(gameData, r)
    // A power recipe shows its machine; its last ingredient (the fuel, or the steam) is the badge.
    const machine = r.power ? gameData.machines[r.madeIn[0]] : undefined
    const inputItem = gameData.items[powerInputItemId(r) ?? '']
    // In the fuel view every slot is the same machine, so the fuel is the icon and there is no badge.
    const mainIcon = opts?.fuelView ? inputItem : machine?.iconPath ? machine : product
    const badgeItem = opts?.fuelView ? undefined : inputItem
    // Revealed by the "Beyond research horizon" checkbox; hidden recipes are exempt from the horizon.
    const beyond = !!available && !r.hidden && !available.has(r.id)
    const present = presentRecipes?.ids.has(r.id) === true
    return (
      <button
        key={r.id}
        type="button"
        data-testid="recipe-slot"
        data-recipe-id={r.id}
        data-beyond-horizon={beyond ? 'true' : undefined}
        data-in-area={present ? 'true' : undefined}
        disabled={present}
        title={present ? `${r.name} (already in ${presentRecipes.where})` : beyond ? `${r.name} (beyond research horizon)` : r.name}
        onClick={() => { onSelect(r.id); onClose() }}
        onMouseEnter={() => setHoveredRecipeId(r.id)}
        onMouseLeave={() => setHoveredRecipeId(null)}
        onFocus={() => setHoveredRecipeId(r.id)}
        onBlur={() => setHoveredRecipeId(null)}
        className={`relative aspect-square flex items-center justify-center border rounded outline-none focus:ring-1 focus:ring-blue-500 ${
          present
            ? 'bg-gray-800/60 border-gray-700 opacity-40 cursor-not-allowed'
            : beyond
            ? 'bg-gray-800/60 border-gray-700 opacity-70 hover:opacity-100'
            : 'bg-green-900/40 hover:bg-green-700/60 border-green-800/60'
        }`}
      >
        {mainIcon?.iconPath
          ? <Icon iconPath={mainIcon.iconPath} alt={mainIcon.name} className="w-7 h-7 object-contain" />
          : <span className="text-[10px] text-gray-400 leading-tight text-center px-0.5 break-words">{(opts?.fuelView ? inputItem?.name ?? r.name : r.name).slice(0, 8)}</span>
        }
        {badgeItem?.iconPath && (
          <Icon
            iconPath={badgeItem.iconPath}
            alt=""
            data-testid="recipe-slot-badge"
            className="absolute right-0 bottom-0 w-3.5 h-3.5 object-contain"
          />
        )}
      </button>
    )
  }

  // One slot for all the fuels of a boiler, generator or reactor; it opens the fuel view. No detail panel.
  function renderGroupSlot(g: Extract<RecipeEntry, { kind: 'fuel-group' }>) {
    const machine = gameData.machines[g.machineId]
    const machineName = machine?.name ?? g.machineId
    const present = g.recipes.every(r => presentRecipes?.ids.has(r.id) === true)
    const beyond = !!available && g.recipes.every(r => !r.hidden && !available.has(r.id))
    return (
      <button
        key={`group:${g.machineId}`}
        type="button"
        data-testid="recipe-group-slot"
        data-machine-id={g.machineId}
        data-recipe-count={g.recipes.length}
        data-beyond-horizon={beyond ? 'true' : undefined}
        data-in-area={present ? 'true' : undefined}
        disabled={present}
        title={present ? `${machineName} (already in ${presentRecipes?.where})` : `${machineName} (${g.recipes.length} recipes)`}
        onClick={() => { setHoveredRecipeId(null); setOpenMachineId(g.machineId) }}
        className={`relative aspect-square flex items-center justify-center border rounded outline-none focus:ring-1 focus:ring-blue-500 ${
          present
            ? 'bg-gray-800/60 border-gray-700 opacity-40 cursor-not-allowed'
            : beyond
            ? 'bg-gray-800/60 border-gray-700 opacity-70 hover:opacity-100'
            : 'bg-green-900/40 hover:bg-green-700/60 border-green-800/60'
        }`}
      >
        {machine?.iconPath
          ? <Icon iconPath={machine.iconPath} alt={machine.name} className="w-7 h-7 object-contain" />
          : <span className="text-[10px] text-gray-400 leading-tight text-center px-0.5 break-words">{machineName.slice(0, 8)}</span>
        }
        <span
          data-testid="recipe-group-count"
          className="absolute right-0 bottom-0 min-w-3.5 px-0.5 rounded-tl bg-gray-900/90 text-[10px] leading-tight text-amber-200 text-center"
        >{g.recipes.length}</span>
      </button>
    )
  }

  function renderFuelView(g: Extract<RecipeEntry, { kind: 'fuel-group' }>) {
    const machine = gameData.machines[g.machineId]
    return (
      <div data-testid="recipe-fuel-view" className="space-y-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            ref={backRef}
            data-testid="recipe-fuel-back"
            onClick={closeFuelView}
            className="px-2 py-1 rounded text-xs text-gray-300 bg-gray-800 hover:bg-gray-700"
          >← Back</button>
          {machine?.iconPath && <Icon iconPath={machine.iconPath} alt={machine.name} className="w-6 h-6 object-contain" />}
          <span className="text-sm text-gray-200">{machine?.name ?? g.machineId}</span>
          <span className="text-sm text-gray-400">Choose a recipe ({g.recipes.length})</span>
        </div>
        <div data-testid="recipe-fuel-grid" className={PICKER_GRID}>
          {g.recipes.map(r => renderRecipeSlot(r, { fuelView: true }))}
        </div>
      </div>
    )
  }

  return (
    <PickerFrame onClose={onClose} onEscape={openGroup ? closeFuelView : undefined} sidePanel={sidePanel}>
      {/* Header: title + search + close */}
      <div className="p-3 border-b border-gray-700 flex items-center gap-3">
        <h2 className="text-lg font-semibold text-amber-200 shrink-0">Add recipe</h2>
        <input
          ref={inputRef}
          type="text"
          placeholder="Search…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          className="flex-1 bg-gray-800 text-gray-100 px-3 py-1.5 rounded text-sm placeholder-gray-400 outline-none focus:ring-1 focus:ring-blue-500"
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
          <span className={showHidden ? 'text-amber-300' : 'text-gray-400'}>Hidden recipes</span>
        </label>
        {available && (
          <label className="inline-flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showBeyondHorizon}
              onChange={e => setShowBeyondHorizon(e.target.checked)}
              className="accent-amber-400"
            />
            <span className={showBeyondHorizon ? 'text-amber-300' : 'text-gray-400'}>Beyond research horizon</span>
          </label>
        )}
      </div>

      {/* Item-group tabs (hidden when there's nothing to switch between) */}
      {showTabs && (
        <div className="px-2 py-2 border-b border-gray-700 flex flex-wrap gap-1">
          {visibleGroups.map(g => {
            const active = g.id === selectedGroupId
            return (
              <button
                key={g.id}
                type="button"
                data-testid="recipe-group-tab"
                data-group-id={g.id}
                data-active={active || undefined}
                title={g.name}
                onClick={() => { setPinnedGroupId(g.id); setHoveredRecipeId(null); setOpenMachineId(null) }}
                className={`p-1 rounded border ${active ? 'bg-amber-900/40 border-amber-600' : 'bg-gray-800 border-gray-700 hover:bg-gray-700'}`}
              >
                {g.iconPath
                  ? <Icon iconPath={g.iconPath} alt={g.name} className="w-7 h-7 object-contain" />
                  : <span className="px-2 text-xs text-gray-200">{g.name.slice(0, 4)}</span>
                }
              </button>
            )
          })}
        </div>
      )}

      {/* Body: subgroup grids, flowing within the selected group */}
      <div className="overflow-y-auto flex-1 p-2 space-y-1">
        {subgroupRows.length === 0 && (
          <div className="px-2 py-3 text-gray-400 text-sm">
            {outsideHorizonCount > 0
              ? `No recipes match within the research horizon (${outsideHorizonCount} outside it)`
              : 'No recipes match'}
          </div>
        )}
        {openGroup ? renderFuelView(openGroup) : subgroupRows.map(([sgId, entries]) => (
          <div
            key={sgId}
            data-testid="recipe-subgroup-row"
            data-subgroup={sgId}
            className={PICKER_GRID}
          >
            {entries.map(e => e.kind === 'recipe' ? renderRecipeSlot(e.recipe) : renderGroupSlot(e))}
          </div>
        ))}
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
  onSelect: (id: string, rate: number | undefined) => void
  onClose: () => void
}

function ItemPickerBody({ gameData, initialQuery, onSelect, onClose }: ItemPickerBodyProps) {
  const [query, setQuery] = useState(initialQuery)
  const [amountText, setAmountText] = useState('60')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  // Items offered under the research horizon; null = no limit.
  const itemSet = useHorizon(gameData).itemIds

  // All non-hidden items matching the search, before the horizon is applied.
  const matching = useMemo(
    () => Object.values(gameData.items).filter(it => !it.hidden && matchesItem(query, it)),
    [gameData, query],
  )
  const filteredItems = useMemo(
    () => (itemSet ? matching.filter(it => itemSet.has(it.id)) : matching),
    [matching, itemSet],
  )
  const outsideHorizonCount = matching.length - filteredItems.length

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

  /** An empty field is a product without extra output (undefined); anything else must be a positive number (else null). */
  function parseAmount(): number | undefined | null {
    if (amountText.trim() === '') return undefined
    const v = parseFloat(amountText)
    return Number.isFinite(v) && v > 0 ? v : null
  }

  const energyNames = ENERGY_ITEM_IDS.filter(id => id in gameData.items).map(id => gameData.items[id].name)

  /** The amount is typed per minute, except for electricity and heat, which are typed in MW (1 MW = 60 units/min). */
  function toRate(itemId: string, amount: number | undefined): number | undefined {
    return amount !== undefined && isEnergyItem(itemId) ? amount * 60 : amount
  }

  function pick(itemId: string) {
    setSelectedId(itemId)
    const amount = parseAmount()
    if (amount === null) return
    onSelect(itemId, toRate(itemId, amount))
    onClose()
  }

  function submit() {
    if (!selectedId) return
    const amount = parseAmount()
    if (amount === null) return
    onSelect(selectedId, toRate(selectedId, amount))
    onClose()
  }

  return (
    <PickerFrame onClose={onClose}>
      {/* Header */}
      <div className="p-3 border-b border-gray-700 flex items-center gap-3">
        <h2 className="text-lg font-semibold text-amber-200 shrink-0">Add product</h2>
        <input
          ref={inputRef}
          type="text"
          placeholder="Search…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          className="flex-1 bg-gray-800 text-gray-100 px-3 py-1.5 rounded text-sm placeholder-gray-400 outline-none focus:ring-1 focus:ring-blue-500"
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
            placeholder="—"
            className="ml-2 w-24 bg-gray-800 text-gray-100 px-2 py-1 rounded outline-none focus:ring-1 focus:ring-blue-500"
          />
        </label>
        <span className="text-gray-400">{energyNames.length > 0 ? `/min (MW for ${energyNames.join(' and ')})` : '/min'}</span>
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
                ? <Icon iconPath={g.iconPath} alt={g.name} className="w-7 h-7 object-contain" />
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
          <div className="px-2 py-3 text-gray-400 text-sm">
            {outsideHorizonCount > 0
              ? `No items match within the research horizon (${outsideHorizonCount} outside it)`
              : 'No items match'}
          </div>
        )}
        {subgroupRows.map(([sgId, items]) => (
          <div
            key={sgId}
            data-testid="item-subgroup-row"
            data-subgroup={sgId}
            className={PICKER_GRID}
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
                    ? <Icon iconPath={it.iconPath} alt={it.name} className="w-7 h-7 object-contain" />
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
  /** When set, only show recipes that take this item as an ingredient. */
  consumesItemId?: string
  /** Recipes that already have a row where the new one would go: shown disabled ("already in <where>"). */
  presentRecipes?: { ids: ReadonlySet<string>; where: string }
}

interface ItemModeProps extends BasePickerProps {
  source?: 'items'
  /** Items mode passes the chosen rate (items/min) alongside the item id. */
  onSelect: (itemId: string, rate: number | undefined) => void
}

export type ItemPickerProps = RecipeModeProps | ItemModeProps

export function ItemPicker(props: ItemPickerProps) {
  const gameData = useGameDataStore(selectGameData)

  if (!gameData) {
    return (
      <PickerFrame onClose={props.onClose}>
        <div className="p-4 text-gray-400 text-sm">
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
        consumesItemId={props.consumesItemId}
        presentRecipes={props.presentRecipes}
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
