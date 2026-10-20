import { type Page } from '@playwright/test'
import fs from 'fs'
import { legacyPlanStorageKey, planIndexKey, planKey } from '../../src/store/sourceId'

// Plans are stored per data set, several per data set (see src/store/persistence.ts).
const GAME_DATA_KEY = 'factorio-planner:game-data-source'

/**
 * Load a plan fixture JSON into the app via localStorage injection.
 *
 * The fixture is seeded under the old single-plan key, so the app migrates it
 * into the plan list (as the active "Plan 1" on a fresh profile). The seed
 * runs on every navigation, so each reload adds one more plan; specs that
 * count plans must not use this.
 *
 * Plants localStorage with `addInitScript` so it is set before any page
 * script runs, then navigates once. Avoids the goto → evaluate → reload
 * race where Vite's HMR/module-loading can navigate the page between
 * the initial goto and a follow-up `page.evaluate`, destroying the
 * execution context.
 *
 * @param page             Playwright page object
 * @param planFixturePath  Absolute path to an exported plan JSON file
 * @param gameDataSource   Which bundled dataset to auto-load ('nullius'),
 *                         or 'kompetenz-seablock', or null to skip (game data
 *                         must be loaded manually; the plan goes to Nullius)
 */
export async function loadPlanFixture(
  page: Page,
  planFixturePath: string,
  gameDataSource: 'nullius' | 'kompetenz-seablock' | null = 'nullius',
): Promise<void> {
  const json = fs.readFileSync(planFixturePath, 'utf8')
  await page.addInitScript(
    ({ stateKey, stateJson, gameDataKey, gameDataValue }) => {
      localStorage.setItem(stateKey, stateJson)
      if (gameDataValue) localStorage.setItem(gameDataKey, gameDataValue)
    },
    {
      stateKey: legacyPlanStorageKey(gameDataSource ?? 'nullius'),
      stateJson: json,
      gameDataKey: GAME_DATA_KEY,
      gameDataValue: gameDataSource,
    },
  )
  await page.goto('/')
}

/** The active plan of a data set as saved in localStorage (parsed JSON). */
export async function readActivePlan(page: Page, sourceId: string): Promise<unknown> {
  return page.evaluate(
    ({ indexKey, keyPrefix }) => {
      const index = JSON.parse(localStorage.getItem(indexKey)!) as { activePlanId: string }
      return JSON.parse(localStorage.getItem(keyPrefix + index.activePlanId)!)
    },
    { indexKey: planIndexKey(sourceId), keyPrefix: planKey(sourceId, '') },
  )
}
