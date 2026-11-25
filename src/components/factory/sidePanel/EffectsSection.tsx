import type { BeaconConfig, GameData, GameRecipeNode } from '../../../data/types'
import { PanelSection } from './PanelParts'
import { fmtEffect, rowEffects, type EffectKey, type EffectSource } from './effects'
import { describedTip } from '../../tipProps'

/** The title's tooltip: how a beacon's effect is counted. */
export const EFFECTS_HELP = 'Beacon effect = for each module, its effect × efficiency × its count × beacons, added up. All sources add up.'

const ROWS: { key: 'speed' | 'productivity' | 'consumption'; label: string }[] = [
  { key: 'speed', label: 'Speed' },
  { key: 'productivity', label: 'Productivity' },
  { key: 'consumption', label: 'Energy' },
]

function Cell({ source, effect, column }: { source: EffectSource; effect: EffectKey; column: string }) {
  const applied = source.applied[effect]
  const raw = source.raw[effect]
  const ignored = raw !== 0 && applied === 0
  if (applied === 0) {
    return (
      <div
        role="cell"
        className={`text-right tabular-nums ${ignored ? 'text-amber-400 line-through' : 'text-gray-400'}`}
        data-ignored={ignored ? 'true' : undefined}
        {...describedTip(ignored ? `${column}\n${fmtEffect(raw)} does not apply to this row, because the recipe, machine or beacon does not allow it.` : undefined)}
      >
        {ignored ? fmtEffect(raw) : '–'}
      </div>
    )
  }
  return <div role="cell" className={`text-right tabular-nums ${applied > 0 ? 'text-green-400' : 'text-red-400'}`}>{fmtEffect(applied)}</div>
}

/**
 * Speed, productivity and energy of the row, per source: the machine's modules, each beacon configuration, and the total
 * the solver counts. The effects the recipe, machine or beacon do not allow are struck through.
 */
export function EffectsSection({ node, beacons, gameData }: {
  node: GameRecipeNode
  beacons: readonly BeaconConfig[]
  gameData: GameData
}) {
  const effects = rowEffects(node, beacons, gameData)
  const columns: { name: string; source: EffectSource }[] = [
    { name: 'Machine', source: effects.machine },
    ...effects.beacons.map((source, i) => ({ name: effects.beacons.length > 1 ? `Beacons ${i + 1}` : 'Beacons', source })),
  ]
  // A single "Beacons" column even when the row has none yet, so the table keeps its shape.
  if (effects.beacons.length === 0) columns.push({ name: 'Beacons', source: { raw: effects.machine.raw, applied: { speed: 0, productivity: 0, consumption: 0, pollution: 0, quality: 0 } } })

  return (
    <PanelSection title="Effects on this row" titleTip={EFFECTS_HELP} testId="panel-effects">
      {/* A grid, not a <table>: the production table is the only table of the page body. */}
      {/* In a narrow drawer the grid is wider than the panel: it scrolls inside its own box, the panel does not. */}
      <div className="overflow-x-auto">
        <div
          role="table"
          aria-label="Effects on this row"
          className="grid gap-x-3 gap-y-1 text-xs"
          style={{ gridTemplateColumns: `1fr repeat(${columns.length + 1}, auto)` }}
        >
          <div role="row" className="contents text-gray-400 text-[10px] uppercase tracking-wide">
            <div role="columnheader" />
            {columns.map(c => <div key={c.name} role="columnheader" className="text-right">{c.name}</div>)}
            <div role="columnheader" className="text-right">Total</div>
          </div>
          {ROWS.map(({ key, label }) => {
            const total = effects.total[key]
            return (
              <div key={key} role="row" data-effect={key} className="contents">
                <div role="rowheader" className="text-gray-400">{label}</div>
                {columns.map(c => <Cell key={c.name} source={c.source} effect={key} column={c.name} />)}
                <div
                  role="cell"
                  data-testid={`effect-total-${key}`}
                  className={`text-right tabular-nums font-medium ${total === 0 ? 'text-gray-400' : total > 0 ? 'text-green-400' : 'text-red-400'}`}
                >
                  {total === 0 ? '–' : fmtEffect(total)}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </PanelSection>
  )
}
