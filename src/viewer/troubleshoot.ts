import { badgeFor, gameLaunchOption, transferText, type BadgeTone, type ConnectionState } from './connection'

// ---------------------------------------------------------------------------
// The Troubleshoot dialog's diagnosis: three things have to be true, in this order (the bridge
// runs, the game answers it, the game has the plan), and the first one that is not true is where
// the player starts. Pure: it reads the connection state and the badge, nothing else.
// ---------------------------------------------------------------------------

export type StepId = 'bridge' | 'game' | 'plan'

export interface TroubleshootStep {
  id: StepId
  title: string
  /** What the step is, whatever its state. */
  about: string
  tone: BadgeTone
  /** The step's state in a word or two. */
  state: string
  /** What to do about it, when something is wrong. */
  detail?: string
  /** A command or launch option to copy. */
  code?: string
}

const ABOUT: Record<StepId, string> = {
  bridge: 'The program on this computer that relays the plan to the game.',
  game: 'Factorio, with the viewer mod enabled.',
  plan: 'Sent to the game. An edited plan shows as stale there until sent again.',
}

const TITLE: Record<StepId, string> = { bridge: 'Bridge', game: 'Game', plan: 'Plan' }

type Part = Pick<TroubleshootStep, 'tone' | 'state' | 'detail' | 'code'>

const WAITING: Part = { tone: 'idle', state: 'Waiting' }
const RUNNING: Part = { tone: 'ok', state: 'Running' }

/** The command that starts the bridge, as the README gives it. */
export const BRIDGE_COMMAND = 'factorio-planner-bridge'

export function troubleshootSteps(state: ConnectionState): TroubleshootStep[] {
  const badge = badgeFor(state)
  const parts = ((): [Part, Part, Part] => {
    switch (badge.kind) {
      case 'off':
        return [{ tone: 'idle', state: 'Off' }, WAITING, WAITING]
      case 'connecting':
        return [{ tone: 'busy', state: 'Reaching the bridge' }, WAITING, WAITING]
      case 'permission':
        return [{ tone: 'busy', state: badge.label, detail: badge.detail }, WAITING, WAITING]
      case 'no-bridge':
        return [
          {
            tone: 'warn',
            state: 'No bridge answered',
            detail: 'Start the bridge on this computer, or check the address. If it is running, the browser or an extension may be blocking the connection: allow the permission prompt Chrome and Firefox show, or disable content blockers such as uBlock for this site. The planner retries every few seconds.',
            code: BRIDGE_COMMAND,
          },
          WAITING,
          WAITING,
        ]
      case 'blocked':
      case 'protocol-mismatch':
      case 'bad-status':
        return [{ tone: badge.tone, state: badge.label, detail: badge.detail }, WAITING, WAITING]
      case 'no-game':
        return [
          RUNNING,
          { tone: 'warn', state: 'No game answered', detail: 'Start Factorio with the viewer mod enabled and this launch option.', code: gameLaunchOption(state.status) },
          WAITING,
        ]
      case 'game-quiet':
        return [
          RUNNING,
          { tone: 'warn', state: 'Game quiet', detail: 'The bridge has not heard the game lately: it is paused, saving, at the title screen or closed.' },
          WAITING,
        ]
      case 'mod-mismatch':
        return [RUNNING, { tone: 'error', state: badge.label, detail: badge.detail }, WAITING]
      case 'data-set-mismatch':
        return [RUNNING, { tone: 'ok', state: 'Answering' }, { tone: 'warn', state: badge.label, detail: badge.detail }]
      case 'connected': {
        const sent = transferText(state.status)
        return [RUNNING, { tone: 'ok', state: 'Answering' }, { tone: 'ok', state: sent ? 'Sent' : 'Nothing sent yet', detail: sent || undefined }]
      }
    }
  })()
  return (['bridge', 'game', 'plan'] as const).map((id, i) => ({ id, title: TITLE[id], about: ABOUT[id], ...parts[i] }))
}
