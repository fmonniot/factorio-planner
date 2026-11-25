import { describe, it, expect } from 'vitest'
import type { ConnectionFlow } from '../../data/types'
import { AREA_LINE_HELP, SOURCES_LINES } from './itemSourcing'
import { lineOpens, lineTip, reachReading } from './sourcesLineText'
import type { SourceLine } from './sourcesModel'

type L = Pick<SourceLine, 'kind' | 'mark' | 'label'>
const line = (kind: SourceLine['kind'], mark: SourceLine['mark'] = undefined, label = 'Line'): L => ({ kind, mark, label })
const ctx = { itemName: 'Ore', atArea: false }
const fmt = (n: number) => `${n.toFixed(1)}/m`
const flow = (rate: number) => ({ rate }) as unknown as ConnectionFlow

describe('lineOpens', () => {
  it('opens only the lines that have controls or a status', () => {
    expect(lineOpens(line('made-here'))).toBe(false)
    expect(lineOpens(line('make-here'))).toBe(true)
    expect(lineOpens(line('make-here', 'idle'))).toBe(true)
    expect(lineOpens(line('other-areas'))).toBe(false)
    expect(lineOpens(line('other-area'))).toBe(false)
    expect(lineOpens(line('other-area', 'idle'))).toBe(false)
    expect(lineOpens(line('block'))).toBe(true)
    expect(lineOpens(line('import'))).toBe(false)
    expect(lineOpens(line('import', 'missing'))).toBe(true)
  })
})

describe('lineTip', () => {
  it('is the help of the line, with a status line where the rate column cannot say it', () => {
    expect(lineTip(line('made-here'), ctx)).toBe(SOURCES_LINES['made-here'].title)
    expect(lineTip(line('make-here'), ctx)).toBe(SOURCES_LINES['make-here'].title)
    expect(lineTip(line('make-here', 'idle'), ctx)).toBe(`No row here makes Ore\n${SOURCES_LINES['make-here'].title}`)
    expect(lineTip(line('other-areas'), ctx)).toBe(SOURCES_LINES['other-areas'].title)
    expect(lineTip(line('other-areas'), { ...ctx, atArea: true })).toBe(`No other area makes Ore\n${SOURCES_LINES['other-areas'].title}`)
    expect(lineTip(line('other-area', undefined, 'Line M1'), ctx)).toBe(AREA_LINE_HELP)
    expect(lineTip(line('other-area', 'idle', 'Line M2'), ctx)).toBe(`Line M2 sends nothing now\n${AREA_LINE_HELP}`)
    expect(lineTip(line('import'), ctx)).toBe(SOURCES_LINES.import.title)
    expect(lineTip(line('block'), ctx)).toBe(SOURCES_LINES['other-blocks'].title)
    expect(lineTip(line('block'), { ...ctx, greyed: true })).toBeUndefined()
  })
})

describe('reachReading', () => {
  it('reads the connection and what of it reaches the area', () => {
    expect(reachReading(flow(12), 9, fmt)).toBe('12.0/m over this connection; 9.0/m of it reaches this area.')
    expect(reachReading(flow(12), 0, fmt)).toBe('12.0/m over this connection; none of it reaches this area.')
    expect(reachReading(undefined, undefined, fmt)).toBe('No flow yet.')
    expect(reachReading(flow(12), undefined, fmt)).toBe('12.0/m over this connection.')
  })
})
