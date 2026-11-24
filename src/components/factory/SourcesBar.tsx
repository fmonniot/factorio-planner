import { fmtItemRateText } from './ItemTile'
import { lookOfLine } from './segmentLooks'
import { StackedBar } from './StackedBar'
import type { BarSegment } from './StackedBar'
import type { SourcesView } from './useSourcesModel'

// ---------------------------------------------------------------------------
// SourcesBar — the 8px bar under the Sources popover's header: one part per supplying line of the list, sized by its consumed
// share of the item's need. Its parts carry the line's name and rate as a tooltip and an accessible name, and are no stops.
// ---------------------------------------------------------------------------

export function SourcesBar({ view }: { view: SourcesView }) {
  const { model, itemId, name, unit } = view
  const need = model.need
  const parts = need !== undefined && need > 0 ? model.bar : []
  const segments: BarSegment[] = parts.map(p => ({
    key: p.key,
    look: lookOfLine(p.look),
    weight: p.rate / need!,
    name: '',
    tipName: p.label,
    tipAmount: fmtItemRateText(itemId, p.rate / 60, unit),
    testId: 'comes-from-bar-segment',
    dataKind: p.look.kind,
  }))
  return (
    <div data-testid="comes-from-bar" data-need={need}>
      {segments.length > 0
        ? <StackedBar thin label={`Sources of ${name} by line`} segments={segments} />
        : <div aria-hidden="true" className="h-2 w-full rounded bg-gray-800" />}
    </div>
  )
}
