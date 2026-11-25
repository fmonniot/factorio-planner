import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { Block, GameData } from '../../data/types'
import { useBlockStore, selectActiveBlock } from '../../store/blockStore'
import { useGameDataStore, selectGameData } from '../../store/gameDataStore'
import { ruleNamesLabel } from './itemSourcing'
import { rulePartsOf } from './sourceRules'
import { sourcesReading } from './sourcesModel'
import { useBlockSourcesModel } from './useSourcesModel'

// ---------------------------------------------------------------------------
// The source rule marker: the small grey dot that says "this item has a source rule with an effect". It only shows the rule:
// it is an image whose tooltip and accessible name are the rule's name ("Import off", "Line L: Receive it first") and, once the
// pointer has been over it, the Sources model's reading of what supplies the item, one line per source. A click on it does
// nothing. The rule is set in the Comes from control, reached from a right-click on an ingredient chip or from the side panel's
// Sources….
// One component for every surface. `SourceRuleMarker` draws it and knows nothing of where it sits or of the stores;
// `ItemSourceRuleMarker` is the same marker for an item of the active block, `BlockSourceRuleMarker` for an item of any
// block. Which items of a block get one is `useSourceRuleItems` (`useSourceRuleItems.ts`).
// ---------------------------------------------------------------------------

/** Shown when there is no rule to name (no active block, no game data). */
const FALLBACK_LABEL = 'Has a source rule'

/**
 * The 6px dot is centred in a 14px box, the size of the pin badge, so the two line up in a badge corner and the
 * box is larger than what is drawn (it carries the tooltip).
 */
const BOX_CLASS = 'w-3.5 h-3.5 shrink-0 inline-flex items-center justify-center rounded-full'
const DOT_CLASS = 'block w-1.5 h-1.5 rounded-full bg-gray-400 ring-1 ring-gray-900'

interface SourceRuleMarkerProps {
  /** The first line of the tooltip and, until the reading arrives, the accessible name: the rule's name. */
  label: string
  /** What supplies the item, one line per source: the second line of the tooltip once the parent has it. */
  reading?: string
  /** Written as `data-item-id`, for the surfaces where the marker is not inside the item's own element. */
  itemId?: string
  /** Called when the pointer is over the marker (idempotent): the parent starts reading the model then. */
  onArm?: () => void
  /** The reader the parent mounts once armed; it draws nothing. */
  children?: ReactNode
}

/**
 * The marker itself: an inline 14px box holding the dot, to be placed by its parent (a badge corner is
 * `absolute -top-1 -right-1`). It is not interactive: a click on it is a click on whatever it sits on.
 */
export function SourceRuleMarker({ label, reading, itemId, onArm, children }: SourceRuleMarkerProps) {
  const name = reading ? `${label}\n${reading}` : (label || FALLBACK_LABEL)
  return (
    <span role="img" aria-label={name} data-tip="" data-testid="source-rule-marker" data-item-id={itemId} onPointerOver={onArm} className={BOX_CLASS}>
      <span className={DOT_CLASS} />
      {children}
    </span>
  )
}

/** Reads the Sources model of the item and hands the reading up. Mounted only once the marker has been hovered. */
function MarkerReading({ block, itemId, areaId, onReading }: { block: Block; itemId: string; areaId?: string; onReading: (reading: string | undefined) => void }) {
  const view = useBlockSourcesModel(block, itemId, areaId)
  const reading = view ? sourcesReading(view.model, view.rate) : undefined
  useEffect(() => { onReading(reading) }, [reading, onReading])
  return null
}

/**
 * The marker of an item of `block` (undefined: none yet), named by its rule and, once hovered, read from the Sources model. It
 * arms once and never disarms: an unarmed marker costs one store read and a cached lookup. `areaId` is the area whose own rule the
 * row follows, when it has one.
 */
function RuleMarker({ block, itemId, gameData, areaId }: { block: Block | undefined; itemId: string; gameData: GameData | undefined; areaId?: string }) {
  const blocks = useBlockStore(s => s.blocks)
  const [armed, setArmed] = useState(false)
  const [reading, setReading] = useState<string>()
  const label = block && gameData ? ruleNamesLabel(rulePartsOf(block, gameData, blocks, itemId, areaId), block.rootPlan) : ''
  return (
    <SourceRuleMarker label={label} reading={reading} itemId={itemId} onArm={() => setArmed(true)}>
      {armed && block && <MarkerReading block={block} itemId={itemId} areaId={areaId} onReading={setReading} />}
    </SourceRuleMarker>
  )
}

/** The marker of an item of the active block; `areaId` is the area whose own rule the row follows, when it has one. Render it only for an item `useSourceRuleItems` holds; it does not test that itself. */
export function ItemSourceRuleMarker({ itemId, gameData, areaId }: { itemId: string; gameData: GameData | undefined; areaId?: string }) {
  return <RuleMarker block={useBlockStore(selectActiveBlock)} itemId={itemId} gameData={gameData} areaId={areaId} />
}

/**
 * `ItemSourceRuleMarker` for the summary strip, whose slots and chips are handed the items and not the game data:
 * it reads the game data from its store.
 */
export function SummarySourceRuleMarker({ itemId }: { itemId: string }) {
  const gameData = useGameDataStore(selectGameData)
  return <ItemSourceRuleMarker itemId={itemId} gameData={gameData} />
}

interface BlockSourceRuleMarkerProps {
  /** The block that holds the rule: any block of the plan. */
  block: Block
  itemId: string
  gameData: GameData | undefined
}

/**
 * The marker of an item of `block`, for the surfaces that show blocks other than the active one (the areas matrix,
 * the block graph). Like the others it does not test that the item has a rule.
 */
export function BlockSourceRuleMarker({ block, itemId, gameData }: BlockSourceRuleMarkerProps) {
  return <RuleMarker block={block} itemId={itemId} gameData={gameData} />
}
