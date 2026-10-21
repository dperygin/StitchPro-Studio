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
  await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
  await dragOnCanvas(page, [-60, -40], [60, 40]);
  await expect(page.getByTestId('sequence-row')).toHaveCount(1);
});

test('cuts a shape in two with the Cut shapes tool', async ({ page }) => {
  await page.locator('[data-command="tool.cut"]').click();
  await dragOnCanvas(page, [0, -80], [0, 80]);
  await expect(page.getByTestId('sequence-row')).toHaveCount(2);
  await expect(page.getByTestId('status')).toContainText('into 2 pieces');
});

test('adds a laydown under the design from the Tools menu', async ({ page }) => {
  await page.getByTestId('menu-tools').click();
  await page.locator('[data-command="dialog.laydown"]').click();
  const dialog = page.getByRole('dialog', { name: 'Laydown' });
  await dialog.getByLabel('Shape').selectOption('ellipse');
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(page.getByTestId('sequence-row')).toHaveCount(2);
  await expect(page.getByTestId('sequence-row').first()).toContainText('Laydown');
});
