import { test, expect, type Page, type TestInfo } from '@playwright/test'
import fs from 'fs'
import path from 'path'
import { loadPlanFixture } from './support/loadPlan'
import { detail, pane, slotById } from './support/summary'

/**
 * The Metals block of a Seablock plan (initiatives/archive/surplus-rule/coolant-loop.plan.json): it brews new coolant and leaves
 * 2,432 used coolant per minute over, where the player wants every used unit cooled, filtered and reused. The Leftover rule
 * (surplus rule) closes that loop.
 */
const FIXTURE = path.resolve('initiatives/archive/surplus-rule/coolant-loop.plan.json')
const USED = 'angels-liquid-coolant-used'
const STEAM = 'steam'
/** Raw in Metals: no row of the block makes it. */
const CHARCOAL = 'angels-wood-charcoal'

/** Loads the fixture, with `sourceRules` stored on Metals when given. */
async function open(page: Page, testInfo: TestInfo, sourceRules?: Record<string, { leftoverOff: true }>) {
  let file = FIXTURE
  if (sourceRules) {
    const plan = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'))
    plan.blocks[0].sourceRules = sourceRules
    file = testInfo.outputPath('plan.json')
    fs.writeFileSync(file, JSON.stringify(plan))
  }
  await loadPlanFixture(page, file, 'kompetenz-seablock')
  await expect(page.locator('main table tbody tr').first()).toBeVisible({ timeout: 15000 })
}

const byproduct = (page: Page, itemId: string) => slotById(page, 'Byproducts', itemId)

test.describe('Leftover rule', () => {
  test('Use it all here closes the coolant loop: the used coolant leaves the Byproducts pane, and the rule can be removed', async ({ page }, testInfo) => {
    await open(page, testInfo)
    // Today the block dumps the used coolant, and nothing is a rule yet.
    await expect(byproduct(page, USED).first()).toBeVisible()
    await expect(pane(page, 'Ingredients').getByTestId('source-rules')).toHaveCount(0)

    await byproduct(page, USED).first().click()
    await expect(detail(page, 'Byproducts')).toHaveAttribute('data-state', 'selected')
    await detail(page, 'Byproducts').getByRole('button', { name: 'Use it all here' }).click()

    // The solve closes the loop: no used coolant left over, and the cooling now makes steam nothing takes.
    await expect(byproduct(page, USED)).toHaveCount(0)
    await expect(byproduct(page, STEAM).first()).toBeVisible()
    await expect(pane(page, 'Ingredients').getByTestId('source-rules')).toHaveText('Source rules (1)')

    // The rule is in the list, with its name and no grey line.
    await pane(page, 'Ingredients').getByTestId('source-rules').click()
    const entry = page.locator(`[data-testid="source-rule"][data-item-id="${USED}"][data-rule="leftover-off"]`)
    await expect(entry.getByTestId('source-rule-name')).toHaveText('Leftover off')
    await expect(entry).not.toHaveAttribute('data-no-effect', /.+/)

    // Remove it: the loop opens again.
    await entry.getByTestId('source-rule-remove').click()
    await expect(byproduct(page, USED).first()).toBeVisible()
    await expect(pane(page, 'Ingredients').getByTestId('source-rules')).toHaveCount(0)
  })

  test('the right-click menu and the Comes from switch do the same', async ({ page }, testInfo) => {
    await open(page, testInfo)
    await byproduct(page, USED).first().click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Use it all here' }).click()
    await expect(byproduct(page, USED)).toHaveCount(0)

    // The switch of the rule's row is off; turning it on removes the rule, and with it the list.
    await pane(page, 'Ingredients').getByTestId('source-rules').click()
    await page.locator(`[data-testid="source-rule"][data-item-id="${USED}"]`).getByTestId('source-rule-item').click()
    const leftover = page.getByTestId('leftover-switch')
    await expect(leftover).toHaveAttribute('aria-checked', 'false')
    await leftover.click()
    await expect(pane(page, 'Ingredients').getByTestId('source-rules')).toHaveCount(0)
    await expect(byproduct(page, USED).first()).toBeVisible()
  })

  test('a rule on an item no row makes says so, and Remove clears it', async ({ page }, testInfo) => {
    await open(page, testInfo, { [CHARCOAL]: { leftoverOff: true } })
    await pane(page, 'Ingredients').getByTestId('source-rules').click()
    const entry = page.locator(`[data-testid="source-rule"][data-item-id="${CHARCOAL}"][data-rule="leftover-off"]`)
    await expect(entry).toHaveAttribute('data-no-effect', 'not-made')
    await expect(entry.getByTestId('source-rule-reason')).toHaveText('No row here makes it')
    await entry.getByTestId('source-rule-remove').click()
    await expect(pane(page, 'Ingredients').getByTestId('source-rules')).toHaveCount(0)
  })
})
