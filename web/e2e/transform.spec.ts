import { expect, test, type Page } from '@playwright/test';

async function drawRectangle(page: Page) {
  await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
  const box = (await page.getByTestId('design-canvas').boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx - 50, cy - 50);
  await page.mouse.down();
  await page.mouse.move(cx + 50, cy + 50, { steps: 5 });
  await page.mouse.up();
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  return { cx, cy };
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('server-status')).toHaveText('Server: online');
});

test('resizes with a corner handle', async ({ page }) => {
  const { cx, cy } = await drawRectangle(page);
  const width = page.getByLabel('Selection width');
  const before = Number(await width.inputValue());
  // The south-east handle sits 8 px outside the box corner.
  await page.mouse.move(cx + 58, cy + 58);
  await page.mouse.down();
  await page.mouse.move(cx + 108, cy + 108, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => Number(await width.inputValue())).toBeGreaterThan(before * 1.3);
  await page.screenshot({ path: test.info().outputPath('handles.png') });
});

test('makes an array of copies from the dialog', async ({ page }) => {
  await drawRectangle(page);
  await page.getByRole('button', { name: 'Tools ▾' }).click();
  await page.getByRole('button', { name: 'Array…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Array' });
  await dialog.getByLabel('Rows').fill('2');
  await dialog.getByLabel('Columns').fill('2');
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(page.getByTestId('sequence-row')).toHaveCount(4);
});

test('arranges from the Arrange menu', async ({ page }) => {
  await drawRectangle(page);
  await page.keyboard.press('Control+d');
  await expect(page.getByTestId('sequence-row')).toHaveCount(2);
  await page.keyboard.press('Control+a');
  await page.getByTestId('menu-arrange').click();
  await page.getByRole('button', { name: 'Align left with the last selected' }).click();
  await expect(page.getByTestId('status')).not.toContainText('Error');
});
