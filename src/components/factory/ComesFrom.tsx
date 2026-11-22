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
import { Tip } from './Tip'
import { MINI_BUTTON_CLASS, Switch } from './Switch'
import { anchorOf } from './popoverAnchor'

// ---------------------------------------------------------------------------
// ComesFrom — where an item of the active block comes from: the three presets, the Import switch, the
// sentence for the last solve, and any rule of the item that has no effect, with a button to remove it.
// In a block with areas it has a scope control: the whole block, or one area, whose own rule replaces the block's for its rows.
// It sits in the strip of a selected Ingredients slot and in the Comes from popover (`ComesFromPopover`), which holds it for
// an item that has no slot. A rule that has nothing to act on yet ("No connection for X.") offers the way forward. The Sources…
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

export function ComesFrom({ itemId, areaId, initialListOpen = false, listInPopover = false }: {
  itemId: string
  /** The area the control is opened for: it starts on that area's scope when the area has a rule for the item, and offers it. */
  areaId?: string
  /** The Sources list starts open (the popover opened from a strip's Sources… button). */
  initialListOpen?: boolean
  /** The control sits where the list has no room (an Ingredients slot's strip): Sources… opens the Comes from popover with the list open. */
  listInPopover?: boolean
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
  const showScope = !listInPopover && scopeAreas.length > 0
  // The areas with a rule of their own, for the Ingredients slot's strip (table order).
  const ruledAreas = listInPopover ? (blockAreas(block.rootPlan) ?? []).filter(a => storedAreaRule(block.rootPlan, a.id, itemId) !== undefined) : []

  return (
    <div
      role="group"
      aria-label={COMES_FROM_LABEL}
      data-testid="comes-from"
      className="flex flex-col gap-1 pt-1 border-t border-gray-700/70"
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
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span aria-hidden="true" className="text-[10px] uppercase tracking-[0.06em] text-gray-400">{COMES_FROM_LABEL}</span>
        <div
          role="radiogroup"
          aria-label={`Where ${name} comes from`}
          onKeyDown={moveWithArrows}
          className="flex rounded border border-gray-700 bg-gray-900"
        >
          {ITEM_SOURCING_CHOICES.map((choice, i) => {
            const selected = choice.mode === preset
            const tipId = `${baseId}-preset-${i}`
            return (
              <span key={choice.label} className="group relative flex border-r border-gray-700 last:border-r-0">
                <button
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  aria-describedby={tipId}
                  // One tab stop for the group, the chosen preset; the arrows move between presets.
                  tabIndex={selected ? 0 : -1}
                  data-sourcing-choice={choice.mode ?? 'own'}
                  onClick={() => area !== undefined ? setAreaMakeHere(area, itemId, makeHereOf(choice.mode)) : setMakeHere(itemId, makeHereOf(choice.mode))}
                  className={`px-1.5 py-0.5 text-[11px] leading-4 whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-teal-400 focus-visible:ring-inset ${selected ? 'bg-teal-900/60 text-teal-200' : 'text-gray-300 hover:bg-gray-800'}`}
                >
                  {choice.label}
                </button>
                <Tip id={tipId} align={i === 0 ? 'start' : 'center'}>{choice.title}</Tip>
              </span>
            )
          })}
        </div>
        <span className="group relative flex ml-auto">
          <Switch on={importOn} label={IMPORT_SWITCH.label} testId="import-switch" describedBy={`${baseId}-import`} onToggle={() => area !== undefined ? toggleAreaImportOff(area, itemId) : toggleImportOff(itemId)}>
            {IMPORT_SWITCH.label}
          </Switch>
          <Tip id={`${baseId}-import`} align="end">{IMPORT_SWITCH.title}</Tip>
        </span>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-x-2">
        {area !== undefined && (
          <>
            <span data-testid="leftover-block-note" className="text-[11px] text-gray-500">{LEFTOVER_BLOCK_NOTE}</span>
            <button type="button" data-testid="leftover-whole-block" aria-label={`${LEFTOVER_BLOCK_BUTTON}: change Leftover`} onClick={() => setScope(undefined)} className={MINI_BUTTON_CLASS}>{LEFTOVER_BLOCK_BUTTON}</button>
          </>
        )}
        <span className="group relative flex">
          <Switch on={leftoverOn} label={LEFTOVER_SWITCH.label} testId="leftover-switch" describedBy={`${baseId}-leftover`} disabled={area !== undefined} onToggle={() => toggleLeftoverOff(itemId)}>
            {LEFTOVER_SWITCH.label}
          </Switch>
          <Tip id={`${baseId}-leftover`} align="end">{LEFTOVER_SWITCH.title}</Tip>
        </span>
      </div>
      {takers.map(b => (
        <p key={b.id} data-testid="leftover-take-note" className="text-[11px] leading-snug text-gray-500">{leftoverTakeNote(b.name, name)}</p>
      ))}

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

      {area === undefined && ruledAreas.length > 0 && (
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
      )}

      <div className="flex">
        <button
          type="button"
          data-testid="sources-button"
          aria-expanded={listInPopover ? false : listOpen}
          aria-controls={!listInPopover && listOpen ? `${baseId}-sources` : undefined}
          aria-haspopup={listInPopover ? 'dialog' : undefined}
          onClick={e => listInPopover ? openComesFrom(itemId, anchorOf(e.currentTarget), { list: true }) : setListOpen(o => !o)}
          className={MINI_BUTTON_CLASS}
        >
          {SOURCES_BUTTON_LABEL}
        </button>
      </div>
      {!listInPopover && listOpen && <SourcesList id={`${baseId}-sources`} itemId={itemId} areaId={area} />}

      <p data-testid="sourcing-sentence" className="text-[11px] leading-snug text-gray-400">{sentence}</p>

      {unavailable.length > 0 && (
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
      )}
    </div>
  )
}
