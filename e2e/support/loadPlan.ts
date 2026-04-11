import { type Page } from '@playwright/test'
import fs from 'fs'

const APP_STATE_KEY = 'factorio-planner:app-state'
const GAME_DATA_KEY = 'factorio-planner:game-data-source'

/**
 * Load a plan fixture JSON into the app via localStorage injection.
 *
 * Navigates to '/', injects the plan state and game-data source into
 * localStorage, then reloads so the app boots with that state.
 *
 * @param page             Playwright page object
 * @param planFixturePath  Absolute path to an exported plan JSON file
 * @param gameDataSource   Which bundled dataset to auto-load ('nullius'),
 *                         or null to skip (game data must be loaded manually)
 */
export async function loadPlanFixture(
  page: Page,
  planFixturePath: string,
  gameDataSource: 'nullius' | null = 'nullius',
): Promise<void> {
  const json = fs.readFileSync(planFixturePath, 'utf8')
  await page.goto('/')
  await page.evaluate(
    ({ stateKey, stateJson, gameDataKey, gameDataValue }) => {
      localStorage.setItem(stateKey, stateJson)
      if (gameDataValue) localStorage.setItem(gameDataKey, gameDataValue)
    },
    {
      stateKey: APP_STATE_KEY,
      stateJson: json,
      gameDataKey: GAME_DATA_KEY,
      gameDataValue: gameDataSource,
    },
  )
  await page.reload()
}
