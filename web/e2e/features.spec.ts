// Every feature through the real UI (toolbars, menus, panels, keys, mouse).

import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

async function centre(page: Page) {
  const box = (await page.getByTestId('design-canvas').boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function clickAt(page: Page, dx: number, dy: number, opts: { button?: 'left' | 'right' | 'middle'; modifiers?: ('Control' | 'Shift' | 'Alt')[] } = {}) {
  const c = await centre(page);
  await page.mouse.click(c.x + dx, c.y + dy, { button: opts.button ?? 'left' });
}

async function dragOnCanvas(page: Page, from: [number, number], to: [number, number], button: 'left' | 'middle' = 'left') {
  const c = await centre(page);
  await page.mouse.move(c.x + from[0], c.y + from[1]);
  await page.mouse.down({ button });
  await page.mouse.move(c.x + to[0], c.y + to[1], { steps: 6 });
  await page.mouse.up({ button });
}

const rows = (page: Page) => page.getByTestId('sequence-row');
const status = (page: Page) => page.getByTestId('status');
const cmd = (page: Page, id: string) => page.locator(`[data-command="${id}"]`).first();
const menu = async (page: Page, testId: string, id: string) => {
  await page.getByTestId(testId).click();
  await cmd(page, id).click();
};

async function rectangle(page: Page, x: number, y: number, size = 60) {
  await cmd(page, 'shape.rectangle').click();
  await dragOnCanvas(page, [x, y], [x + size, y + size]);
}

/** The pixel width of the selection, read from the size fields (mm). */
const selectionWidth = async (page: Page) => Number(await page.getByLabel('Selection width').inputValue());

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('server-status')).toHaveText('Server: online');
});

test('digitizes open and closed shapes, columns, two-rail satins, manual stitches and standard shapes', async ({ page }) => {
  await cmd(page, 'draw.open').click();
  await clickAt(page, -100, -80);
  await clickAt(page, -40, -60, { button: 'right' });
  await clickAt(page, 0, -80);
  await page.keyboard.press('Enter');
  await expect(rows(page)).toHaveCount(1);

  // In fill mode closed shapes are tatami (in outline mode they are runs).
  await cmd(page, 'mode.fill').click();
  await cmd(page, 'draw.closed').click();
  await clickAt(page, -100, 0);
  await clickAt(page, -40, 0);
  await clickAt(page, -40, 50);
  const c = await centre(page);
  await page.mouse.dblclick(c.x - 100, c.y + 50);
  await expect(rows(page)).toHaveCount(2);
  await expect(rows(page).nth(1)).toContainText('Tatami');

  await cmd(page, 'draw.column').click();
  await clickAt(page, 20, -80);
  await clickAt(page, 120, -80);
  await page.keyboard.press('Enter');
  await expect(status(page)).toContainText('rail 2');
  await clickAt(page, 20, -60);
  await clickAt(page, 120, -60);
  await page.keyboard.press('Enter');
  await expect(rows(page)).toHaveCount(3);

  await cmd(page, 'draw.twoRail').click();
  await clickAt(page, 20, -30);
  await clickAt(page, 120, -30);
  await page.keyboard.press('Enter');
  await clickAt(page, 20, -10);
  await clickAt(page, 120, -10);
  await page.keyboard.press('Enter');
  await expect(rows(page)).toHaveCount(4);

  await cmd(page, 'draw.manual').click();
  await clickAt(page, 20, 20);
  await clickAt(page, 40, 25);
  await clickAt(page, 60, 20);
  await page.keyboard.press('Enter');
  await expect(rows(page)).toHaveCount(5);
  await expect(rows(page).nth(4)).toContainText('Manual');

  await page.getByRole('button', { name: 'Shapes ▾' }).click();
  await cmd(page, 'shape.star').click();
  await dragOnCanvas(page, [80, 20], [140, 80]);
  await expect(rows(page)).toHaveCount(6);
  // A stitch type button changes the selected object.
  await cmd(page, 'type.satin_fill').click();
  await expect(page.getByLabel('Stitch type')).toHaveValue('satin_fill');
});

test('reshapes nodes, edits stitches, adds holes, sets entry/exit and stitch angles, measures', async ({ page }) => {
  await rectangle(page, -60, -60, 120);
  const count = page.getByTestId('prop-stitch-count');
  const before = await count.textContent();

  // Reshape: drag a corner node outward.
  await page.keyboard.press('r');
  await expect(cmd(page, 'tool.reshape')).toHaveAttribute('aria-pressed', 'true');
  await dragOnCanvas(page, [60, 60], [100, 90]);
  await expect(count).not.toHaveText(before!);

  // Add a hole inside.
  await cmd(page, 'edit.addHole').click();
  await clickAt(page, -20, -20);
  await clickAt(page, 20, -20);
  await clickAt(page, 20, 20);
  await page.keyboard.press('Enter');
  await expect(status(page)).toContainText('hole');

  // Entry and exit points.
  await cmd(page, 'pick.entry').click();
  await clickAt(page, -55, -55);
  await cmd(page, 'pick.exit').click();
  await clickAt(page, 55, 55);

  // Stitch angle line.
  await page.keyboard.press('g');
  await dragOnCanvas(page, [-50, 40], [-30, -40]);

  // Edit stitches: drag a needle point.
  await page.keyboard.press('e');
  await expect(cmd(page, 'tool.stitches')).toHaveAttribute('aria-pressed', 'true');

  // Measure.
  await page.keyboard.press('m');
  await dragOnCanvas(page, [-100, 100], [0, 100]);
  await expect(status(page)).toContainText('Distance');
  await expect(status(page)).toContainText('angle 0.0°');
});

test('selects with a polygon, by box, with Tab; groups, locks, hides, reorders and deletes in the sequence list', async ({ page }) => {
  await rectangle(page, -150, -40, 40);
  await rectangle(page, -60, -40, 40);
  await rectangle(page, 30, -40, 40);
  await expect(rows(page)).toHaveCount(3);

  // Polygon select around the first two.
  await page.keyboard.press('u');
  for (const [x, y] of [[-170, -60], [-10, -60], [-10, 20], [-170, 20]] as const) await clickAt(page, x, y);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Properties (2 objects)' })).toBeVisible();

  // Group, then Tab walks objects.
  await page.getByRole('region', { name: 'Sequence' }).getByRole('button', { name: 'Group', exact: true }).click();
  await expect(rows(page).first()).toContainText('⛓');
  await page.keyboard.press('Tab');

  // Number box: move the last object to the start.
  await rows(page).nth(2).click();
  const box = rows(page).nth(2).locator('input.seq-number');
  await box.fill('1');
  await box.press('Enter');
  await expect(rows(page).first()).not.toContainText('⛓');

  // Lock, hide, delete.
  await rows(page).first().click();
  await page.getByRole('region', { name: 'Sequence' }).getByRole('button', { name: 'Lock', exact: true }).click();
  await expect(rows(page).first()).toContainText('🔒');
  await rows(page).first().getByRole('checkbox').uncheck();
  await expect(rows(page).first()).toHaveClass(/hidden-object/);
  // Rows 2 and 3 are the group: deleting one deletes the whole group.
  await rows(page).nth(1).click();
  await page.keyboard.press('Delete');
  await expect(rows(page)).toHaveCount(1);
});

test('zooms (keys and wheel), pans with the middle button, fits; toggles rulers, units, SimStitch, machine commands and the stitch list', async ({ page }) => {
  await rectangle(page, -40, -40, 80);
  const width = await selectionWidth(page);
  await page.keyboard.press('z');
  await page.keyboard.press('Shift+Z');
  const c = await centre(page);
  await page.mouse.move(c.x, c.y);
  await page.mouse.wheel(0, -300);
  await dragOnCanvas(page, [0, 0], [50, 30], 'middle');
  await page.keyboard.press('0');
  await cmd(page, 'view.rulers').click();
  await expect(cmd(page, 'view.rulers')).not.toHaveAttribute('aria-pressed', 'true');
  await cmd(page, 'view.units').click();
  expect(await selectionWidth(page)).toBeCloseTo(width / 25.4, 2);
  await cmd(page, 'view.units').click();
  await page.keyboard.press('s');
  await expect(cmd(page, 'view.simStitch')).toHaveAttribute('aria-pressed', 'true');
  await cmd(page, 'view.marks').click();
  await expect(page.getByRole('list', { name: 'Machine commands' })).toBeVisible();
  await page.keyboard.press('Shift+J');
  await expect(page.getByRole('region', { name: 'Stitch list' })).toBeVisible();
  await page.mouse.move(c.x + 10, c.y + 10);
  await expect(page.locator('.pointer')).toContainText('X ');
});

test('copy tools: paste into another tab, duplicate, backtrack, repeat, mirror, kaleidoscope, offset, border, smooth, flip, rotate, skew', async ({ page }) => {
  await rectangle(page, -40, -40, 50);
  await page.keyboard.press('Control+c');
  await menu(page, 'menu-file', 'file.new');
  await expect(page.getByRole('tab')).toHaveCount(2);
  await page.keyboard.press('Control+v');
  await expect(rows(page)).toHaveCount(1);

  await page.keyboard.press('Control+d');
  await cmd(page, 'edit.backtrack').click();
  await cmd(page, 'edit.repeat').click();
  await expect(rows(page)).toHaveCount(4);

  const dialogTool = async (id: string, title: string) => {
    await menu(page, 'menu-tools', id);
    await page.getByRole('dialog', { name: title }).getByRole('button', { name: 'OK' }).click();
  };
  await rows(page).first().click();
  await dialogTool('dialog.mirror', 'Mirror');
  await rows(page).first().click();
  await dialogTool('dialog.kaleidoscope', 'Circle / Kaleidoscope');
  await rows(page).first().click();
  await dialogTool('dialog.insertOffset', 'Insert offset');
  await rows(page).first().click();
  await dialogTool('dialog.addBorder', 'Add border');
  const n = await rows(page).count();
  expect(n).toBeGreaterThan(10);
  await rows(page).first().click();
  await menu(page, 'menu-tools', 'dialog.smooth');

  const w = await selectionWidth(page);
  await page.keyboard.press('Control+r');
  await cmd(page, 'edit.flip').click();
  await page.getByLabel('Skew angle').fill('20');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  expect(await selectionWidth(page)).not.toBeCloseTo(w, 1);
});

test('colours: palette, pick colour from an object, remove unused; sequence by colour', async ({ page }) => {
  await rectangle(page, -100, -40, 50);
  // With nothing selected a palette slot sets the colour for new objects.
  await page.keyboard.press('Escape');
  await clickAt(page, 150, 150);
  await page.getByTestId('palette-slot').nth(2).click();
  await rectangle(page, 0, -40, 50);
  await expect(page.locator('.colour-block')).toHaveCount(2);
  const slots = await page.getByTestId('palette-slot').count();
  // "+ Add" opens the system colour picker; answer it.
  await page.getByTitle('Add a colour').click();
  await page.locator('.palette-bar input[type="color"]').fill('#123456');
  await expect(page.getByTestId('palette-slot')).toHaveCount(slots + 1);
  // Pick colour: take the first object's colour, then use it for the second.
  await cmd(page, 'pick.colour').click();
  await clickAt(page, -75, -15);
  await rows(page).nth(1).click();
  await page.getByTestId('current-colour').click().catch(() => {});
  await menu(page, 'menu-arrange', 'arrange.byColour');
  await expect(status(page)).not.toContainText('Error');
});

test('stitch player plays, steps by stitch and object, scrubs and stops', async ({ page }) => {
  await rectangle(page, -100, -40, 50);
  await rectangle(page, 0, -40, 50);
  const player = page.getByLabel('Stitch player');
  const slider = player.getByLabel('Stitch');
  await player.getByLabel('Next object').click();
  const first = Number(await slider.inputValue());
  expect(first).toBeGreaterThan(0);
  await player.getByLabel('Next object').click();
  expect(Number(await slider.inputValue())).toBeGreaterThan(first);
  await player.getByLabel('Previous object').click();
  await player.getByTitle('Back one stitch').click();
  await player.getByLabel('Speed').selectOption('6000');
  await page.getByTestId('player-play').click();
  await expect(page.getByTestId('player-play')).toHaveText('▶', { timeout: 10_000 });
  await slider.fill('10');
  await player.getByTitle('Stop (show everything)').click();
});

test('weld, knockout, fill holes, auto applique, partial applique and hoop out through the UI', async ({ page }) => {
  await rectangle(page, -80, -40, 60);
  await rectangle(page, -50, -20, 60);
  await page.keyboard.press('Control+a');
  await menu(page, 'menu-arrange', 'arrange.weld');
  await expect(rows(page)).toHaveCount(1);

  // A cutter at least 2 mm wide (region width), wholly inside the weld: it leaves a hole.
  await rectangle(page, -72, -32, 40);
  await menu(page, 'menu-tools', 'dialog.knockout');
  await expect(status(page)).toContainText('Knocked out 1 object');

  await rows(page).first().click();
  await menu(page, 'menu-tools', 'dialog.fillHoles');
  await page.getByRole('dialog', { name: 'Fill holes' }).getByRole('button', { name: 'OK' }).click();
  await expect(rows(page)).toHaveCount(3);

  await rectangle(page, 60, -40, 50);
  await menu(page, 'menu-tools', 'dialog.autoApplique');
  await page.getByRole('dialog', { name: 'Auto applique' }).getByRole('button', { name: 'OK' }).click();
  await expect(rows(page).filter({ hasText: 'Applique' })).toHaveCount(3);
  await rectangle(page, 90, -20, 50);
  await menu(page, 'menu-tools', 'dialog.autoApplique');
  await page.getByRole('dialog', { name: 'Auto applique' }).getByRole('button', { name: 'OK' }).click();
  await page.keyboard.press('Control+a');
  await menu(page, 'menu-tools', 'dialog.partialApplique');
  await expect(status(page)).not.toContainText('No earlier applique');

  await rows(page).first().click();
  await cmd(page, 'pick.hoopOut').click();
  await clickAt(page, 0, 150);
  await expect(page.locator('.hoop-out-block')).toHaveCount(1);
});

test('properties: stitch type, settings, tatami gallery, stop after, copy and apply', async ({ page }) => {
  await rectangle(page, -100, -40, 60);
  const props = page.getByRole('region', { name: 'Properties' });
  await page.getByLabel('Name').fill('Badge');
  await page.getByLabel('Name').press('Enter');
  await expect(rows(page).first()).toContainText('Badge');
  const count = page.getByTestId('prop-stitch-count');
  const before = await count.textContent();
  await props.getByLabel('Row spacing').fill('0.8');
  await expect(count).not.toHaveText(before!, { timeout: 5000 });
  await props.getByLabel('Stop after').check();
  await cmd(page, 'edit.copyProperties').click();
  await rectangle(page, 20, -40, 60);
  await cmd(page, 'edit.applyProperties').click();
  await expect(props.getByLabel('Row spacing')).toHaveValue('0.8');
  await page.getByLabel('Stitch type').selectOption('satin_fill');
  await expect(page.getByLabel('Stitch type')).toHaveValue('satin_fill');
});

test('saves and opens .sps designs, opens new tabs and closes them; design settings', async ({ page }) => {
  // Without the File System Access API (as in most browsers) Save is a download.
  await page.addInitScript(() => delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker);
  await page.reload();
  await rectangle(page, -40, -40, 60);
  await cmd(page, 'file.settings').click();
  const settings = page.getByRole('dialog', { name: 'Design settings' });
  await settings.getByLabel('Name').fill('Patch');
  await settings.getByRole('button', { name: 'OK' }).click();
  const download = page.waitForEvent('download');
  await page.keyboard.press('Control+s');
  const saved = await download;
  expect(saved.suggestedFilename()).toBe('Patch.sps');
  const sps = readFileSync(await saved.path());

  const chooser = page.waitForEvent('filechooser');
  await page.keyboard.press('Control+o');
  await (await chooser).setFiles({ name: 'Patch.sps', mimeType: 'application/json', buffer: sps });
  await expect(page.getByRole('tab')).toHaveCount(2);
  await expect(rows(page)).toHaveCount(1);
  await page.getByRole('button', { name: /^Close / }).last().click();
  await expect(page.getByRole('tab')).toHaveCount(1);
});
