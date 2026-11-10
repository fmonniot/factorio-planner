import { test, expect, type Page } from '@playwright/test'
import path from 'path'
import { loadPlanFixture } from './support/loadPlan'
import { detail, selectSlot, slot } from './support/summary'

/**
 * Fixture: active block "Gears" needs plates and rods from outside. Selecting an
 * Ingredients slot offers Find recipe and Receive from… in the detail strip, with the
 * Comes from control under them (the three presets and the Import switch); the
 * right-click menu holds the connection entries.
 */
const FIXTURE = path.resolve('e2e/fixtures/block-connection.json')

const plateSlot = (page: Page) => slot(page, 'Ingredients', 'Iron plate')
const rodSlot = (page: Page) => slot(page, 'Ingredients', 'Iron rod')
const stripAction = (page: Page, name: string) => detail(page, 'Ingredients').getByRole('button', { name })
const comesFrom = (page: Page) => detail(page, 'Ingredients').getByTestId('comes-from')
const preset = (page: Page, name: string) => comesFrom(page).getByRole('radio', { name })
const importSwitch = (page: Page) => comesFrom(page).getByTestId('import-switch')

test.describe('Ingredients pane', () => {
  test.beforeEach(async ({ page }) => {
    await loadPlanFixture(page, FIXTURE)
    await expect(page.locator('main').getByText('Load game data to begin')).not.toBeVisible({ timeout: 10000 })
    await expect(plateSlot(page)).toBeVisible({ timeout: 10000 })
  })

  test('Find recipe opens the producer picker and adds a row', async ({ page }) => {
    const rows = page.locator('main table tbody tr')
    const before = await rows.count()

    await selectSlot(page, 'Ingredients', 'Iron plate')
    await stripAction(page, 'Find recipe').click()
    await expect(page.getByRole('heading', { name: 'Add recipe' })).toBeVisible()
    await expect(page.getByText("Choose a recipe to produce 'Iron plate'")).toBeVisible()

    const overlay = page.locator('.fixed.inset-0')
    await overlay.locator('[data-testid="recipe-slot"][data-recipe-id="nullius-iron-plate"]').click()

    await expect(page.getByRole('heading', { name: 'Add recipe' })).not.toBeVisible()
    await expect(rows).toHaveCount(before + 1)
  })

  test('Escape closes the Receive from… menu first, then clears the selection', async ({ page }) => {
    await selectSlot(page, 'Ingredients', 'Iron plate')
    await stripAction(page, 'Receive from…').click()
    await expect(page.getByRole('menu')).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(page.getByRole('menu')).not.toBeVisible()
    await expect(plateSlot(page)).toHaveAttribute('aria-pressed', 'true')

    await page.keyboard.press('Escape')
    await expect(plateSlot(page)).toHaveAttribute('aria-pressed', 'false')
  })

  test('Import can be turned off on a raw item that no row makes; the control says it changes nothing and removes it', async ({ page }) => {
    await selectSlot(page, 'Ingredients', 'Iron rod')
    await importSwitch(page).click()
    await expect(importSwitch(page)).toHaveAttribute('aria-checked', 'false')
    await expect(rodSlot(page)).toHaveAttribute('data-status', 'locked')

    const line = comesFrom(page).getByTestId('no-effect')
    await expect(line).toHaveAttribute('data-no-effect', 'not-made')
    await expect(line).toContainText('No row in this block makes Iron rod.')
    await line.getByRole('button', { name: 'Remove' }).click()
    await expect(importSwitch(page)).toHaveAttribute('aria-checked', 'true')
    await expect(comesFrom(page).getByTestId('no-effect')).toHaveCount(0)
    await expect(rodSlot(page)).not.toHaveAttribute('data-status', 'locked')
  })

  test('right click on a slot lists the source blocks and no sourcing or import entry', async ({ page }) => {
    await plateSlot(page).click({ button: 'right' })
    const menu = page.getByRole('menu')
    await expect(menu.locator('[role="menuitem"][data-kind="request"]', { hasText: 'Plates' })).toBeVisible()
    await expect(menu.getByRole('menuitem', { name: 'Make in a new block…' })).toBeVisible()
    await expect(menu.getByRole('menuitem', { name: /imports/i })).toHaveCount(0)
    await expect(menu.getByRole('menuitemradio')).toHaveCount(0)
    await expect(menu.getByRole('menuitemcheckbox')).toHaveCount(0)
  })

  test('Receive from… in the strip opens the same menu', async ({ page }) => {
    await selectSlot(page, 'Ingredients', 'Iron plate')
    await stripAction(page, 'Receive from…').click()
    const menu = page.getByRole('menu')
    await expect(menu.locator('[role="menuitem"][data-kind="request"]', { hasText: 'Plates' })).toBeVisible()
    await expect(menu.getByRole('menuitem', { name: 'Make in a new block…' })).toBeVisible()
  })

  test('each preset and the Import switch has its help text, on hover and on keyboard focus', async ({ page }) => {
    await selectSlot(page, 'Ingredients', 'Iron plate')
    await expect(comesFrom(page)).toBeVisible()
    await expect(comesFrom(page)).toHaveAccessibleName('Comes from')
    const help = [
      ['Make it here', 'Made here; connections and imports cover what is missing.'],
      ['Receive it first', "Taken from this block's connections first; made here for the rest."],
      ["Only what's already made", 'Uses what this block already makes; the rest is received or imported.'],
    ]
    for (const [name, text] of help) {
      await expect(preset(page, name)).toHaveAccessibleDescription(text)
      await preset(page, name).hover()
      await expect(page.getByRole('tooltip').filter({ hasText: text })).toBeVisible()
    }
    await importSwitch(page).hover()
    await expect(page.getByRole('tooltip').filter({ hasText: 'Bring it in from outside the plan.' })).toBeVisible()

    // From the keyboard: Tab from Receive from… lands on the first preset.
    await page.mouse.move(0, 0)
    await stripAction(page, 'Receive from…').focus()
    await page.keyboard.press('Tab')
    await expect(preset(page, 'Make it here')).toBeFocused()
    await expect(page.getByRole('tooltip').filter({ hasText: 'Made here; connections' })).toBeVisible()
  })
})

/**
 * Fixture: the Gears block has a plate row pinned low, so it makes Iron plate and still imports the rest.
 * The item can be given any rule: the presets and the Import switch have an effect on it.
 */
test.describe('Ingredients pane — an item the block makes and still imports', () => {
  test.beforeEach(async ({ page }) => {
    await loadPlanFixture(page, path.resolve('e2e/fixtures/block-partial-import.json'))
    await expect(plateSlot(page)).toBeVisible({ timeout: 10000 })
  })

  test('sets each preset from the Ingredients slot', async ({ page }) => {
    await selectSlot(page, 'Ingredients', 'Iron plate')
    await expect(preset(page, 'Make it here')).toBeChecked()

    await preset(page, 'Receive it first').click()
    await expect(preset(page, 'Receive it first')).toBeChecked()
    await preset(page, "Only what's already made").click()
    await expect(preset(page, "Only what's already made")).toBeChecked()
    await expect(comesFrom(page).getByTestId('sourcing-sentence')).toContainText('No row here already makes Iron plate')
    await preset(page, 'Make it here').click()
    await expect(preset(page, 'Make it here')).toBeChecked()
  })

  test("Only what's already made is disabled while Import is off, and the switch while it is chosen", async ({ page }) => {
    await selectSlot(page, 'Ingredients', 'Iron plate')
    await importSwitch(page).click()
    await expect(plateSlot(page)).toHaveAttribute('data-status', 'locked')
    const third = preset(page, "Only what's already made")
    await expect(third).toHaveAttribute('aria-disabled', 'true')
    await expect(third).toHaveAccessibleDescription('Import is off for Iron plate, so the block has to make it.')
    // Playwright treats aria-disabled as disabled, so force the click that must do nothing.
    await third.click({ force: true })
    await expect(preset(page, 'Make it here')).toBeChecked()

    await importSwitch(page).click()
    await expect(third).not.toHaveAttribute('aria-disabled', 'true')
    await third.click()
    await expect(third).toBeChecked()
    await expect(importSwitch(page)).toHaveAttribute('aria-disabled', 'true')
    await expect(importSwitch(page)).toHaveAccessibleDescription("Only what's already made relies on imports for the rest.")
    await importSwitch(page).click({ force: true })
    await expect(importSwitch(page)).toHaveAttribute('aria-checked', 'true')
  })

  test('the Import switch locks and unlocks the slot; a left click on a locked slot only selects it', async ({ page }) => {
    await selectSlot(page, 'Ingredients', 'Iron plate')
    await importSwitch(page).click()
    await expect(plateSlot(page)).toHaveAttribute('data-status', 'locked')

    await page.keyboard.press('Escape')
    await selectSlot(page, 'Ingredients', 'Iron plate')
    await expect(page.getByRole('heading', { name: 'Add recipe' })).not.toBeVisible()
    await expect(importSwitch(page)).toHaveAttribute('aria-checked', 'false')
    await importSwitch(page).click()
    await expect(plateSlot(page)).not.toHaveAttribute('data-status', 'locked')
  })
})
