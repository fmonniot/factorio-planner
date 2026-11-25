import type { ConnectionFlow } from '../../data/types'
import { AREA_LINE_HELP, SOURCES_LINES } from './itemSourcing'
import type { SourceLine } from './sourcesModel'

/** Below this a rate counts as none: shared by the rate column and the readings so they cannot drift apart. */
export const EPS = 1e-6

// ---------------------------------------------------------------------------
// The text of the Sources list's lines, apart from the drawing: which lines open a detail, the tooltip of a line's name, and the
// reading of a connection at area scope.
// ---------------------------------------------------------------------------

/**
 * Whether a line opens a detail: only the lines that have controls (Make more here's place buttons, a block line's limit and
 * Remove) or a status (Import while something is missing). The others are flat: their help is the tooltip of their name.
 */
export const lineOpens = (line: Pick<SourceLine, 'kind' | 'mark'>): boolean =>
  line.kind === 'make-here' || line.kind === 'block' || (line.kind === 'import' && line.mark === 'missing')

/** The tooltip of a line's name: its help, after a status line where the old detail said something the rate column cannot. */
export function lineTip(line: Pick<SourceLine, 'kind' | 'mark' | 'label'>, ctx: { itemName: string; atArea: boolean; greyed?: boolean }): string | undefined {
  switch (line.kind) {
    case 'made-here': return SOURCES_LINES['made-here'].title
    case 'make-here': {
      const help = SOURCES_LINES['make-here'].title
      return line.mark === 'idle' ? `No row here makes ${ctx.itemName}\n${help}` : help
    }
    case 'other-areas': {
      const help = SOURCES_LINES['other-areas'].title
      return ctx.atArea ? `No other area makes ${ctx.itemName}\n${help}` : help
    }
    case 'other-area': return line.mark === 'idle' ? `${line.label} sends nothing now\n${AREA_LINE_HELP}` : AREA_LINE_HELP
    case 'import': return SOURCES_LINES.import.title
    case 'block': return ctx.greyed ? undefined : SOURCES_LINES['other-blocks'].title
  }
}

/** What a connection gives and how much of it reaches the area, as the rate tooltip of a block line at area scope reads it. */
export function reachReading(flow: ConnectionFlow | undefined, reaches: number | undefined, fmt: (perMin: number) => string): string {
  return `${flow ? `${fmt(flow.rate)} over this connection` : 'No flow yet'}${reaches !== undefined ? `; ${reaches > EPS ? fmt(reaches) : 'none'} of it reaches this area` : ''}.`
}
