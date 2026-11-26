import { test, expect } from '@playwright/test'
import path from 'path'
import fs from 'fs'
import { loadPlanFixture, readActivePlan } from './support/loadPlan'
import { selectRow } from './support/sidePanel'

/**
 * One Seablock row: gear wheels in assembling machines 2 (0.75 speed, 135 kW) with 2 beacons of 2 speed modules 3
 * (+80 % speed and +140 % energy per beacon pair: speed 0.75 x 2.6 = 1.95, energy x 3.8). Pinned at 936 runs/min, that
 * is exactly 4 machines. The beacon entity draws 480 kW (read from the bundle).
 */
const FIXTURE = path.resolve('e2e/fixtures/not-in-golden/beacon-power-seablock.json')
const SOURCE = 'kompetenz-seablock'
const MACHINES = 4
const MACHINE_KW = MACHINES * 135 * 3.8
const BEACON_KW = 480

const SCALE = { W: 0.001, kW: 1, MW: 1000, GW: 1_000_000 } as const

/** "5.9MW" as kW, with the rounding error of the figure in kW. */
function parsePower(text: string): { kw: number; err: number } {
  const m = /([\d.]+)\s*(W|kW|MW|GW)/.exec(text)
  if (!m) throw new Error(`No power in "${text}"`)
  const unit = m[2] as keyof typeof SCALE
  return { kw: parseFloat(m[1]) * SCALE[unit], err: (unit === 'W' ? 0.5 : 0.05) * SCALE[unit] }
}

async function powerOf(locator: import('@playwright/test').Locator) {
  return parsePower((await locator.textContent()) ?? '')
}

interface Config { beaconId?: string; machinesPerBeacon?: number }
async function savedConfig(page: import('@playwright/test').Page): Promise<Config> {
  const plan = (await readActivePlan(page, SOURCE)) as { blocks: { rootPlan: { nodes: { beaconConfigs: Config[] }[] } }[] }
  return plan.blocks[0].rootPlan.nodes[0].beaconConfigs[0]
}

test('a row pays for its beacons, shared beacons cost less, and the effects stay put', async ({ page }) => {
  await loadPlanFixture(page, FIXTURE, SOURCE)
  const row = page.locator('main table tbody tr').first()
  const power = row.getByTestId('row-power')
  await expect(power).toBeVisible({ timeout: 20000 })

  // Machine part + 4 machines x 2 beacons x 480 kW.
  const expected = MACHINE_KW + MACHINES * 2 * BEACON_KW
  const full = await powerOf(power)
  expect(Math.abs(full.kw - expected)).toBeLessThanOrEqual(full.err + 1e-9)
  const total = await powerOf(page.getByTestId('block-power-total'))
  expect(Math.abs(total.kw - full.kw)).toBeLessThanOrEqual(total.err + full.err + 1e-9)

  // The tooltip splits the row's power: 4 machines 2.1MW (2052 kW), 8 beacons 3.8MW (3840 kW).
  await expect(power).toHaveAttribute('data-tip', 'Machines 2.1MW · Beacons 3.8MW')

  const panel = await selectRow(page, row)
  await expect(panel.getByTestId('beacon-sharing')).toHaveValue('1')
  await expect(panel.getByTestId('beacon-power')).toContainText(/^≈ 8 beacons · 3\.8MW$/)

  // Two machines per beacon halves the beacon part: machines x 1 x 480 kW less.
  await panel.getByLabel('Machines per beacon').fill('2')
  const shared = expected - MACHINES * 1 * BEACON_KW
  // The figure is rounded to 0.1 MW, so compare within that rounding.
  await expect.poll(async () => { const p = await powerOf(power); return Math.abs(p.kw - shared) <= p.err + 1e-9 }).toBe(true)
  await expect.poll(async () => (await savedConfig(page)).machinesPerBeacon).toBe(2)
  await expect(panel.getByTestId('beacon-power')).toContainText(/^≈ 4 beacons · 1\.9MW$/)
  // The effects did not change: still 4 machines.
  await expect(row).toContainText('4')

  // Back to 1 removes the key.
  await panel.getByLabel('Machines per beacon').fill('1')
  await expect.poll(async () => 'machinesPerBeacon' in (await savedConfig(page))).toBe(false)
  await expect.poll(async () => { const p = await powerOf(power); return Math.abs(p.kw - expected) <= p.err + 1e-9 }).toBe(true)
})

test('a beacon without energy data adds nothing', async ({ page }, testInfo) => {
  // ee-super-beacon is hidden from the picker, so the fixture is rewritten to use it.
  const plan = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'))
  plan.blocks[0].rootPlan.nodes[0].beaconConfigs[0].beaconId = 'ee-super-beacon'
  const fixture = testInfo.outputPath('plan.json')
  fs.mkdirSync(path.dirname(fixture), { recursive: true })
  fs.writeFileSync(fixture, JSON.stringify(plan))
  await loadPlanFixture(page, fixture, SOURCE)
  const row = page.locator('main table tbody tr').first()
  await expect(row.getByTestId('row-power')).toBeVisible({ timeout: 20000 })
  const panel = await selectRow(page, row)
  await expect(panel.getByTestId('beacon-sharing')).toBeVisible()
  await expect(panel.getByTestId('beacon-power')).toHaveCount(0)
  // The super beacon's speed differs, so the machine count does too: the row stays below the machine part of 4 machines plus 8 beacons.
  await expect(row.getByTestId('row-power')).not.toHaveAttribute('data-tip', /Beacons/)
  const { kw } = await powerOf(row.getByTestId('row-power'))
  expect(kw).toBeLessThan(MACHINE_KW + MACHINES * 2 * BEACON_KW)
})
