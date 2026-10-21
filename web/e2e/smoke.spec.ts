import { expect, test } from '@playwright/test';

test('app loads and reaches the server', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'StitchPro Studio' })).toBeVisible();
  await expect(page.getByTestId('design-canvas')).toBeVisible();
  await expect(page.getByTestId('server-status')).toHaveText('Server: online');
});
