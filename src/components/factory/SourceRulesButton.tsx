import { useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { GameData } from '../../data/types'
import { useBlockStore, selectActiveBlock } from '../../store/blockStore'
import { useGameDataStore, selectGameData } from '../../store/gameDataStore'
import { useUiStore } from '../../store/uiStore'
import { Icon } from '../Icon'
import { SOURCE_RULE_NAMES } from './itemSourcing'
import { ComesFrom } from './ComesFrom'
import { useDismiss } from './sidePanel/useDismiss'
import { keepTabInside } from './keepTabInside'
import { noEffectText, sourceRules } from './sourceRules'
import type { SourceRulePart } from './sourceRules'
import { useRemoveSourceRule } from './useRemoveSourceRule'
import { useSourcingSentence } from './useSourcingSentence'

// ---------------------------------------------------------------------------
// SourceRulesButton — the "Source rules (N)" button of the Ingredients pane's header and the popover it opens:
// every rule of the active block, with or without an Ingredients slot, each with what it does (or why it
// does nothing) and a button to remove it. A rule's item expands the Comes from control in its row, to change the rule.
// ---------------------------------------------------------------------------

const TITLE = 'Source rules'
const MARGIN = 8
const GAP = 4

/** One rule: its item (a button that shows or hides the Comes from control in the row), its name, what it does, and Remove. */
function RuleEntry({ rule, gameData, expanded, onToggle, onRemove }: {
  rule: SourceRulePart
  gameData: GameData
  expanded: boolean
  onToggle: () => void
  onRemove: () => void
}) {
  const controlId = useId()
  const item = gameData.items[rule.itemId]
  const name = item?.name ?? rule.itemId
  const sentence = useSourcingSentence(rule.itemId, gameData)
  const ruleName = SOURCE_RULE_NAMES[rule.kind]
  const off = rule.noEffect !== undefined
  return (
    <li
      data-testid="source-rule"
      data-item-id={rule.itemId}
      data-rule={rule.kind}
      data-no-effect={rule.noEffect}
      className="px-3 py-2 border-b border-gray-800 last:border-b-0"
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <button
              type="button"
              data-testid="source-rule-item"
              title={expanded ? `Hide where ${name} comes from` : `Change where ${name} comes from`}
              aria-expanded={expanded}
              aria-controls={expanded ? controlId : undefined}
              onClick={onToggle}
              className={`flex min-w-0 items-center gap-1.5 rounded text-left text-xs font-medium outline-none hover:underline focus-visible:ring-2 focus-visible:ring-teal-400 ${off ? 'text-gray-400' : 'text-gray-100'}`}
            >
              {item?.iconPath && (
                <Icon iconPath={item.iconPath} alt="" className={`w-5 h-5 shrink-0 object-contain ${off ? 'opacity-50 grayscale' : ''}`} />
              )}
              <span className="min-w-0 break-words">{name}</span>
            </button>
            <span data-testid="source-rule-name" className={`text-[11px] ${off ? 'text-gray-400' : 'text-teal-300'}`}>{ruleName}</span>
          </div>
          <p data-testid="source-rule-text" className={`mt-0.5 text-[11px] leading-snug break-words ${off ? 'text-gray-400' : 'text-gray-300'}`}>
            {off ? noEffectText(rule.noEffect!, name) : sentence}
          </p>
        </div>
        <button
          type="button"
          data-testid="source-rule-remove"
          aria-label={`Remove the ${ruleName} rule of ${name}`}
          onClick={onRemove}
          className="shrink-0 bg-gray-900 border border-gray-700 rounded px-1.5 text-[11px] leading-5 text-gray-300 outline-none hover:border-gray-500 focus-visible:ring-2 focus-visible:ring-teal-400"
        >
          Remove
        </button>
      </div>
      {expanded && <div id={controlId} className="mt-1.5"><ComesFrom itemId={rule.itemId} /></div>}
    </li>
  )
}

/**
 * The button and its popover. It draws nothing while the block has no rule. The popover is portalled to
 * `document.body` and fixed to the viewport under the button (the summary strip scrolls sideways on a narrow
 * screen and would clip it), so it takes the focus when it opens and keeps Tab inside itself; Escape or a press
 * outside closes it.
 */
export function SourceRulesButton() {
  const block = useBlockStore(selectActiveBlock)
  const blocks = useBlockStore(s => s.blocks)
  const gameData = useGameDataStore(selectGameData)
  const removeRule = useRemoveSourceRule()
  const panelId = useId()
  const titleId = useId()
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  // The rule whose Comes from control is expanded in its row; a popover opened again starts with none.
  const [expanded, setExpanded] = useState<{ itemId: string; kind: SourceRulePart['kind'] } | null>(null)

  const rules = useMemo(
    () => (block && gameData ? sourceRules(block, gameData, new Set(blocks.map(b => b.id))) : []),
    [block, blocks, gameData],
  )
  // Changing the rule in the expanded control keeps it open on the item's rule that is there now (its first one).
  const expandedRule = expanded
    ? (rules.find(r => r.itemId === expanded.itemId && r.kind === expanded.kind) ?? rules.find(r => r.itemId === expanded.itemId))
    : undefined
  // The last rule went (removed here, or by an undo): the button goes, and the popover with it.
  if (open && rules.length === 0) setOpen(false)
  const shown = open && rules.length > 0

  /**
   * Escape, or a press outside: focus goes back to the button (a press on something focusable then takes it). A connection
   * menu opened from an expanded control is outside the popover and closes first: a press on it belongs to the menu.
   */
  useDismiss([panelRef, buttonRef], shown, () => {
    if (useUiStore.getState().connectionMenu) return
    setOpen(false)
    setExpanded(null)
    if (panelRef.current?.contains(document.activeElement)) buttonRef.current?.focus()
  })

  // Under the button, right edges aligned, kept inside the viewport; the list scrolls when it is too tall.
  useLayoutEffect(() => {
    if (!shown) return
    function place() {
      const panel = panelRef.current
      const button = buttonRef.current
      if (!panel || !button) return
      const r = button.getBoundingClientRect()
      const vw = document.documentElement.clientWidth
      const vh = document.documentElement.clientHeight
      const top = r.bottom + GAP
      panel.style.top = `${top}px`
      panel.style.left = `${Math.max(MARGIN, Math.min(r.right - panel.offsetWidth, vw - panel.offsetWidth - MARGIN))}px`
      panel.style.maxHeight = `${Math.max(120, vh - top - MARGIN)}px`
    }
    place()
    panelRef.current?.querySelector('button')?.focus()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [shown])

  // After Remove: the rule that took the removed one's place (the next one, else the previous one) gets the
  // focus. When none is left the button is gone too, so it goes to the pane: its first slot, else the pane.
  const afterRemove = useRef<{ index: number; pane: HTMLElement | null } | null>(null)
  useLayoutEffect(() => {
    const pending = afterRemove.current
    if (!pending) return
    afterRemove.current = null
    const removes = panelRef.current?.querySelectorAll<HTMLElement>('[data-testid="source-rule-remove"]')
    if (removes && removes.length > 0) {
      removes[Math.min(pending.index, removes.length - 1)].focus()
      return
    }
    const { pane } = pending
    if (!pane) return
    const slot = pane.querySelector<HTMLElement>('[data-testid="summary-slot"]')
    if (slot) {
      slot.focus()
      return
    }
    // A pane with no slot has nothing focusable left: it takes the focus itself, for this once.
    pane.setAttribute('tabindex', '-1')
    pane.addEventListener('blur', () => pane.removeAttribute('tabindex'), { once: true })
    pane.focus()
  })

  if (!gameData || rules.length === 0) return null

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        data-testid="source-rules"
        aria-haspopup="dialog"
        aria-expanded={shown}
        aria-controls={shown ? panelId : undefined}
        title="Show this block's source rules"
        onClick={() => { setOpen(o => !o); setExpanded(null) }}
        className={`h-5 px-1.5 rounded border text-[11px] leading-none normal-case tracking-normal whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-teal-400 ${shown ? 'border-gray-500 text-gray-200' : 'border-gray-700 text-gray-400 hover:border-gray-500 hover:text-gray-200'}`}
      >
        {TITLE} ({rules.length})
      </button>
      {shown && createPortal(
        <div
          ref={panelRef}
          id={panelId}
          role="dialog"
          aria-labelledby={titleId}
          data-testid="source-rules-popover"
          onKeyDown={keepTabInside}
          style={{ position: 'fixed', top: 0, left: 0 }}
          className="z-50 flex w-[340px] max-w-[calc(100vw-1rem)] flex-col bg-gray-900 border border-gray-700 rounded-lg shadow-2xl text-left"
        >
          <div id={titleId} className="shrink-0 px-3 py-2 border-b border-gray-700 text-xs font-medium text-gray-300">{TITLE}</div>
          <ul role="list" className="min-h-0 overflow-y-auto">
            {rules.map((rule, index) => (
              <RuleEntry
                key={`${rule.itemId}:${rule.kind}`}
                rule={rule}
                gameData={gameData}
                expanded={expandedRule === rule}
                onToggle={() => setExpanded(expandedRule === rule ? null : { itemId: rule.itemId, kind: rule.kind })}
                onRemove={() => {
                  afterRemove.current = { index, pane: buttonRef.current?.closest<HTMLElement>('[data-testid="summary-pane"]') ?? null }
                  removeRule(rule)
                }}
              />
            ))}
          </ul>
        </div>,
        document.body,
      )}
    </>
  )
}
