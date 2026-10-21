import { expect, test, type Page } from '@playwright/test';

async function dragOnCanvas(page: Page, from: [number, number], to: [number, number]) {
  const box = (await page.getByTestId('design-canvas').boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx + from[0], cy + from[1]);
  await page.mouse.down();
  await page.mouse.move(cx + to[0], cy + to[1], { steps: 6 });
  await page.mouse.up();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('server-status')).toHaveText('Server: online');
});

test('shows the three toolbars, panels, colour bar and status bar', async ({ page }) => {
  await expect(page.getByTestId('toolbar-digitize')).toBeVisible();
  await expect(page.getByTestId('toolbar-edit')).toBeVisible();
  await expect(page.getByTestId('toolbar-tools')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Sequence' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Properties' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Colours' })).toBeVisible();
  await expect(page.getByTestId('palette-slot')).toHaveCount(12);
  await expect(page.getByRole('tab')).toHaveCount(1);
  // Commands built in later steps are shown but disabled.
  await page.getByTestId('menu-tools').click();
  await expect(page.locator('[data-command="dialog.motifStamp"]')).toBeDisabled();
});

test('draws a shape, lists it, edits its properties and undoes', async ({ page }) => {
  await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
  await dragOnCanvas(page, [-60, -40], [60, 40]);
  await expect(page.getByTestId('sequence-row')).toHaveCount(1);
  await expect(page.getByTestId('status')).toContainText('Added');
  const total = page.getByTestId('stitch-total');
  await expect(total).not.toHaveText('0 stitches');

  // Change the stitch type in the Properties panel.
  await page.getByLabel('Stitch type').selectOption('stipple');
  await expect(page.locator('[data-command="type.stipple"]')).toHaveAttribute('aria-pressed', 'true');

  // Undo twice (type change, then the shape) with the keyboard.
  await page.getByTestId('design-canvas').focus();
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  await expect(page.getByTestId('sequence-row')).toHaveCount(0);
});

test('digitizes an open line with clicks and Enter', async ({ page }) => {
  await page.getByRole('button', { name: 'Open Shape' }).click();
  const box = (await page.getByTestId('design-canvas').boundingBox())!;
  await page.mouse.click(box.x + 200, box.y + 200);
  await page.mouse.click(box.x + 300, box.y + 220);
  await page.mouse.click(box.x + 380, box.y + 180, { button: 'right' });
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('sequence-row')).toHaveCount(1);
  await expect(page.getByTestId('sequence-row')).toContainText('Run');
});

test('exports a machine file through the server', async ({ page }) => {
  await page.getByRole('button', { name: 'Circle', exact: true }).click();
  await dragOnCanvas(page, [-40, -40], [40, 40]);
  await page.getByTestId('menu-file').click();
  await page.getByRole('button', { name: 'Export DST' }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('dialog', { name: 'Export machine file' }).getByRole('button', { name: 'Export' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('Untitled.dst');
  await expect(page.getByTestId('status')).toHaveText('Exported DST');
});
