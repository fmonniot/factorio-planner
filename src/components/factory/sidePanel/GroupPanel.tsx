import { useId, useState } from 'react'
import type { GameData, SolvedNode, SolvedArea, AreaRoute, SubPlan, SubPlanNode } from '../../../data/types'
import { useUiStore } from '../../../store/uiStore'
import { MAX_NESTING_DEPTH, planDepth } from '../../../data/nesting'
import { Icon } from '../../Icon'
import { fmtItemRate, fmtPower } from '../ItemTile'
import { countSubPlanContents, sumSubPlanSolved } from '../subPlanContents'
import { dedicatedProduct } from '../../../solver/areas'
import { PanelHeader, PanelSection } from './PanelParts'
import { flowLines, type FlowLine } from './groupFlows'

function FolderIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" aria-hidden="true" className="text-gray-400">
      <path d="M3 6.5A1.5 1.5 0 014.5 5H9l2 2h8.5A1.5 1.5 0 0121 8.5v9a1.5 1.5 0 01-1.5 1.5h-15A1.5 1.5 0 013 17.5z" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}

function Stat({ label, value, testId }: { label: string; value: string; testId: string }) {
  return (
    <div className="flex-1 min-w-0">
      <div className="text-[10px] uppercase tracking-wide text-gray-400">{label}</div>
      <div data-testid={testId} className="text-sm text-gray-100 tabular-nums">{value}</div>
    </div>
  )
}

/** Receives and Sends show this many entries until "Show all" is pressed. */
const FLOW_LIST_CAP = 6

function FlowList({ lines, items, empty, testId }: {
  lines: FlowLine[]
  items: GameData['items']
  empty: string
  testId: string
}) {
  const unit = useUiStore(s => s.rateUnit)
  const [expanded, setExpanded] = useState(false)
  const listId = useId()
  if (lines.length === 0) return <p data-testid={`${testId}-empty`} className="text-xs text-gray-400 italic">{empty}</p>
  const capped = lines.length > FLOW_LIST_CAP
  const shown = capped && !expanded ? lines.slice(0, FLOW_LIST_CAP) : lines
  return (
    <>
      <ul id={listId} data-testid={testId} className="space-y-1">
        {shown.map(l => {
          const item = items[l.itemId]
          const name = item?.name ?? l.itemId
          const rate = fmtItemRate(l.itemId, l.rate / 60, unit)
          return (
            <li key={l.itemId} data-item-id={l.itemId} className="flex items-center gap-2 text-xs">
              {item?.iconPath ? (
                <Icon iconPath={item.iconPath} alt="" className="w-6 h-6 object-contain shrink-0" />
              ) : (
                <span className="w-6 h-6 bg-gray-700 rounded text-[9px] text-gray-300 flex items-center justify-center shrink-0">{name.substring(0, 2).toUpperCase()}</span>
              )}
              <span className="flex-1 min-w-0 truncate text-gray-200" title={name}>{name}</span>
              <span className="tabular-nums text-gray-300">{rate.value}<span className="opacity-60">{rate.unit}</span></span>
              {l.otherEnd && <span className="text-gray-400 shrink-0">{l.otherEnd}</span>}
            </li>
          )
        })}
      </ul>
      {capped && (
        <button
          type="button"
          data-testid={`${testId}-toggle`}
          aria-expanded={expanded}
          aria-controls={listId}
          onClick={() => setExpanded(e => !e)}
          className="mt-1.5 w-full min-h-7 px-2 rounded border border-gray-600 text-[11px] text-gray-300 hover:bg-gray-800 hover:text-gray-100"
        >
          {expanded ? 'Show fewer' : `Show all ${lines.length}`}
        </button>
      )}
    </>
  )
}

/**
 * The panel of a sub-factory or a separate area (read only): what is inside it, with a button per row or group below it
 * that selects it. A separate area also lists what it receives and sends.
 */
export function GroupPanel({ node, rootPlan, solvedMap, solvedAreas, areaRoutes, gameData, onSelect, onClose }: {
  node: SubPlanNode
  rootPlan: SubPlan
  solvedMap: ReadonlyMap<string, SolvedNode>
  solvedAreas: SolvedArea[] | undefined
  areaRoutes: AreaRoute[] | undefined
  gameData: GameData
  onSelect: (nodeId: string) => void
  onClose: () => void
}) {
  const find = (plan: SubPlan, id: string): SubPlan | undefined =>
    plan.id === id ? plan : plan.subPlans.reduce<SubPlan | undefined>((found, sp) => found ?? find(sp, id), undefined)
  const plan = find(rootPlan, node.subPlanId)
  if (!plan) return null

  const isArea = plan.area === true
  const level = planDepth(rootPlan, plan.id)
  const { recipes } = countSubPlanContents(plan)
  const totals = sumSubPlanSolved(plan, solvedMap)
  const power = totals.powerKw > 0 ? fmtPower(totals.powerKw) : undefined

  const nameOf = (id: string | undefined) => {
    if (id === undefined) return 'outside the block'
    if (id === rootPlan.id) return 'the rest of the block'
    return find(rootPlan, id)?.name ?? id
  }
  const solvedArea = isArea ? solvedAreas?.find(a => a.areaId === plan.id) : undefined
  const receives = flowLines(solvedArea?.receives ?? [], areaRoutes ?? [], plan.id, 'receives', nameOf)
  const sends = flowLines(solvedArea?.sends ?? [], areaRoutes ?? [], plan.id, 'sends', nameOf)

  return (
    <>
      <PanelHeader
        icon={<FolderIcon />}
        title={plan.name}
        subtitle={`${isArea ? 'Separate area' : 'Sub-factory'} · level ${level} of ${MAX_NESTING_DEPTH}`}
        marker={isArea && (
          <span data-testid="panel-area-marker" className="text-[10px] px-1 rounded border border-teal-700 text-teal-300 shrink-0">Area</span>
        )}
        onClose={onClose}
      />
      <PanelSection title="Summary" testId="panel-group-summary">
        <div className="flex gap-3">
          <Stat label="Recipes" value={String(recipes)} testId="group-recipes" />
          <Stat label="Machines" value={String(totals.machines)} testId="group-machines" />
          <Stat label="Power" value={power ? `${power.value} ${power.unit}` : '–'} testId="group-power-total" />
        </div>
      </PanelSection>

      {isArea && (
        <>
          <PanelSection title="Receives" testId="panel-area-receives">
            <FlowList lines={receives} items={gameData.items} testId="area-receives" empty="This area receives nothing from outside it." />
          </PanelSection>
          <PanelSection title="Sends" testId="panel-area-sends">
            <FlowList lines={sends} items={gameData.items} testId="area-sends" empty="This area sends nothing out." />
          </PanelSection>
        </>
      )}

      <PanelSection title="Inside this group" testId="panel-group-children">
        {plan.nodes.length === 0 ? (
          <p className="text-xs text-gray-400 italic">Nothing in this group yet.</p>
        ) : (
          <ul className="space-y-0.5">
            {plan.nodes.map(child => {
              let name: string
              let machines: number
              let powerKw: number
              let iconPath: string | undefined
              if (child.kind === 'subplan') {
                const sub = find(rootPlan, child.subPlanId)
                name = sub?.name ?? child.subPlanId
                const t = sub ? sumSubPlanSolved(sub, solvedMap) : { machines: 0, powerKw: 0 }
                machines = t.machines
                powerKw = t.powerKw
              } else {
                const recipe = gameData.recipes[child.recipeId]
                name = recipe?.name ?? child.recipeId
                const solved = solvedMap.get(child.id)
                machines = solved?.machineCountCeil ?? 0
                powerKw = solved?.powerKw ?? 0
                const primary = recipe ? dedicatedProduct(child, recipe) : undefined
                iconPath = primary ? gameData.items[primary]?.iconPath : undefined
              }
              const p = powerKw > 0 ? fmtPower(powerKw) : undefined
              return (
                <li key={child.id}>
                  <button
                    type="button"
                    data-testid="group-child"
                    data-node-id={child.id}
                    onClick={() => onSelect(child.id)}
                    className="w-full flex items-center gap-2 px-1.5 py-1 rounded text-left text-xs hover:bg-gray-800"
                  >
                    {child.kind === 'subplan' ? (
                      <span className="w-6 h-6 flex items-center justify-center shrink-0 scale-75"><FolderIcon /></span>
                    ) : iconPath ? (
                      <Icon iconPath={iconPath} alt="" className="w-6 h-6 object-contain shrink-0" />
                    ) : (
                      <span className="w-6 h-6 bg-gray-700 rounded text-[9px] text-gray-300 flex items-center justify-center shrink-0">{name.substring(0, 2).toUpperCase()}</span>
                    )}
                    <span className="flex-1 min-w-0 truncate text-gray-200" title={name}>{name}</span>
                    <span className="text-gray-400 tabular-nums">{machines} machine{machines === 1 ? '' : 's'}</span>
                    <span className="text-cyan-300 font-mono tabular-nums w-16 text-right">{p ? <>{p.value}<span className="opacity-60">{p.unit}</span></> : ''}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
        <p className="mt-3 text-[11px] text-gray-400">
          {isArea
            ? 'This area is solved on its own: its rows serve it first, and what it sends and receives is listed above.'
            : 'A sub-factory only organises rows. Choose Separate area from its right-click menu to track what it sends and receives.'}
        </p>
      </PanelSection>
    </>
  )
}
