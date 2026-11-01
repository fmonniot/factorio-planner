import { useRef, useState } from 'react'
import { useUiStore } from '../store/uiStore'
import { badgeFor, canSend, notices, type BadgeTone } from '../viewer/connection'
import { DEFAULT_BRIDGE_URL } from '../viewer/protocol'
import { setViewerAutoSend, useViewerState, viewer } from '../viewer/viewer'
import { IconButton } from './IconButton'
import { PlugIcon } from './icons'
import { Popover } from './factory/Popover'

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

const LINK_BUTTON = 'text-xs text-blue-400 hover:text-blue-300 underline-offset-2 hover:underline'

function ViewerPopover({ onClose, ignoreRef }: {
  onClose: (reason: 'escape' | 'outside') => void
  ignoreRef: React.RefObject<HTMLElement | null>
}) {
  const state = useViewerState()
  const bridgeUrl = useUiStore(s => s.bridgeUrl)
  const setBridgeUrl = useUiStore(s => s.setBridgeUrl)
  const badge = badgeFor(state)
  const on = state.phase !== 'off'
  const messages = notices(state)
  const sendable = canSend(state) && !!state.plan

  return (
    <Popover onClose={onClose} ignoreRef={ignoreRef} className="right-0 top-full w-80 p-3">
      <div role="dialog" aria-label="In-game viewer" className="text-gray-200 flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-gray-100">In-game viewer</h2>
        <p className="text-xs text-gray-400">
          Shows this plan inside Factorio. Needs the bridge running on this computer and the mod enabled in the game.
        </p>
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={on}
            onChange={e => viewer.dispatch({ type: e.target.checked ? 'enable' : 'disable' })}
          />
          Connect to the bridge
        </label>
        <label className="flex flex-col gap-1 text-xs text-gray-400">
          Bridge address
          <input
            type="text"
            value={bridgeUrl}
            disabled={on}
            spellCheck={false}
            onChange={e => setBridgeUrl(e.target.value)}
            className="bg-gray-950 border border-gray-700 rounded-md px-2 py-1 text-xs text-gray-100 disabled:opacity-60"
          />
          {bridgeUrl !== DEFAULT_BRIDGE_URL && !on && (
            <button type="button" className={`${LINK_BUTTON} self-start`} onClick={() => setBridgeUrl(DEFAULT_BRIDGE_URL)}>
              Use the default address
            </button>
          )}
        </label>
        {on && (
          <div className="flex flex-col gap-1" aria-live="polite">
            <span data-testid="viewer-badge" data-kind={badge.kind} className={`text-xs font-semibold ${TEXT[badge.tone]}`}>
              {badge.label}
            </span>
            <p data-testid="viewer-detail" className="text-xs text-gray-400">{badge.detail}</p>
          </div>
        )}
        {messages.map(m => (
          <p key={m} role="alert" data-testid="viewer-notice" className="text-xs text-red-300 bg-red-950/40 border border-red-900 rounded-md px-2 py-1">
            {m}
          </p>
        ))}
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            disabled={!sendable}
            onClick={() => viewer.dispatch({ type: 'send' })}
            className="text-xs px-2 py-1 rounded-md bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-40 disabled:hover:bg-blue-600"
          >
            Send to Factorio
          </button>
          <label className="flex items-center gap-1.5 text-xs">
            <input type="checkbox" checked={state.autoSend} onChange={e => setViewerAutoSend(e.target.checked)} />
            Send after every change
          </label>
        </div>
      </div>
    </Popover>
  )
}

/** Top-bar entry point to the in-game viewer connection. Off by default; opens nothing until switched on. */
export function ViewerButton() {
  const state = useViewerState()
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const badge = badgeFor(state)
  const dot = DOT[badge.tone]

  return (
    <div ref={wrapperRef} className="relative">
      <IconButton
        label={`In-game viewer: ${badge.label}`}
        onClick={() => setOpen(o => !o)}
        hasPopup="dialog"
        expanded={open}
        hideTooltip={open}
        buttonRef={buttonRef}
        extra={dot && (
          <span
            data-testid="viewer-dot"
            className={`absolute top-1.5 right-1.5 w-[7px] h-[7px] rounded-full ${dot} ring-2 ring-gray-900 pointer-events-none`}
          />
        )}
      >
        <PlugIcon className="w-[17px] h-[17px]" />
      </IconButton>
      {open && (
        <ViewerPopover
          ignoreRef={wrapperRef}
          onClose={reason => { setOpen(false); if (reason === 'escape') buttonRef.current?.focus() }}
        />
      )}
    </div>
  )
}
