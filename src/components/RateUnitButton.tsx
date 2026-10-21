import { useGameDataStore, selectGameData } from '../store/gameDataStore'
import { useUiStore } from '../store/uiStore'
import { IconButton } from './IconButton'
import { SwapIcon } from './icons'

/** Top-bar toggle between per-minute and per-second rates. */
export function RateUnitButton() {
  const hasGameData = !!useGameDataStore(selectGameData)
  const rateUnit = useUiStore(s => s.rateUnit)
  const setRateUnit = useUiStore(s => s.setRateUnit)
  if (!hasGameData) return null
  const label = rateUnit === 'min' ? 'Rates per minute, switch to per second' : 'Rates per second, switch to per minute'
  return (
    <IconButton label={label} wide onClick={() => setRateUnit(rateUnit === 'min' ? 'sec' : 'min')}>
      {rateUnit === 'min' ? '/min' : '/sec'}
      <SwapIcon className="w-3 h-3" />
    </IconButton>
  )
}
