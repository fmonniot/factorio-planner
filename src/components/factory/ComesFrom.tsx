import { useId, useMemo } from 'react'
import type { ItemSourcingMode } from '../../data/types'
import { useBlockStore, selectActiveBlock } from '../../store/blockStore'
import { useUiStore } from '../../store/uiStore'
import { useGameDataStore, selectGameData } from '../../store/gameDataStore'
import { COMES_FROM_LABEL, IMPORT_SWITCH, ITEM_SOURCING_CHOICES, RELIES_ON_IMPORT_TEXT, SOURCE_RULE_NAMES } from './itemSourcing'
import { noEffectText, sourceRules } from './sourceRules'
import { useRemoveSourceRule } from './useRemoveSourceRule'
import { useSourcingSentence } from './useSourcingSentence'

// ---------------------------------------------------------------------------
// ComesFrom — where an item of the active block comes from: the three presets, the Import switch, the
// sentence for the last solve, and any rule of the item that has no effect, with a button to remove it.
// It sits in the strip of a selected Ingredients slot and in the Comes from popover (`ComesFromPopover`), which holds it for
// an item that has no slot. A rule that has nothing to act on yet ("No connection for X.") offers the way forward.
// ---------------------------------------------------------------------------

/** Where a tooltip sits against its control: the first control of a row opens rightwards, the last leftwards. */
type TipAlign = 'start' | 'center' | 'end'

const TIP_ALIGN: Record<TipAlign, string> = {
  start: 'left-0',
  center: 'left-1/2 -translate-x-1/2',
  end: 'right-0',
}

/**
 * The black tooltip of the summary bar, for a control: shown on hover and on keyboard focus (not on the focus
 * a click leaves), and the control's accessible description. A control that is not available is
 * `aria-disabled`, not `disabled`, so it keeps the focus that shows its reason.
 */
function Tip({ id, align, children }: { id: string; align: TipAlign; children: string }) {
  return (
    <span
      id={id}
      role="tooltip"
      className={`hidden group-hover:block group-has-[:focus-visible]:block w-max max-w-[240px] absolute z-50 bottom-[calc(100%+6px)] ${TIP_ALIGN[align]} bg-black text-gray-100 text-[11px] leading-normal font-normal text-left whitespace-normal border border-gray-700 rounded px-2 py-1 pointer-events-none shadow-lg shadow-black/60`}
    >
      {children}
    </span>
  )
}

const ARROW_STEP: Record<string, 1 | -1> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }

/**
 * The keyboard contract of a radio group: an arrow moves to the next (or previous) preset, wrapping, and
 * chooses it. A preset that is not available is skipped.
 */
function moveWithArrows(e: React.KeyboardEvent<HTMLDivElement>) {
  const step = ARROW_STEP[e.key]
  if (step === undefined) return
  const radios = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]')]
  const from = radios.indexOf(document.activeElement as HTMLButtonElement)
  if (from < 0) return
  e.preventDefault()
  for (let i = 1; i < radios.length; i++) {
    const next = radios[(from + step * i + radios.length * i) % radios.length]
    if (next.getAttribute('aria-disabled') === 'true') continue
    next.focus()
    next.click()
    return
  }
}

export function ComesFrom({ itemId }: { itemId: string }) {
  const baseId = useId()
  const block = useBlockStore(selectActiveBlock)
  const blocks = useBlockStore(s => s.blocks)
  const setItemSourcing = useBlockStore(s => s.setItemSourcing)
  const toggleNoImportItem = useBlockStore(s => s.toggleNoImportItem)
  const gameData = useGameDataStore(selectGameData)
  const removeRule = useRemoveSourceRule()
  const openConnectionMenu = useUiStore(s => s.openConnectionMenu)
  const sentence = useSourcingSentence(itemId, gameData)

  const unavailable = useMemo(() => {
    if (!block || !gameData) return []
    const blockIds = new Set(blocks.map(b => b.id))
    return sourceRules(block, gameData, blockIds).filter(r => r.itemId === itemId && r.noEffect !== undefined)
  }, [block, blocks, gameData, itemId])

  if (!block || !gameData) return null

  const name = gameData.items[itemId]?.name ?? itemId
  const preset = block.itemSourcing[itemId]
  const importOn = !block.noImportItems.includes(itemId)
  const lockedTitle = noEffectText('locked', name)

  // The control never creates the pair of "Only what's already made" and Import off. A plan saved with
  // both shows the preset chosen and leaves the other presets free, so one click gets out of it.
  const switchDisabled = preset === 'byproducts-first'

  return (
    <div
      role="group"
      aria-label={COMES_FROM_LABEL}
      data-testid="comes-from"
      className="flex flex-col gap-1 pt-1 border-t border-gray-700/70"
    >
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
            const disabled = choice.mode === 'byproducts-first' && !importOn
            const tipId = `${baseId}-preset-${i}`
            return (
              <span key={choice.label} className="group relative flex border-r border-gray-700 last:border-r-0">
                <button
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  aria-disabled={disabled || undefined}
                  aria-describedby={tipId}
                  // One tab stop for the group, the chosen preset; the arrows move between presets.
                  tabIndex={selected ? 0 : -1}
                  data-sourcing-choice={choice.mode ?? 'own'}
                  onClick={() => { if (!disabled) setItemSourcing(itemId, choice.mode as ItemSourcingMode | undefined) }}
                  className={`px-1.5 py-0.5 text-[11px] leading-4 whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-teal-400 focus-visible:ring-inset ${selected ? 'bg-teal-900/60 text-teal-200' : 'text-gray-300 hover:bg-gray-800'} ${disabled ? 'opacity-40 cursor-default hover:bg-transparent' : ''}`}
                >
                  {choice.label}
                </button>
                <Tip id={tipId} align={i === 0 ? 'start' : 'center'}>{disabled ? lockedTitle : choice.title}</Tip>
              </span>
            )
          })}
        </div>
        <span className="group relative flex ml-auto">
          <button
            type="button"
            role="switch"
            aria-checked={importOn}
            aria-disabled={switchDisabled || undefined}
            aria-describedby={`${baseId}-import`}
            data-testid="import-switch"
            onClick={() => { if (!switchDisabled) toggleNoImportItem(itemId) }}
            className={`inline-flex items-center gap-1.5 rounded px-1 py-0.5 text-[11px] leading-4 text-gray-300 outline-none focus-visible:ring-2 focus-visible:ring-teal-400 ${switchDisabled ? 'opacity-40 cursor-default' : 'hover:text-gray-100'}`}
          >
            {IMPORT_SWITCH.label}
            <span aria-hidden="true" className={`relative inline-block w-6 h-3 rounded-full ${importOn ? 'bg-teal-600' : 'bg-gray-600'}`}>
              <span className={`absolute top-0.5 w-2 h-2 rounded-full bg-gray-100 ${importOn ? 'left-3.5' : 'left-0.5'}`} />
            </span>
          </button>
          <Tip id={`${baseId}-import`} align="end">{switchDisabled ? RELIES_ON_IMPORT_TEXT : IMPORT_SWITCH.title}</Tip>
        </span>
      </div>

      <p data-testid="sourcing-sentence" className="text-[11px] leading-snug text-gray-400">{sentence}</p>

      {unavailable.length > 0 && (
        <ul className="flex flex-col gap-0.5">
          {unavailable.map(rule => (
            <li
              key={rule.kind}
              data-testid="no-effect"
              data-rule={rule.kind}
              data-no-effect={rule.noEffect}
              className="flex items-baseline gap-2 text-[11px] leading-snug text-gray-500"
            >
              <span id={`${baseId}-no-effect-${rule.kind}`} className="min-w-0 flex-1">{noEffectText(rule.noEffect!, name)}</span>
              <span className="shrink-0 flex items-baseline gap-1">
                {rule.noEffect === 'no-connection' && (
                  <button
                    type="button"
                    data-testid="receive-from"
                    aria-describedby={`${baseId}-no-effect-${rule.kind}`}
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
                  aria-describedby={`${baseId}-no-effect-${rule.kind}`}
                  title={`Remove the ${SOURCE_RULE_NAMES[rule.kind]} rule`}
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
