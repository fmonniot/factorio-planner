import { test, expect, type Page } from '@playwright/test'
import path from 'path'

const GAME_DATA_PATH = path.resolve('data/samples/nullius/game-data.json')
const STORAGE_KEY = 'factorio-planner:game-data-source'
const IDB_NAME = 'factorio-planner'
const IDB_STORE = 'game-data'
const IDB_KEY = 'custom'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function clearStorage(page: Page) {
  await page.evaluate(({ idbName, idbStore, idbKey }) => {
    localStorage.clear()
    return new Promise<void>((resolve, reject) => {
      const req = indexedDB.open(idbName, 1)
      req.onupgradeneeded = () => req.result.createObjectStore(idbStore)
      req.onsuccess = () => {
        const db = req.result
        const tx = db.transaction(idbStore, 'readwrite')
        tx.objectStore(idbStore).delete(idbKey)
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
      }
      req.onerror = () => reject(req.error)
    })
  }, { idbName: IDB_NAME, idbStore: IDB_STORE, idbKey: IDB_KEY })
}

async function seedIndexedDB(page: Page, json: string, filename: string) {
  await page.evaluate(({ idbName, idbStore, idbKey, json, filename }) => {
    return new Promise<void>((resolve, reject) => {
      const req = indexedDB.open(idbName, 1)
      req.onupgradeneeded = () => req.result.createObjectStore(idbStore)
      req.onsuccess = () => {
        const db = req.result
        const tx = db.transaction(idbStore, 'readwrite')
        tx.objectStore(idbStore).put({ json, filename }, idbKey)
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
      }
      req.onerror = () => reject(req.error)
    })
  }, { idbName: IDB_NAME, idbStore: IDB_STORE, idbKey: IDB_KEY, json, filename })
}

async function getIndexedDBEntry(page: Page): Promise<{ json: string; filename: string } | null> {
  return page.evaluate(({ idbName, idbStore, idbKey }) => {
    return new Promise<{ json: string; filename: string } | null>((resolve, reject) => {
      const req = indexedDB.open(idbName, 1)
      req.onupgradeneeded = () => req.result.createObjectStore(idbStore)
      req.onsuccess = () => {
        const db = req.result
        const tx = db.transaction(idbStore, 'readonly')
        const getReq = tx.objectStore(idbStore).get(idbKey)
        getReq.onsuccess = () => resolve(getReq.result ?? null)
        getReq.onerror = () => reject(getReq.error)
      }
      req.onerror = () => reject(req.error)
    })
  }, { idbName: IDB_NAME, idbStore: IDB_STORE, idbKey: IDB_KEY })
}

const gameDataSelect = (page: Page) =>
  page.getByRole('combobox', { name: 'Game data source' })

const mainHint = (page: Page, text: string) =>
  page.locator('main').getByText(text)

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('game data source selector', () => {
  // Each test starts with a clean slate.
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await clearStorage(page)
    await page.reload()
  })

  test('first visit — shows placeholder, nothing loaded', async ({ page }) => {
    await expect(gameDataSelect(page)).toHaveValue('')
    await expect(mainHint(page, 'Load game data to begin')).toBeVisible()
  })

  test('select Nullius — fetches data, persists to localStorage', async ({ page }) => {
    await gameDataSelect(page).selectOption('nullius')
    // Wait for loading to finish (hint disappears).
    await expect(mainHint(page, 'Load game data to begin')).not.toBeVisible({ timeout: 10000 })
    await expect(gameDataSelect(page)).toHaveValue('nullius')
    const stored = await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY)
    expect(stored).toBe('nullius')
  })

  test('reload with persisted server selection — auto-loads Nullius', async ({ page }) => {
    // Seed localStorage before navigating.
    await page.evaluate(
      ([key, value]) => localStorage.setItem(key, value),
      [STORAGE_KEY, 'nullius'] as [string, string],
    )
    await page.reload()
    await expect(gameDataSelect(page)).toHaveValue('nullius')
    await expect(mainHint(page, 'Load game data to begin')).not.toBeVisible({ timeout: 10000 })
  })

  test('upload custom file — select shows filename, saved to IndexedDB', async ({ page }) => {
    const fileInput = page.locator('input[type="file"]')
    await fileInput.setInputFiles(GAME_DATA_PATH)
    const filename = path.basename(GAME_DATA_PATH)
    await expect(gameDataSelect(page)).toHaveValue(`custom:${filename}`, { timeout: 10000 })
    await expect(mainHint(page, 'Load game data to begin')).not.toBeVisible()
    const entry = await getIndexedDBEntry(page)
    expect(entry).not.toBeNull()
    expect(entry?.filename).toBe(filename)
  })

  test('reload with custom file in IndexedDB — auto-loads, select shows filename', async ({ page }) => {
    // Read the game data file content to seed IndexedDB.
    const fs = await import('fs/promises')
    const json = await fs.readFile(GAME_DATA_PATH, 'utf-8')
    const filename = path.basename(GAME_DATA_PATH)
    await seedIndexedDB(page, json, filename)
    await page.reload()
    await expect(gameDataSelect(page)).toHaveValue(`custom:${filename}`, { timeout: 10000 })
    await expect(mainHint(page, 'Load game data to begin')).not.toBeVisible()
  })

  test('switch from custom to Nullius — clears IndexedDB, writes localStorage', async ({ page }) => {
    // Seed IndexedDB with a custom entry, then navigate.
    const fs = await import('fs/promises')
    const json = await fs.readFile(GAME_DATA_PATH, 'utf-8')
    const filename = path.basename(GAME_DATA_PATH)
    await seedIndexedDB(page, json, filename)
    await page.reload()
    await expect(gameDataSelect(page)).toHaveValue(`custom:${filename}`, { timeout: 10000 })

    // Now switch to Nullius.
    await gameDataSelect(page).selectOption('nullius')
    await expect(gameDataSelect(page)).toHaveValue('nullius')
    await expect(mainHint(page, 'Load game data to begin')).not.toBeVisible({ timeout: 10000 })

    const entry = await getIndexedDBEntry(page)
    expect(entry).toBeNull()
    const stored = await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY)
    expect(stored).toBe('nullius')
  })
})
