import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('server-status')).toHaveText('Server: online');
});

test('auto-digitizes a picture: traces it with a preview, saves the traced SVG and creates stitches', async ({ page }) => {
  // A logo painted in the browser: white background, a red ring, a blue square, a thin black bar.
  const png = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 400;
    c.height = 300;
    const g = c.getContext('2d')!;
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, 400, 300);
    g.fillStyle = '#d0142a';
    g.beginPath();
    g.arc(130, 130, 100, 0, Math.PI * 2);
    g.arc(130, 130, 55, 0, Math.PI * 2, true);
    g.fill();
    g.fillStyle = '#1440c8';
    g.fillRect(260, 40, 110, 110);
    g.fillStyle = '#111111';
    g.fillRect(250, 220, 130, 10);
    return c.toDataURL('image/png').split(',')[1]!;
  });
  await page.locator('[data-command="dialog.autoDigitize"]').click();
  const dialog = page.getByRole('dialog', { name: 'Auto-digitize picture' });
  const chooser = page.waitForEvent('filechooser');
  await dialog.getByRole('button', { name: 'Choose file…' }).click();
  await (await chooser).setFiles({ name: 'logo.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await expect(page.getByTestId('artwork-row')).toHaveCount(1);
  await expect(dialog.getByTestId('trace-summary')).toHaveText('3 colours', { timeout: 15_000 });
  await dialog.getByLabel('Colours', { exact: true }).fill('4');
  await expect(dialog.getByTestId('trace-summary')).toHaveText('3 colours', { timeout: 15_000 });
  await page.screenshot({ path: 'C:/Users/dpery/AppData/Local/Temp/claude/c--Users-dpery-Documents-personal-software-StitchPro/071c55d4-ab6c-4c2a-97ec-e97ccef61c66/scratchpad/autodigitize.png' });

  const download = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Save traced SVG' }).click();
  const svg = readFileSync(await (await download).path(), 'utf8');
  expect(svg.match(/<path /g)).toHaveLength(3);

  await dialog.getByRole('button', { name: 'Create stitches' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId('status')).toContainText('Auto-digitized 3 colours');
  expect(await page.getByTestId('sequence-row').count()).toBeGreaterThanOrEqual(3);
  await expect(page.getByTestId('sequence-row').first()).toContainText('Tatami');
  await page.mouse.move(5, 5);
  await page.screenshot({ path: 'C:/Users/dpery/AppData/Local/Temp/claude/c--Users-dpery-Documents-personal-software-StitchPro/071c55d4-ab6c-4c2a-97ec-e97ccef61c66/scratchpad/autodigitize-result.png' });
});

test('opens on a picture from the artwork panel', async ({ page }) => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEUlEQVR4nGP4z8DwHwyBDABJmgn3YEo8CAAAAABJRU5ErkJggg==', 'base64');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('region', { name: 'Artwork' }).getByRole('button', { name: 'Import…' }).click();
  await (await chooser).setFiles({ name: 'dot.png', mimeType: 'image/png', buffer: png });
  await page.getByLabel('Digitize dot.png').click();
  await expect(page.getByRole('dialog', { name: 'Auto-digitize picture' }).getByLabel('Picture')).toHaveValue('1');
});
