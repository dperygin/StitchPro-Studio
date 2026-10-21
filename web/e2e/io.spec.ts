import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { createRequire } from 'node:module';

const UTIF = createRequire(import.meta.url)('utif2') as typeof import('utif2');

async function dragOnCanvas(page: Page, from: [number, number], to: [number, number]) {
  const box = (await page.getByTestId('design-canvas').boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx + from[0], cy + from[1]);
  await page.mouse.down();
  await page.mouse.move(cx + to[0], cy + to[1], { steps: 6 });
  await page.mouse.up();
}

async function drawCircle(page: Page) {
  await page.getByRole('button', { name: 'Circle', exact: true }).click();
  await dragOnCanvas(page, [-40, -40], [40, 40]);
  await expect(page.getByTestId('sequence-row')).toHaveCount(1);
}

/** Runs a command that opens a file picker and answers it with the given files. */
async function chooseFiles(page: Page, open: () => Promise<void>, files: { name: string; mimeType: string; buffer: Buffer }[]) {
  const chooser = page.waitForEvent('filechooser');
  await open();
  await (await chooser).setFiles(files);
}

const fileMenu = async (page: Page, command: string) => {
  await page.getByTestId('menu-file').click();
  await page.locator(`[data-command="${command}"]`).first().click();
};

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('server-status')).toHaveText('Server: online');
});

test('exports through the dialog in several formats with a summary', async ({ page }) => {
  await drawCircle(page);
  await page.getByTestId('menu-file').click();
  await page.getByRole('button', { name: 'Export DST' }).click();
  const dialog = page.getByRole('dialog', { name: 'Export machine file' });
  await expect(dialog.getByTestId('export-summary')).toContainText('Colours');
  await expect(dialog.getByTestId('export-summary')).toContainText('mm');
  await dialog.getByLabel('PES').check();
  const names: string[] = [];
  page.on('download', (d) => names.push(d.suggestedFilename()));
  await dialog.getByRole('button', { name: 'Export' }).click();
  await expect(page.getByTestId('status')).toHaveText('Exported DST, PES');
  expect(names.sort()).toEqual(['Untitled.dst', 'Untitled.pes']);
});

test('round-trips a machine file through the server import', async ({ page }) => {
  await drawCircle(page);
  await page.getByTestId('menu-file').click();
  await page.getByRole('button', { name: 'Export DST' }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('dialog', { name: 'Export machine file' }).getByRole('button', { name: 'Export' }).click();
  const dst = readFileSync(await (await download).path());
  await chooseFiles(page, () => fileMenu(page, 'file.importMachine'), [{ name: 'circle.dst', mimeType: 'application/octet-stream', buffer: dst }]);
  await expect(page.getByRole('tab')).toHaveCount(2);
  await expect(page.getByTestId('status')).toContainText('Imported');
  await expect(page.getByTestId('sequence-row').first()).toContainText('Colour 1 run');
});

test('imports a sanitized SVG as stitches', async ({ page }) => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="60mm" height="40mm" viewBox="0 0 60 40" onload="window.__pwned = 1">
    <script>window.__pwned = 2</script>
    <style>@import url(https://example.com/x.css); .r { fill: #c00 }</style>
    <path class="r" d="M0 0H30V30H0Z M10 10V20H20V10Z"/>
    <line x1="35" y1="5" x2="55" y2="5" stroke="#00f" stroke-width="2"/>
    <line x1="35" y1="20" x2="55" y2="20" stroke="#0a0" stroke-width="0.5"/>
    <image href="https://example.com/a.png" width="10" height="10"/>
  </svg>`;
  await chooseFiles(page, () => page.locator('[data-command="file.importSvg"]').click(), [{ name: 'logo.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(svg) }]);
  await expect(page.getByTestId('sequence-row')).toHaveCount(3);
  await expect(page.getByTestId('status')).toContainText('Imported 3 objects');
  expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
  await expect(page.getByTestId('sequence-row').nth(0)).toContainText('Tatami');
  await expect(page.getByTestId('sequence-row').nth(1)).toContainText('Satin');
  await expect(page.getByTestId('sequence-row').nth(2)).toContainText('Run');
});

test('imports artwork pictures and refuses other files with advice', async ({ page }) => {
  // A 2 x 1 PNG.
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEUlEQVR4nGP4z8DwHwyBDABJmgn3YEo8CAAAAABJRU5ErkJggg==', 'base64');
  await chooseFiles(page, () => page.getByRole('region', { name: 'Artwork' }).getByRole('button', { name: 'Import…' }).click(), [{ name: 'trace.png', mimeType: 'image/png', buffer: png }]);
  await expect(page.getByTestId('artwork-row')).toHaveCount(1);
  // TIFF is decoded with utif2.
  const tiff = Buffer.from(UTIF.encodeImage(new Uint8Array([255, 0, 0, 255, 0, 0, 255, 255, 0, 255, 0, 255, 255, 255, 255, 255]), 2, 2));
  await chooseFiles(page, () => page.locator('[data-command="file.importArtwork"]').first().click(), [{ name: 'scan.tif', mimeType: 'image/tiff', buffer: tiff }]);
  await expect(page.getByTestId('artwork-row')).toHaveCount(2);
  await expect(page.getByTestId('status')).toHaveText('Imported 1 picture');
  await page.getByLabel('Remove scan.tif').click();
  await page.getByLabel('Lock trace.png').check();
  await expect(page.getByLabel('Opacity of trace.png')).toBeDisabled();
  await chooseFiles(page, () => page.locator('[data-command="file.importArtwork"]').first().click(), [{ name: 'photo.heic', mimeType: 'image/heic', buffer: Buffer.from('x') }]);
  await expect(page.getByTestId('status')).toContainText('Save it as PNG');
  await expect(page.getByTestId('artwork-row')).toHaveCount(1);
});

test('prints the worksheet, a tiled template and a picture; exports SVG', async ({ page }) => {
  await drawCircle(page);
  let download = page.waitForEvent('download');
  await fileMenu(page, 'file.printWorksheet');
  expect((await download).suggestedFilename()).toBe('Untitled worksheet.pdf');
  expect(readFileSync(await (await download).path()).subarray(0, 4).toString()).toBe('%PDF');

  await fileMenu(page, 'file.printTemplate');
  const tpl = page.getByRole('dialog', { name: 'Placement template' });
  await tpl.getByLabel('Paper').selectOption('A5');
  download = page.waitForEvent('download');
  await tpl.getByRole('button', { name: 'OK' }).click();
  expect((await download).suggestedFilename()).toBe('Untitled template.pdf');

  download = page.waitForEvent('download');
  await fileMenu(page, 'file.printImage');
  expect((await download).suggestedFilename()).toBe('Untitled.png');

  await fileMenu(page, 'file.exportSvg');
  download = page.waitForEvent('download');
  await page.getByRole('dialog', { name: 'Export SVG' }).getByRole('button', { name: 'OK' }).click();
  const svg = readFileSync(await (await download).path(), 'utf8');
  expect(svg).toMatch(/width="[\d.]+mm"/);
});

test('autosaves tabs and restores them; remembers preferences', async ({ page }) => {
  await drawCircle(page);
  await page.locator('[data-command="view.grid"]').click();
  await page.waitForTimeout(2000);
  await page.reload();
  await expect(page.getByTestId('sequence-row')).toHaveCount(1);
  await expect(page.getByTestId('status')).toContainText('Restored 1 design');
  await expect(page.locator('[data-command="view.grid"]')).toHaveAttribute('aria-pressed', 'true');
  // Closing the tab forgets it.
  await page.getByRole('button', { name: /^Close / }).click();
  await page.waitForTimeout(300);
  await page.reload();
  await expect(page.getByTestId('sequence-row')).toHaveCount(0);
});
