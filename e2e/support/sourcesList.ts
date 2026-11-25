import { expect, type Locator } from '@playwright/test'

/**
 * Opens the detail of a line of the Sources list (its name button), unless it is open already, and returns the line. Only a
 * line with controls or a status opens (Make more here, the block lines, Import while something is missing); the controls of a
 * block line (limit, Make it a product, move, Remove) are in its detail, and every other line's help is its name's tooltip.
 */
export async function openLine(line: Locator): Promise<Locator> {
  const toggle = line.getByTestId('sources-line-toggle')
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click()
  return line
}

/** The presets the rule chip of the list reads: 'own' is Make it here. */
export type Preset = 'own' | 'connections-first' | 'byproducts-first'

/**
 * Chooses a preset the way the list writes it, from whatever the rule is now: Make more here switched off is Don't make more
 * here; on, above the block lines it is Make it here and below them Receive it first. Import is not touched.
 */
export async function setPreset(control: Locator, preset: Preset): Promise<void> {
  const makeSwitch = control.getByTestId('sources-make-here-switch')
  const on = (await makeSwitch.getAttribute('aria-checked')) === 'true'
  if (preset === 'byproducts-first') {
    if (on) await makeSwitch.click()
  } else {
    if (!on) await makeSwitch.click()
    await openLine(control.locator('[data-line="make-here"]'))
    await control.getByTestId(preset === 'own' ? 'sources-make-before' : 'sources-make-after').click()
  }
  await expectPreset(control, preset)
}

/** The preset the rule chip of the list reads. */
export const expectPreset = (control: Locator, preset: Preset) => expect(control.getByTestId('sources-rule-chip')).toHaveAttribute('data-preset', preset)

/** The Import switch of the list. */
export const importSwitch = (control: Locator): Locator => control.getByTestId('sources-import-switch')
