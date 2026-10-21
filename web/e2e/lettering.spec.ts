import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('server-status')).toHaveText('Server: online');
});

test('adds lettering in a native font, edits it and adjusts one letter', async ({ page }) => {
  await page.getByRole('button', { name: 'Text ▾' }).click();
  await page.getByRole('button', { name: 'Add text…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add text' });
  await dialog.getByLabel('Text').fill('Hi');
  await dialog.getByRole('option').filter({ hasText: 'StitchPro Sans' }).getByRole('button').click();
  await dialog.getByRole('button', { name: 'OK' }).click();
  const rows = page.getByTestId('sequence-row');
  await expect.poll(() => rows.count()).toBeGreaterThan(1);
  await expect(page.getByTestId('status')).toContainText('Added "Hi"');

  // Edit text rebuilds from the stored spec.
  await page.getByRole('button', { name: 'Text ▾' }).click();
  await page.getByRole('button', { name: 'Edit text…' }).click();
  const edit = page.getByRole('dialog', { name: 'Edit text' });
  await expect(edit.getByLabel('Text')).toHaveValue('Hi');
  await edit.getByLabel('Text').fill('Hiya');
  await edit.getByRole('button', { name: 'OK' }).click();
  await expect.poll(() => rows.count()).toBeGreaterThan(3);

  // Letters mode: its keys move one letter.
  await page.getByTestId('design-canvas').focus();
  await page.keyboard.press('l');
  await expect(page.getByTestId('status')).toContainText('Letters:');
  const before = await page.getByLabel('Selection x').inputValue();
  await page.keyboard.press('Shift+A'); // the first letter moves 5 mm left
  await expect.poll(() => page.getByLabel('Selection x').inputValue()).not.toBe(before);
});

test('adds lettering from a TrueType font as tatami', async ({ page }) => {
  await page.getByRole('button', { name: 'Text ▾' }).click();
  await page.getByRole('button', { name: 'Add text…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add text' });
  await dialog.getByLabel('Text').fill('OK');
  await dialog.getByRole('option').filter({ hasText: /^Oswald/ }).getByRole('button').click();
  await dialog.getByLabel('Stitch').selectOption('fill');
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(page.getByTestId('sequence-row')).toHaveCount(2);
});

test('opens the font editor, drafts letters and saves the font through the server', async ({ page }) => {
  await page.getByRole('button', { name: 'Text ▾' }).click();
  await page.getByRole('button', { name: 'Font editor' }).click();
  await expect(page.getByRole('region', { name: 'Font editor' })).toBeVisible();
  const editor = page.getByRole('region', { name: 'Font editor' });
  await editor.getByLabel('Name').fill('E2E Font');
  await editor.getByLabel('Name').blur();
  page.once('dialog', (d) => d.accept());
  await editor.getByLabel('Draft from font').selectOption('Roboto');
  await editor.getByRole('button', { name: 'Draft from font' }).click();
  await expect(editor.getByRole('status')).toContainText('Drafted');
  page.once('dialog', (d) => d.accept());
  await editor.getByRole('button', { name: 'Save to fonts_spf/' }).click();
  await expect(editor.getByRole('status')).toContainText('Saved E2E Font.spf');
});
