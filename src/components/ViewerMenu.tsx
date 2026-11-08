import { useState } from 'react'
import { useUiStore } from '../store/uiStore'
import { badgeFor, canSend, notices, type BadgeTone } from '../viewer/connection'
import { DEFAULT_BRIDGE_URL } from '../viewer/protocol'
import { troubleshootSteps } from '../viewer/troubleshoot'
import { setViewerAutoSend, useViewerState, viewer } from '../viewer/viewer'
import { CheckIcon, PlugIcon, XIcon } from './icons'
import { SubmenuItem } from './MenuButton'
import { Modal } from './Modal'

// ---------------------------------------------------------------------------
// The in-game viewer's connection, as part of the workspace menu: a status dot on the menu's
// trigger, a flyout under the menu with the controls, and a Troubleshoot dialog for a connection
// that is not working. The dialog lives with the always-mounted menu (WorkspaceMenu), since the
// flyout unmounts when the menu closes.
// ---------------------------------------------------------------------------

const DOT: Record<BadgeTone, string | null> = {
  idle: null,
  busy: 'bg-blue-400',
  warn: 'bg-amber-400',
  error: 'bg-red-400',
  ok: 'bg-green-400',
}

const TEXT: Record<BadgeTone, string> = {
  idle: 'text-gray-400',
  busy: 'text-blue-300',
  warn: 'text-amber-300',
  error: 'text-red-300',
  ok: 'text-green-300',
}

const BORDER: Record<BadgeTone, string> = {
  idle: 'border-gray-600',
  busy: 'border-blue-400',
  warn: 'border-amber-400',
  error: 'border-red-400',
  ok: 'border-green-400',
}

const LINK_BUTTON = 'text-xs text-blue-400 hover:text-blue-300 underline underline-offset-2'

/** The connection's status dot, to sit on the workspace menu's trigger; nothing while the connection is off. */
export function ViewerStatusDot() {
  const dot = DOT[badgeFor(useViewerState()).tone]
  if (!dot) return null
  return (
    <span
      aria-hidden
      data-testid="viewer-dot"
      className={`absolute -top-1 -right-1 w-[9px] h-[9px] rounded-full ${dot} ring-2 ring-gray-900 pointer-events-none`}
    />
  )
}

/** The bridge address and a way to change it. Changing it while connected reconnects to the new one. */
function BridgeAddress({ on }: { on: boolean }) {
  const bridgeUrl = useUiStore(s => s.bridgeUrl)
  const setBridgeUrl = useUiStore(s => s.setBridgeUrl)
  const [draft, setDraft] = useState<string | null>(null)

  function save() {
    const next = (draft ?? '').trim()
    setDraft(null)
    if (!next || next === bridgeUrl) return
    setBridgeUrl(next)
    if (on) {
      viewer.dispatch({ type: 'disable' })
      viewer.dispatch({ type: 'enable' })
    }
  }

  if (draft !== null) {
    return (
      <form
        className="flex flex-col gap-1.5 text-xs text-gray-400"
        onSubmit={e => { e.preventDefault(); save() }}
      >
        <label className="flex flex-col gap-1">
          Bridge address
          <input
            type="text"
            autoFocus
            value={draft}
            spellCheck={false}
            onChange={e => setDraft(e.target.value)}
            className="bg-gray-950 border border-gray-700 rounded-md px-2 py-1 text-xs text-gray-100"
          />
        </label>
        <div className="flex items-center gap-3">
          <button type="submit" className="text-xs px-2 py-0.5 rounded-md bg-blue-600 text-white hover:bg-blue-500">Save</button>
          <button type="button" className={LINK_BUTTON} onClick={() => setDraft(null)}>Cancel</button>
          {bridgeUrl !== DEFAULT_BRIDGE_URL && (
            <button type="button" className={`${LINK_BUTTON} ml-auto`} onClick={() => setDraft(DEFAULT_BRIDGE_URL)}>
              Use the default
            </button>
          )}
        </div>
      </form>
    )
  }
  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <span className="text-gray-400">Bridge</span>
      <span className="flex items-center gap-2.5 min-w-0">
        <code data-testid="viewer-address" className="font-mono text-[11px] text-gray-300 truncate">{bridgeUrl}</code>
        <button type="button" className={LINK_BUTTON} onClick={() => setDraft(bridgeUrl)}>Change</button>
      </span>
    </div>
  )
}

function ViewerFlyout({ onTroubleshoot }: { onTroubleshoot: () => void }) {
  const state = useViewerState()
  const badge = badgeFor(state)
  const on = state.phase !== 'off'
  const messages = notices(state)
  const sendable = canSend(state) && !!state.plan
  const needsHelp = badge.tone === 'warn' || badge.tone === 'error'

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <span id="viewer-connect-label" className="text-[13px] font-semibold text-gray-100">Connect to the bridge</span>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-labelledby="viewer-connect-label"
          onClick={() => viewer.dispatch({ type: on ? 'disable' : 'enable' })}
          className={`relative w-9 h-5 rounded-full shrink-0 ${on ? 'bg-blue-600' : 'bg-gray-600'}`}
        >
          <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white ${on ? 'left-[18px]' : 'left-0.5'}`} />
        </button>
      </div>
      {!on && (
        <p className="text-gray-400 leading-snug">
          Shows this plan inside Factorio. Needs the bridge running on this computer and the mod enabled in the game.
        </p>
      )}
      {on && (
        <>
          <div className="flex flex-col gap-1.5 p-2.5 bg-gray-900 border border-gray-700 rounded-md" aria-live="polite">
            <div className="flex items-center justify-between gap-2">
              <span data-testid="viewer-badge" data-kind={badge.kind} className={`flex items-center gap-1.5 text-[13px] font-semibold ${TEXT[badge.tone]}`}>
                <span aria-hidden className={`w-2 h-2 rounded-full ${DOT[badge.tone] ?? 'bg-gray-400'}`} />
                {badge.label}
              </span>
              {needsHelp && <button type="button" className={LINK_BUTTON} onClick={onTroubleshoot}>Troubleshoot…</button>}
            </div>
            {!needsHelp && <p data-testid="viewer-detail" className="text-gray-300 leading-snug">{badge.detail}</p>}
          </div>
          {messages.map(m => (
            <p key={m} role="alert" data-testid="viewer-notice" className="text-red-300 bg-red-950/40 border border-red-900 rounded-md px-2 py-1">
              {m}
            </p>
          ))}
          <div className="flex flex-col gap-1.5">
            <button
              type="button"
              disabled={!sendable}
              onClick={() => viewer.dispatch({ type: 'send' })}
              className="w-full text-xs font-semibold px-2 py-1.5 rounded-md bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-40 disabled:hover:bg-blue-600"
            >
              Send to Factorio
            </button>
            {!sendable && <span className="text-[11px] text-gray-400 text-center">Available once the game is connected</span>}
          </div>
        </>
      )}
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={state.autoSend} onChange={e => setViewerAutoSend(e.target.checked)} />
        Send after every change
      </label>
      <div className="pt-2.5 border-t border-gray-700">
        <BridgeAddress on={on} />
      </div>
    </>
  )
}

/** The workspace menu's "In-game viewer" entry: its status on the row, the controls in a flyout. */
export function ViewerMenuItem({ onTroubleshoot }: { onTroubleshoot: () => void }) {
  const badge = badgeFor(useViewerState())
  const dot = DOT[badge.tone]
  return (
    <SubmenuItem
      label={<><PlugIcon className="w-3.5 h-3.5 mr-1" />In-game viewer</>}
      trailing={
        <span data-testid="viewer-menu-status" className={`ml-auto flex items-center gap-1.5 ${TEXT[badge.tone]}`}>
          {dot && <span aria-hidden className={`w-[7px] h-[7px] rounded-full ${dot}`} />}
          {badge.short}
        </span>
      }
      menuLabel="In-game viewer"
      variant="controls"
      panelClassName="w-80 max-w-[calc(100vw-1rem)]"
      initialFocus={flyout => flyout.querySelector<HTMLElement>('[role="switch"]')}
    >
      <ViewerFlyout onTroubleshoot={onTroubleshoot} />
    </SubmenuItem>
  )
}

// ---------------------------------------------------------------------------
// Troubleshoot dialog
// ---------------------------------------------------------------------------

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // No clipboard access: the text is still selectable.
    }
  }
  return (
    <button
      type="button"
      onClick={() => void copy()}
      className="text-[11px] px-2 py-0.5 rounded bg-gray-800 text-gray-200 border border-gray-600 hover:bg-gray-700"
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  )
}

export function ViewerTroubleshootDialog({ onClose }: { onClose: () => void }) {
  const state = useViewerState()
  const steps = troubleshootSteps(state)
  return (
    <Modal onClose={onClose} className="w-[34rem] max-w-[calc(100vw-2rem)] bg-gray-900">
      <div role="dialog" aria-modal="true" aria-label="Troubleshoot the in-game viewer" className="flex flex-col">
        <div className="flex items-start justify-between gap-4 px-5 pt-4 pb-3">
          <div className="flex flex-col gap-1">
            <h2 className="text-base font-semibold text-gray-100">Troubleshoot the in-game viewer</h2>
            <p className="text-xs text-gray-400 leading-snug">
              Three things have to be true, in this order. The planner keeps retrying while this is open.
            </p>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="w-8 h-8 shrink-0 flex items-center justify-center rounded-md text-gray-400 hover:bg-gray-800 hover:text-gray-100"
          >
            <XIcon className="w-4 h-4" />
          </button>
        </div>
        <ol className="mx-5 bg-gray-950 border border-gray-700 rounded-lg divide-y divide-gray-700">
          {steps.map((step, i) => (
            <li key={step.id} data-testid={`troubleshoot-${step.id}`} data-tone={step.tone} className="flex gap-3 px-3.5 py-3">
              <span
                aria-hidden
                className={`shrink-0 w-6 h-6 rounded-full border-2 flex items-center justify-center text-[11px] font-bold ${BORDER[step.tone]} ${TEXT[step.tone]}`}
              >
                {step.tone === 'ok' ? <CheckIcon className="w-3 h-3" /> : step.tone === 'warn' || step.tone === 'error' ? '!' : i + 1}
              </span>
              <div className="grow min-w-0 flex flex-col gap-1.5">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[13px] font-semibold text-gray-100">{step.title}</span>
                  <span className={`text-xs font-semibold ${TEXT[step.tone]}`}>{step.state}</span>
                </div>
                <span className="text-xs text-gray-400">{step.about}</span>
                {step.detail && <p className="text-xs text-gray-300 leading-normal">{step.detail}</p>}
                {step.code && (
                  <div className="flex items-center justify-between gap-3 py-1.5 pl-2.5 pr-1.5 bg-gray-900 border border-gray-700 rounded-md">
                    <code className="font-mono text-xs text-gray-200">{step.code}</code>
                    <CopyButton text={step.code} />
                  </div>
                )}
                {step.id === 'bridge' && <BridgeAddress on={state.phase !== 'off'} />}
              </div>
            </li>
          ))}
        </ol>
        <div className="flex items-center justify-between gap-3 px-5 pt-3.5 pb-4">
          <span className="text-xs text-gray-400">Still stuck? The README lists browser causes.</span>
          <button type="button" onClick={onClose} className="text-xs font-semibold px-3.5 py-1.5 rounded-md bg-blue-600 text-white hover:bg-blue-500">
            Done
          </button>
        </div>
      </div>
    </Modal>
  )
}
