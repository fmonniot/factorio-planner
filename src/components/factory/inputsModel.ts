import type { SourceRule } from '../../data/types'
import { presetOf } from './itemSourcing'
import type { LineLook, SourcesModel } from './sourcesModel'
import { sourcesReading } from './sourcesModel'
import type { BlockRow, Tag } from './sourcesRows'
import type { StripIconName } from './StripIcon'

const EPS = 1e-6

// ---------------------------------------------------------------------------
// The lines under each input of the side panel: where one ingredient comes from, read off the Sources model. A pure function of
// plain data (like `outputsModel.ts`); the model carries no unit, the helpers take the rate formatter.
// ---------------------------------------------------------------------------

export type InputKind = 'made-here' | 'make-here' | 'other-area' | 'block' | 'import' | 'missing'

export interface InputLine {
  /** `${line.key}:${i}` for a maker, the line's key otherwise; 'missing' for the Missing part. */
  key: string
  kind: InputKind
  /** The recipe name, the area's name, the block's name, 'Import' or 'Missing'. */
  label: string
  /** `${n} × ${machine}` for a maker. */
  detail?: string
  /** items/min. */
  rate: number
  look: LineLook
  limited: boolean
  connectionId?: string
  areaId?: string
  /** The block line's connection: whether it is requested or existing, and the sentences that say why. */
  block?: { tag: Tag; tagTitle: string; status: string }
}

/** The supplying lines of the model, in list order: one line per maker of a made line, Import and Missing apart. */
export function buildInputLines(model: SourcesModel, rows: BlockRow[]): InputLine[] {
  const lines: InputLine[] = []
  for (const part of model.bar) {
    const missing = part.look.kind === 'missing'
    const line = model.lines.find(l => l.key === (missing ? 'import' : part.key))
    if (!line) continue
    if (missing) {
      lines.push({ key: 'missing', kind: 'missing', label: 'Missing', rate: part.rate, look: part.look, limited: false })
    } else if (part.look.kind === 'import') {
      lines.push({ key: line.key, kind: 'import', label: 'Import', rate: part.rate, look: part.look, limited: false })
    } else if (line.kind === 'made-here' || line.kind === 'make-here') {
      if (line.makers && line.makers.length > 0) {
        line.makers.forEach((m, i) => lines.push({
          key: `${line.key}:${i}`, kind: line.kind as 'made-here' | 'make-here', label: m.recipeName, detail: `${m.machineCount} × ${m.machineName}`,
          rate: m.rate, look: part.look, limited: false,
        }))
      } else lines.push({ key: line.key, kind: line.kind, label: line.label, rate: part.rate, look: part.look, limited: false })
    } else if (line.kind === 'other-area') {
      lines.push({ key: line.key, kind: 'other-area', label: line.label, rate: part.rate, look: part.look, limited: false, ...(line.areaId !== undefined ? { areaId: line.areaId } : {}) })
    } else if (line.kind === 'block') {
      const row = rows.find(r => r.connection.id === line.connectionId)
      lines.push({
        key: line.key, kind: 'block', label: line.label, rate: part.rate, look: part.look, limited: part.look.kind === 'block' && part.look.limited,
        ...(line.connectionId !== undefined ? { connectionId: line.connectionId } : {}),
        ...(row?.tag !== undefined ? { block: { tag: row.tag, tagTitle: row.tagTitle ?? '', status: row.status } } : {}),
      })
    }
  }
  return lines
}

export type InputEmptyState = 'unsolved' | 'idle' | 'none'

/** Why a model has no lines, or undefined when it has some (or there is no model). */
export function inputEmptyState(model: SourcesModel | undefined): InputEmptyState | undefined {
  if (!model) return undefined
  if (model.need === undefined) return 'unsolved'
  if (model.bar.length === 0) return model.need > EPS ? 'none' : 'idle'
  return undefined
}

export const INPUT_EMPTY_LABEL = { unsolved: 'Not solved yet.', idle: 'Nothing needed.', none: 'Nothing supplies it.' } as const

/** The tooltip of a line: its name and figure, then at most one plain sentence. `fmt` writes items/min with their unit. */
export function inputLineTip(line: InputLine, fmt: (perMin: number) => string): string {
  const rate = fmt(line.rate)
  switch (line.kind) {
    case 'make-here': return line.detail !== undefined ? `Make more here: ${line.label}\n${line.detail}, ${rate}` : `${line.label}: ${rate}`
    case 'made-here': return line.detail !== undefined ? `Already made here: ${line.label}\n${line.detail}, ${rate}` : `${line.label}: ${rate}`
    case 'other-area': return `${line.label}: ${rate}\nMade by the rows of that area`
    case 'block': {
      if (!line.block) return `${line.label}: ${rate}${line.limited ? ', limited' : ''}`
      const { tag, tagTitle, status } = line.block
      return line.limited ? `${line.label}: ${rate}, limited (${tag})\n${status}` : `${line.label}: ${rate} (${tag})\n${tagTitle}`
    }
    case 'import': return `Import: ${rate} from outside the plan`
    case 'missing': return `Missing ${rate}\nImport is off and nothing else supplies it.`
  }
}

/** One sentence for screen readers (not shown): the model's reading on one line, area-qualified for an area's own rule. */
export function inputsReading(model: SourcesModel, fmt: (perMin: number) => string, areaName?: string): string {
  const text = inputEmptyState(model) === 'idle' ? INPUT_EMPTY_LABEL.idle : sourcesReading(model, fmt).split('\n').join(', ')
  const sentence = text.endsWith('.') ? text : `${text}.`
  return areaName !== undefined ? `${areaName}: ${sentence}` : sentence
}

/** The icons that say a rule is not the default, in order: its preset, then Import off. Leftover off is not an input's. */
export function ruleIconsOf(rule: SourceRule | undefined): { kind: 'connections-first' | 'byproducts-first' | 'import-off'; icon: StripIconName }[] {
  const icons: ReturnType<typeof ruleIconsOf> = []
  const preset = presetOf(rule)
  if (preset === 'connections-first') icons.push({ kind: 'connections-first', icon: 'receive-first' })
  else if (preset === 'byproducts-first') icons.push({ kind: 'byproducts-first', icon: 'dont-make' })
  if (rule?.importOff) icons.push({ kind: 'import-off', icon: 'import-off' })
  return icons
}
