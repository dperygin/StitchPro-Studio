import { expect, test } from '@playwright/test';

test('app loads and reaches the server', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'StitchPro Studio' })).toBeVisible();
  await expect(page.getByTestId('design-canvas')).toBeVisible();
  await expect(page.getByTestId('server-status')).toHaveText('Server: online');
  // Exercise the input wiring and renderer: a click and a wheel zoom.
  const canvas = page.getByTestId('design-canvas');
  await canvas.click({ position: { x: 100, y: 100 } });
  await page.mouse.wheel(0, -100);
  expect(errors).toEqual([]);
});
