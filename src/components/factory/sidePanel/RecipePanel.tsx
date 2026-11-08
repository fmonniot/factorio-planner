import type { GameData, GameRecipeNode, SolvedNode } from '../../../data/types'
import { useBlockStore } from '../../../store/blockStore'
import { dedicatedProduct } from '../../../solver/areas'
import { Icon } from '../../Icon'
import { PanelHeader } from './PanelParts'
import { RateSection } from './RateSection'
import { MachineSection } from './MachineSection'
import { BeaconsSection } from './BeaconsSection'
import { EffectsSection } from './EffectsSection'
import { SourcingSection } from './SourcingSection'

/** The panel of a recipe row: header, Rate, Machine, Beacons, Effects on this row, and Where inputs come from. */
export function RecipePanel({ node, solved, gameData, onClose }: {
  node: GameRecipeNode
  solved: SolvedNode | undefined
  gameData: GameData
  onClose: () => void
}) {
  const updateNodeBeacons = useBlockStore(s => s.updateNodeBeacons)
  const recipe = gameData.recipes[node.recipeId]
  if (!recipe) return null
  const primary = dedicatedProduct(node, recipe)
  const iconPath = primary ? gameData.items[primary]?.iconPath : undefined

  const beacons = node.beaconConfigs ?? []

  return (
    <>
      <PanelHeader
        icon={iconPath
          ? <Icon iconPath={iconPath} alt="" className="w-8 h-8 object-contain" />
          : <span className="w-8 h-8 bg-gray-800 rounded text-[10px] text-gray-400 flex items-center justify-center">{recipe.name.substring(0, 2).toUpperCase()}</span>}
        title={recipe.name}
        subtitle={node.byproductConsumer ? 'Absorbs byproduct' : undefined}
        onClose={onClose}
      />
      <RateSection node={node} solved={solved} gameData={gameData} />
      <MachineSection node={node} solved={solved} gameData={gameData} />
      <BeaconsSection
        node={node}
        configs={beacons}
        gameData={gameData}
        onChange={configs => updateNodeBeacons(node.id, configs)}
      />
      <EffectsSection node={node} beacons={beacons} gameData={gameData} />
      <SourcingSection node={node} solved={solved} gameData={gameData} />
    </>
  )
}
