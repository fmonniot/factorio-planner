import { useId, useMemo, useState } from 'react'
import { areaIdsOf, areaName as areaNameOf, effectiveAreaRule, storedAreaRule } from '../../data/subPlanTree'
import { blockAreas } from '../../solver/areas'
import { hasProduct } from '../../solver/blockGraph'
import { Segment, Segmented } from '../SegmentedControl'
import { useBlockStore, selectActiveBlock } from '../../store/blockStore'
import { useUiStore } from '../../store/uiStore'
import { useGameDataStore, selectGameData } from '../../store/gameDataStore'
import { COMES_FROM_LABEL, IMPORT_SWITCH, ITEM_SOURCING_CHOICES, LEFTOVER_BLOCK_BUTTON, LEFTOVER_BLOCK_NOTE, LEFTOVER_SWITCH, leftoverTakeNote, ruleLabel, SOURCES_BUTTON_LABEL, makeHereOf, presetOf } from './itemSourcing'
import { noEffectText, ruleId, scopeAreasOf, sourceRules } from './sourceRules'
import { useRemoveSourceRule } from './useRemoveSourceRule'
import { useSourcingSentence } from './useSourcingSentence'
import { SourcesList } from './SourcesList'
import { StripIcon } from './StripIcon'
import type { StripIconName } from './StripIcon'
import { Separator, StripToolbar } from './StripToolbar'
import type { StripAction } from './StripToolbar'
import { MINI_BUTTON_CLASS } from './Switch'
import { anchorOf } from './popoverAnchor'

// ---------------------------------------------------------------------------
// ComesFrom — where an item of the active block comes from: the three presets, the Import switch, the
// sentence for the last solve, and any rule of the item that has no effect, with a button to remove it.
// In a block with areas it has a scope control: the whole block, or one area, whose own rule replaces the block's for its rows.
// It sits in the strip of a selected Ingredients slot (`listInPopover`: the sentence under the bar, then one row of icons, the
// rule group in the middle of the strip's toolbar, then the rows that show only in some cases) and in the Comes from popover
// (`ComesFromPopover`), which holds it for an item that has no slot: the same sentence and row of icons, with the scope control above them. A rule that has nothing to act on yet ("No connection for X.") offers the way forward. The Sources…
// button and its list are at both scopes: the list of an area has one line per supplying area, with a switch.
// ---------------------------------------------------------------------------

const ARROW_STEP: Record<string, 1 | -1> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }

/**
 * The keyboard contract of a radio group: an arrow moves to the next (or previous) preset, wrapping, and
 * chooses it.
 */
function moveWithArrows(e: React.KeyboardEvent<HTMLDivElement>) {
  const step = ARROW_STEP[e.key]
  if (step === undefined) return
  const radios = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]')]
  const from = radios.indexOf(document.activeElement as HTMLButtonElement)
  if (from < 0) return
  e.preventDefault()
  const next = radios[(from + step + radios.length) % radios.length]
  next.focus()
  next.click()
}

/** The icon of each preset of the strip's rule group, in the order of `ITEM_SOURCING_CHOICES`. */
const PRESET_ICONS: StripIconName[] = ['factory', 'inbox', 'branch']

const ICON_BUTTON = 'relative inline-flex h-[22px] w-6 items-center justify-center outline-none focus-visible:ring-2 focus-visible:ring-teal-400 focus-visible:ring-inset'
const LIT = 'bg-teal-900/60 text-teal-200'
const UNLIT = 'text-gray-300 hover:bg-gray-800'

/** An on/off icon button of the strip (`role="switch"`), lit when on; its tooltip says the state, then the rule's help text. */
function IconSwitch({ id, on, label, help, icon, testId, onToggle, disabled = false }: {
  /** Id of the hidden help text that describes the switch. */
  id: string
  on: boolean
  label: string
  help: string
  icon: StripIconName
  testId: string
  onToggle: () => void
  /** Dimmed and inert, still focusable and described (the Leftover switch at area scope: it is the block's rule). */
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      aria-describedby={id}
      aria-disabled={disabled || undefined}
      data-tip={`${label} ${on ? 'on' : 'off'}. ${help}`}
      data-testid={testId}
      onClick={disabled ? undefined : onToggle}
      className={`${ICON_BUTTON} rounded border ${on ? 'border-teal-600' : 'border-gray-700 bg-gray-900'} ${on ? LIT : UNLIT} ${disabled ? 'opacity-40' : ''}`}
    >
      <StripIcon name={icon} />
      <span id={id} className="sr-only">{help}</span>
    </button>
  )
}

export function ComesFrom({ itemId, areaId, initialListOpen = false, listInPopover = false, actions = [] }: {
  itemId: string
  /** The area the control is opened for: it starts on that area's scope when the area has a rule for the item, and offers it. */
  areaId?: string
  /** The Sources list starts open (the popover opened from a strip's Sources… button). */
  initialListOpen?: boolean
  /** The control sits where the list has no room (an Ingredients slot's strip): Sources… opens the Comes from popover with the list open. */
  listInPopover?: boolean
  /** The strip's own actions (Find recipe, Receive from…): they form the left of the toolbar `listInPopover` draws. */
  actions?: StripAction[]
}) {
  const baseId = useId()
  const [listOpen, setListOpen] = useState(initialListOpen)
  const openComesFrom = useUiStore(s => s.openComesFrom)
  const block = useBlockStore(selectActiveBlock)
  const blocks = useBlockStore(s => s.blocks)
  const setMakeHere = useBlockStore(s => s.setMakeHere)
  const toggleImportOff = useBlockStore(s => s.toggleImportOff)
  const toggleLeftoverOff = useBlockStore(s => s.toggleLeftoverOff)
  const setAreaMakeHere = useBlockStore(s => s.setAreaMakeHere)
  const toggleAreaImportOff = useBlockStore(s => s.toggleAreaImportOff)
  const clearAreaRule = useBlockStore(s => s.clearAreaRule)
  const gameData = useGameDataStore(selectGameData)
  const removeRule = useRemoveSourceRule()
  const openConnectionMenu = useUiStore(s => s.openConnectionMenu)
  const areaIds = useMemo(() => (block ? areaIdsOf(block.rootPlan) : new Set<string>()), [block])
  // The scope: undefined is the whole block. It starts on the area when that area has its own rule for the item.
  const [scope, setScope] = useState<string | undefined>(
    () => block && areaId !== undefined && storedAreaRule(block.rootPlan, areaId, itemId) !== undefined ? areaId : undefined,
  )
  // An area whose flag went off is no area: the control falls back to the whole block (an undo brings the area back).
  const area = scope !== undefined && areaIds.has(scope) ? scope : undefined
  const sentence = useSourcingSentence(itemId, gameData, area)

  const unavailable = useMemo(() => {
    if (!block || !gameData) return []
    const blockIds = new Set(blocks.map(b => b.id))
    return sourceRules(block, gameData, blockIds).filter(r => r.itemId === itemId && r.noEffect !== undefined && (r.areaId === area || r.kind === 'leftover-off'))
  }, [block, blocks, gameData, itemId, area])

  if (!block || !gameData) return null

  const name = gameData.items[itemId]?.name ?? itemId
  const stored = area !== undefined ? storedAreaRule(block.rootPlan, area, itemId) : undefined
  const rule = area !== undefined ? effectiveAreaRule(block.rootPlan, block.sourceRules, area, itemId) : block.sourceRules[itemId]
  const preset = presetOf(rule)
  const importOn = !rule?.importOff
  // Leftover is the block's rule alone: an area's control reads it from the block, never from the area's effective rule.
  const leftoverOn = !block.sourceRules[itemId]?.leftoverOff
  // The blocks that take the item from this one (a connection of the item whose source is this block): with Leftover off they
  // get only what the rows here cannot use, unless the item is a product, which turns the connection into a request.
  const takers = leftoverOn || hasProduct(block, itemId)
    ? []
    : blocks.filter(b => b.id !== block.id && b.inputConnections.some(c => c.itemId === itemId && c.fromBlockId === block.id))
  // The areas the scope control offers: the one it was opened for, the one it is on, and those with a rule of their own for the item.
  const scopeAreas = scopeAreasOf(block, itemId, areaId, area)
  const showScope = scopeAreas.length > 0
  // The areas with a rule of their own, for the Ingredients slot's strip (table order).
  const ruledAreas = listInPopover ? (blockAreas(block.rootPlan) ?? []).filter(a => storedAreaRule(block.rootPlan, a.id, itemId) !== undefined) : []

  const takerNotes = takers.map(b => (
    <p key={b.id} data-testid="leftover-take-note" className="text-[11px] leading-snug text-gray-500">{leftoverTakeNote(b.name, name)}</p>
  ))
  const areasButton = area === undefined && ruledAreas.length > 0 && (
    <div className="flex">
      <button
        type="button"
        data-testid="areas-have-rules"
        aria-haspopup="dialog"
        onClick={e => openComesFrom(itemId, anchorOf(e.currentTarget), { areaId: ruledAreas[0].id })}
        className={MINI_BUTTON_CLASS}
      >
        {ruledAreas.length === 1 ? '1 area has its own rule' : `${ruledAreas.length} areas have their own rule`}
      </button>
    </div>
  )
  const noEffectList = unavailable.length > 0 && (
    <ul className="flex flex-col gap-0.5">
      {unavailable.map(rule => (
        <li
          key={ruleId(rule)}
          data-testid="no-effect"
          data-rule={rule.kind}
          data-no-effect={rule.noEffect}
          className="flex items-baseline gap-2 text-[11px] leading-snug text-gray-500"
        >
          <span id={`${baseId}-no-effect-${ruleId(rule)}`} className="min-w-0 flex-1">{noEffectText(rule.noEffect!, name, rule.areaId !== undefined, rule.otherAreaId !== undefined ? areaNameOf(block.rootPlan, rule.otherAreaId) : undefined)}</span>
          <span className="shrink-0 flex items-baseline gap-1">
            {rule.noEffect === 'no-connection' && (
              <button
                type="button"
                data-testid="receive-from"
                aria-describedby={`${baseId}-no-effect-${ruleId(rule)}`}
                title={`Pick the block that sends ${name} to this one`}
                onClick={e => {
                  const r = e.currentTarget.getBoundingClientRect()
                  openConnectionMenu(itemId, r.left, r.bottom)
                }}
                className="bg-gray-900 border border-gray-700 rounded px-1.5 leading-4 text-gray-300 outline-none hover:border-gray-500 focus-visible:ring-2 focus-visible:ring-teal-400"
              >
                Receive from…
              </button>
            )}
            <button
              type="button"
              aria-describedby={`${baseId}-no-effect-${ruleId(rule)}`}
              title={`Remove the ${ruleLabel(rule, block.rootPlan)} rule`}
              onClick={() => removeRule(rule)}
              className="bg-gray-900 border border-gray-700 rounded px-1.5 leading-4 text-gray-300 hover:border-gray-500"
            >
              Remove
            </button>
          </span>
        </li>
      ))}
    </ul>
  )

  // The rule group is the toolbar's middle: the three presets (one radio group named after the item), then the two switches.
  // The name of each is its label; the tooltip adds the help text. In a block with areas it writes the scope's rule.
  const sourcesAction: StripAction = listInPopover
    ? {
        label: SOURCES_BUTTON_LABEL,
        icon: 'layers',
        testId: 'sources-button',
        hasPopup: 'dialog',
        onSelect: e => openComesFrom(itemId, anchorOf(e.currentTarget), { list: true }),
      }
    : {
        label: SOURCES_BUTTON_LABEL,
        icon: 'layers',
        testId: 'sources-button',
        expanded: listOpen,
        controls: listOpen ? `${baseId}-sources` : undefined,
        onSelect: () => setListOpen(o => !o),
      }
  const rules = (
    <>
      <div
        role="radiogroup"
        aria-label={`Where ${name} comes from`}
        data-summary-controls
        onKeyDown={moveWithArrows}
        className="flex shrink-0 rounded border border-gray-700 bg-gray-900"
      >
        {ITEM_SOURCING_CHOICES.map((choice, i) => {
          const selected = choice.mode === preset
          const helpId = `${baseId}-preset-${i}`
          return (
            <button
              key={choice.label}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={choice.label}
              aria-describedby={helpId}
              data-tip={`${choice.label}. ${choice.title}`}
              // One tab stop for the group, the chosen preset; the arrows move between presets.
              tabIndex={selected ? 0 : -1}
              data-sourcing-choice={choice.mode ?? 'own'}
              onClick={() => area !== undefined ? setAreaMakeHere(area, itemId, makeHereOf(choice.mode)) : setMakeHere(itemId, makeHereOf(choice.mode))}
              className={`${ICON_BUTTON} border-r border-gray-700 last:border-r-0 ${selected ? LIT : UNLIT}`}
            >
              <StripIcon name={PRESET_ICONS[i]} />
              <span id={helpId} className="sr-only">{choice.title}</span>
            </button>
          )
        })}
      </div>
      <Separator />
      <IconSwitch id={`${baseId}-import`} on={importOn} label={IMPORT_SWITCH.label} help={IMPORT_SWITCH.title} icon="tray" testId="import-switch" onToggle={() => area !== undefined ? toggleAreaImportOff(area, itemId) : toggleImportOff(itemId)} />
      <IconSwitch id={`${baseId}-leftover`} on={leftoverOn} label={LEFTOVER_SWITCH.label} help={LEFTOVER_SWITCH.title} icon="out" testId="leftover-switch" disabled={area !== undefined} onToggle={() => toggleLeftoverOff(itemId)} />
    </>
  )
  const sentenceRow = <p data-testid="sourcing-sentence" title={sentence} className="text-[11px] leading-snug text-gray-400 line-clamp-2">{sentence}</p>

  if (listInPopover) {
    // The strip of a selected Ingredients slot: the sentence under the bar, then one row of icons.
    return (
      <div role="group" aria-label={COMES_FROM_LABEL} data-testid="comes-from" className="flex flex-col gap-[3px]">
        {sentenceRow}
        <StripToolbar actions={[...actions, sourcesAction]} middle={rules} />
        {takerNotes}
        {areasButton}
        {noEffectList}
      </div>
    )
  }

  // The Comes from popover: the same sentence and row of icons, with the scope control above and the Sources list under the rows.
  return (
    <div
      role="group"
      aria-label={COMES_FROM_LABEL}
      data-testid="comes-from"
      className="flex flex-col gap-1.5 pt-1 border-t border-gray-700/70"
    >
      {showScope && (
        <div data-testid="comes-from-scope" className="flex flex-col gap-0.5">
          <Segmented label="Scope" size="xs">
            <Segment pressed={area === undefined} data-scope="block" onClick={() => setScope(undefined)}>Whole block</Segment>
            {scopeAreas.map(a => (
              <Segment key={a.id} pressed={area === a.id} data-scope={a.id} onClick={() => setScope(a.id)}>{areaNameOf(block.rootPlan, a.id)}</Segment>
            ))}
          </Segmented>
          <p data-testid="scope-hint" className="text-[11px] leading-snug text-gray-500">
            {area === undefined ? 'Every row of the block, unless an area has its own rule' : `Rows of ${areaNameOf(block.rootPlan, area)}`}
          </p>
        </div>
      )}
      {sentenceRow}
      <StripToolbar actions={[sourcesAction]} middle={rules} />

      {area !== undefined && (
        <div className="flex flex-wrap items-center justify-end gap-x-2">
          <span data-testid="leftover-block-note" className="text-[11px] text-gray-500">{LEFTOVER_BLOCK_NOTE}</span>
          <button type="button" data-testid="leftover-whole-block" aria-label={`${LEFTOVER_BLOCK_BUTTON}: change Leftover`} onClick={() => setScope(undefined)} className={MINI_BUTTON_CLASS}>{LEFTOVER_BLOCK_BUTTON}</button>
        </div>
      )}
      {takerNotes}

      {area !== undefined && (
        stored === undefined
          ? <p data-testid="follows-block-rule" className="text-[11px] leading-snug text-gray-400">Follows the block&apos;s rule</p>
          : (
              <div className="flex">
                <button type="button" data-testid="use-block-rule" onClick={() => clearAreaRule(area, itemId)} className={MINI_BUTTON_CLASS}>
                  Use the block&apos;s rule
                </button>
              </div>
            )
      )}

      {noEffectList}
      {listOpen && <SourcesList id={`${baseId}-sources`} itemId={itemId} areaId={area} />}
    </div>
  )
}
