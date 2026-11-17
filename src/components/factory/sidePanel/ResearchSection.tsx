import type { GameData } from '../../../data/types'
import { recipeUnlock } from '../../../data/horizon'
import { TechCost } from '../../TechCost'
import { TechIcon } from '../../TechIcon'
import { PanelSection } from './PanelParts'

/**
 * Research needed for the row's recipe: the technologies that unlock it, with their science pack types (no counts).
 * Absent when the data set has no technology data. The horizon is not applied, so a power recipe is never "fuel"-gated here. Read-only, like the picker's "Unlocked by".
 */
export function ResearchSection({ recipeId, gameData }: { recipeId: string; gameData: GameData }) {
  const unlock = recipeUnlock(gameData, recipeId)
  if (!unlock) return null
  return (
    <PanelSection title="Research needed" testId="panel-research">
      {unlock.kind === 'start' && <p className="text-[11px] text-gray-400">Available from the start</p>}
      {unlock.kind === 'none' && <p className="text-[11px] text-gray-400">No technology unlocks this recipe</p>}
      {unlock.kind === 'technologies' && (
        <ul className="space-y-1">
          {unlock.technologies.map(t => (
            <li key={t.id} data-testid="research-tech" data-tech-id={t.id} className="flex items-center gap-2">
              <TechIcon tech={t} className="w-6 h-6 text-xs" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs text-gray-200">{t.name}</span>
                <TechCost cost={t.cost} trigger={t.trigger} lookup={gameData} tooltip showTime={false} showCount={false} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </PanelSection>
  )
}
