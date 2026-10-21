import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('server-status')).toHaveText('Server: online');
});

test('every top-row button shows a stitched preview on hover', async ({ page }) => {
  const ids = await page.getByTestId('toolbar-digitize').locator('[data-command]').evaluateAll((els) => els.map((e) => e.getAttribute('data-command')!));
  expect(ids.length).toBeGreaterThan(20);
  for (const id of ids) {
    const button = page.getByTestId('toolbar-digitize').locator(`[data-command="${id}"]`);
    await button.hover();
    const card = page.getByTestId('preview-card');
    await expect(card, id).toBeVisible();
    await expect(card.locator('img'), id).toHaveAttribute('src', /^data:image\/png/);
    await page.mouse.move(700, 500);
    await expect(card).toBeHidden();
  }
  await page.getByRole('button', { name: 'Shapes ▾' }).hover();
  await expect(page.getByTestId('preview-card')).toContainText('star');
});

test('the preview card shows on keyboard focus and hides on click', async ({ page }) => {
  const satin = page.locator('[data-command="type.satin"]').first();
  await satin.focus();
  await expect(page.getByTestId('preview-card')).toContainText('Satin: smooth');
  await expect(satin).toHaveAttribute('aria-describedby', /.+/);
  await satin.click();
  await expect(page.getByTestId('preview-card')).toBeHidden();
});

test('preview card picture', async ({ page }) => {
  await page.locator('[data-command="type.satin"]').first().hover();
  await expect(page.getByTestId('preview-card')).toHaveScreenshot('preview-satin.png');
});
