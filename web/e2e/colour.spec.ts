import { expect, test, type Page } from '@playwright/test';

async function drawRectangle(page: Page, half: number) {
  await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
  const box = (await page.getByTestId('design-canvas').boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx - half, cy - half);
  await page.mouse.down();
  await page.mouse.move(cx + half, cy + half, { steps: 5 });
  await page.mouse.up();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('server-status')).toHaveText('Server: online');
});

test('lists hoops grouped by kind, in mm and inches', async ({ page }) => {
  const hoop = page.getByLabel('Hoop');
  await expect(hoop.locator('optgroup[label="Sash frames"]')).toHaveCount(1);
  await hoop.selectOption('rectangle-130x180');
  await expect(hoop.locator('option:checked')).toHaveText('130 x 180 mm (5.1 x 7.1 in)');
});

test('warns on export when the design is bigger than the hoop', async ({ page }) => {
  await drawRectangle(page, 300); // far wider than the 100 mm hoop at the fitted zoom
  let message = '';
  page.once('dialog', async (d) => {
    message = d.message();
    await d.dismiss();
  });
  await page.getByTestId('menu-file').click();
  await page.getByRole('button', { name: 'Export DST' }).click();
  await page.getByRole('dialog', { name: 'Export machine file' }).getByRole('button', { name: 'Export' }).click();
  await expect(page.getByTestId('status')).toContainText('bigger than the hoop');
  expect(message).toContain('bigger than the 100 x 100 mm hoop');
});

test('matches the design to a thread chart', async ({ page }) => {
  await drawRectangle(page, 40);
  await page.getByLabel('Chart').selectOption('Isacord');
  await page.getByRole('button', { name: 'Match design to Isacord' }).click();
  await expect(page.getByTestId('status')).toContainText('Matched to Isacord');
  await expect(page.getByTestId('sequence-row').first()).toBeVisible();
});
