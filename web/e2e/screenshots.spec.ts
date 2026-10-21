// Screenshot checks: the main screen, a design, a dialog and a menu against saved images.
// After an intended UI change, look at the new pictures and update them with
//   npm run e2e -- --update-snapshots

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

/** The parts that change from run to run: the pointer readout. */
const masks = (page: Page) => [page.locator('.pointer')];

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('server-status')).toHaveText('Server: online');
});

test('main screen', async ({ page }) => {
  await expect(page).toHaveScreenshot('main-screen.png', { mask: masks(page) });
});

test('a design with a fill, a satin and a selection', async ({ page }) => {
  await page.getByRole('button', { name: 'Circle', exact: true }).click();
  await dragOnCanvas(page, [-120, -80], [-20, 20]);
  await page.locator('[data-command="type.satin"]').first().click();
  await page.locator('[data-command="draw.open"]').first().click();
  const box = (await page.getByTestId('design-canvas').boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.click(cx + 20, cy + 60);
  await page.mouse.click(cx + 140, cy - 60);
  await page.keyboard.press('Enter');
  await page.mouse.move(box.x + 5, box.y + 5);
  await expect(page).toHaveScreenshot('design.png', { mask: masks(page) });
});

test('export dialog', async ({ page }) => {
  await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
  await dragOnCanvas(page, [-60, -40], [60, 40]);
  await page.getByTestId('menu-file').click();
  await page.getByRole('button', { name: 'Export DST' }).click();
  await expect(page.getByRole('dialog', { name: 'Export machine file' })).toHaveScreenshot('export-dialog.png');
});

test('tools menu', async ({ page }) => {
  await page.getByTestId('menu-tools').click();
  await expect(page.getByRole('menu')).toHaveScreenshot('tools-menu.png');
});
