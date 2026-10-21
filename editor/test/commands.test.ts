import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDocument, createObject, pathNode, type Point } from '@stitchpro/engine';
import { COMMANDS, Clipboard, Editor, keyCombo, settingSections, underlaySections, type PointerInput } from '../src/index';

const at = (x: number, y: number, extra: Partial<PointerInput> = {}): PointerInput => ({ x: x * 4, y: y * 4, button: 0, ...extra });
function drag(ed: Editor, from: Point, to: Point, extra: Partial<PointerInput> = {}) {
  ed.pointerDown(at(from[0], from[1], extra));
  ed.pointerMove(at((from[0] + to[0]) / 2, (from[1] + to[1]) / 2, extra));
  ed.pointerMove(at(to[0], to[1], extra));
  ed.pointerUp(at(to[0], to[1], extra));
}
function click(ed: Editor, x: number, y: number, extra: Partial<PointerInput> = {}) {
  ed.pointerDown(at(x, y, extra));
  ed.pointerUp(at(x, y, extra));
}

/** Three running lines, 10 mm long, at y = 0, 10, 20. */
function three(clipboard?: Clipboard) {
  const doc = createDocument({ closestJoin: false });
  for (const y of [0, 10, 20]) doc.objects.push(createObject(doc, { points: [pathNode(0, y), pathNode(10, y)] }));
  const ed = new Editor(doc, { clipboard });
  ed.showRulers = false; // these tests work near the origin, under where the rulers would be
  return { ed, ids: doc.objects.map((o) => o.id) };
}
const order = (ed: Editor) => ed.doc.objects.map((o) => o.id);

afterEach(() => vi.useRealTimers());

describe('the command registry', () => {
  it('has unique ids and a command for every listed shortcut', () => {
    const ids = COMMANDS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    const keys = COMMANDS.flatMap((c) => c.keys ?? []);
    for (const k of ['O', 'R', 'G', 'U', 'E', 'S', 'Z', 'Shift+Z', '0', 'J', 'M', 'L', 'A', 'Shift+J', 'Ctrl+R', 'Ctrl+Shift+K', 'Tab', 'Shift+Tab', 'Ctrl+Z', 'Ctrl+Y', 'Ctrl+C', 'Ctrl+X', 'Ctrl+V', 'Ctrl+D', 'Ctrl+A', 'Ctrl+G', 'Ctrl+Shift+G', 'Ctrl+S', 'Ctrl+Shift+S', 'Delete', 'Enter', 'Backspace', 'Space']) {
      expect(keys, k).toContain(k);
    }
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('builds shortcut strings from key events', () => {
    expect(keyCombo({ key: 'k', ctrl: true, shift: true })).toBe('Ctrl+Shift+K');
    expect(keyCombo({ key: 'Z', shift: true })).toBe('Shift+Z');
    expect(keyCombo({ key: ' ' })).toBe('Space');
    expect(keyCombo({ key: 'Tab', shift: true })).toBe('Shift+Tab');
  });

  it('runs ready commands and refuses the ones built later', () => {
    const { ed } = three();
    expect(ed.isEnabled('dialog.motifStamp')).toBe(false);
    expect(ed.run('dialog.motifStamp')).toBe(false);
    expect(ed.keyDown({ key: 'k', ctrl: true, shift: true })).toBe(true);
    expect(ed.toolName).toBe('cut');
    expect(ed.run('tool.reshape')).toBe(true);
    expect(ed.toolName).toBe('reshape');
    expect(ed.isChecked('tool.reshape')).toBe(true);
  });

  it('asks the host for files, exports and dialogs', () => {
    const { ed } = three();
    const asked: string[] = [];
    ed.onAction((a, arg) => asked.push(arg ? `${a}:${arg}` : a));
    ed.keyDown({ key: 's', ctrl: true });
    ed.keyDown({ key: 'S', ctrl: true, shift: true });
    ed.run('file.export', 'pes');
    ed.run('file.settings');
    expect(asked).toEqual(['save', 'saveAs', 'export:pes', 'settings']);
  });
});

describe('keyboard', () => {
  it('zooms with Z / Shift+Z and fits with 0', () => {
    const { ed } = three();
    ed.setViewport(800, 600);
    const fitted = ed.view.zoom;
    ed.keyDown({ key: 'z' });
    expect(ed.view.zoom).toBeCloseTo(fitted * 1.25, 9);
    ed.keyDown({ key: 'Z', shift: true });
    expect(ed.view.zoom).toBeCloseTo(fitted, 9);
    ed.keyDown({ key: 'z' });
    ed.keyDown({ key: '0' });
    expect(ed.view.zoom).toBeCloseTo(fitted, 9);
  });

  it('walks objects with Tab / Shift+Tab', () => {
    const { ed, ids } = three();
    ed.keyDown({ key: 'Tab' });
    expect(ed.selectionOrder).toEqual([ids[0]]);
    ed.keyDown({ key: 'Tab' });
    expect(ed.selectionOrder).toEqual([ids[1]]);
    ed.keyDown({ key: 'Tab', shift: true });
    ed.keyDown({ key: 'Tab', shift: true });
    expect(ed.selectionOrder).toEqual([ids[2]]);
  });

  it('toggles closest join with J and the stitch list with Shift+J', () => {
    const { ed } = three();
    ed.keyDown({ key: 'j' });
    expect(ed.doc.closestJoin).toBe(true);
    ed.keyDown({ key: 'J', shift: true });
    expect(ed.stitchListOpen).toBe(true);
  });

  it('leaves a copy behind with Alt+arrows (continuous copy)', () => {
    const { ed, ids } = three();
    ed.select(ids[0]!);
    ed.keyDown({ key: 'ArrowRight', alt: true, shift: true });
    expect(ed.doc.objects).toHaveLength(4);
    expect(ed.object(ids[0]!)!.points[0]!.x).toBe(0);
    expect(ed.selectedObjects()[0]!.points[0]!.x).toBe(5);
  });
});

describe('clipboard and copies', () => {
  it('copies in one tab and pastes in another, 2 mm further each time', () => {
    const clipboard = new Clipboard();
    const a = three(clipboard);
    const b = new Editor(createDocument(), { clipboard });
    a.ed.select(a.ids[0]!);
    a.ed.keyDown({ key: 'c', ctrl: true });
    b.keyDown({ key: 'v', ctrl: true });
    b.keyDown({ key: 'v', ctrl: true });
    expect(b.doc.objects).toHaveLength(2);
    expect(b.doc.objects.map((o) => o.points[0]!.x)).toEqual([2, 4]);
    expect(new Set(b.doc.objects.map((o) => o.id)).size).toBe(2);
  });

  it('cuts and duplicates', () => {
    const { ed, ids } = three();
    ed.select(ids[1]!);
    ed.keyDown({ key: 'x', ctrl: true });
    expect(ed.doc.objects).toHaveLength(2);
    ed.keyDown({ key: 'v', ctrl: true });
    ed.keyDown({ key: 'd', ctrl: true });
    expect(ed.doc.objects).toHaveLength(4);
  });

  it('backtracks (reversed) and repeats (same order) with underlay off', () => {
    const { ed, ids } = three();
    ed.select(ids[0]!);
    ed.backtrack();
    const back = ed.selectedObjects()[0]!;
    expect(back.points.map((n) => n.x)).toEqual([10, 0]);
    expect(back.settings.underlayEnabled).toBe(false);
    ed.select(ids[0]!);
    ed.repeat();
    expect(ed.selectedObjects()[0]!.points.map((n) => n.x)).toEqual([0, 10]);
  });

  it('copies and applies properties', () => {
    const { ed, ids } = three();
    ed.select(ids[0]!);
    ed.updateSelectedSettings({ stitchLength: 1.5 });
    ed.copyProperties();
    ed.select(ids[2]!);
    ed.applyProperties();
    expect(ed.object(ids[2]!)!.settings.stitchLength).toBe(1.5);
  });
});

describe('groups and sequencing', () => {
  it('groups: clicking one selects the whole group; ungroup', () => {
    const { ed, ids } = three();
    ed.setSelection([ids[0]!, ids[2]!]);
    ed.keyDown({ key: 'g', ctrl: true });
    ed.clearSelection();
    ed.select(ids[0]!);
    expect([...ed.selection].sort()).toEqual([ids[0], ids[2]].sort());
    ed.keyDown({ key: 'G', ctrl: true, shift: true });
    ed.select(ids[0]!);
    expect(ed.selectionOrder).toEqual([ids[0]]);
  });

  it('moves to start / up / down / end, past whole groups', () => {
    const { ed, ids } = three();
    ed.select(ids[2]!);
    ed.moveSelectionIn('start');
    expect(order(ed)).toEqual([ids[2], ids[0], ids[1]]);
    ed.moveSelectionIn('down');
    expect(order(ed)).toEqual([ids[0], ids[2], ids[1]]);
    ed.moveSelectionIn('end');
    expect(order(ed)).toEqual([ids[0], ids[1], ids[2]]);
    ed.setSelection([ids[0]!, ids[1]!]);
    ed.group();
    ed.select(ids[2]!);
    ed.moveSelectionIn('up'); // jumps over the whole group
    expect(order(ed)).toEqual([ids[2], ids[0], ids[1]]);
  });

  it('sets a sequence number and sequences by selection order', () => {
    const { ed, ids } = three();
    ed.setSequenceNumber(ids[0]!, 3);
    expect(order(ed)).toEqual([ids[1], ids[2], ids[0]]);
    ed.setSelection([ids[0]!, ids[1]!]); // picked: 0 then 1
    ed.sequenceBySelection();
    expect(order(ed)).toEqual([ids[0], ids[1], ids[2]]);
  });

  it('locks, hides and refuses to move locked objects', () => {
    const { ed, ids } = three();
    ed.select(ids[0]!);
    ed.setLocked(true);
    ed.moveSelection(5, 0);
    expect(ed.object(ids[0]!)!.points[0]!.x).toBe(0);
    ed.setVisible(ids[1]!, false);
    expect(ed.totalStitches()).toBe(ed.stitchCount(ed.object(ids[0]!)!) + ed.stitchCount(ed.object(ids[2]!)!));
  });
});

describe('transforms', () => {
  it('rotates 15 degrees with Ctrl+R about the selection centre', () => {
    const { ed, ids } = three();
    ed.select(ids[0]!);
    ed.keyDown({ key: 'r', ctrl: true });
    const [a, b] = ed.object(ids[0]!)!.points;
    expect(a!.x + b!.x).toBeCloseTo(10, 9);
    expect(Math.atan2(b!.y - a!.y, b!.x - a!.x) * (180 / Math.PI)).toBeCloseTo(15, 9);
  });

  it('flips, skews, sets size and position, centres in the hoop', () => {
    const { ed, ids } = three();
    ed.select(ids[0]!);
    ed.flipSelection();
    expect(ed.object(ids[0]!)!.points.map((n) => n.x)).toEqual([10, 0]);
    ed.setSelectionBox({ width: 20, x: 5 });
    expect(ed.selectionBox()).toMatchObject({ minX: 5, maxX: 25 });
    ed.centerInHoop();
    const box = ed.selectionBox()!;
    expect((box.minX + box.maxX) / 2).toBeCloseTo(0, 9);
    ed.setSelection(ids);
    ed.skewSelection(45);
    expect(ed.object(ids[2]!)!.points[0]!.x).not.toBe(ed.object(ids[0]!)!.points[0]!.x);
  });
});

describe('digitizing', () => {
  it('drags standard shapes, Ctrl keeping their proportions', () => {
    const ed = new Editor(createDocument({ closestJoin: false }));
    ed.showRulers = false;
    ed.run('shape.circle');
    drag(ed, [0, 0], [20, 10]);
    const o = ed.doc.objects[0]!;
    expect(o.points).toHaveLength(12);
    expect(o.closed).toBe(true);
    expect(ed.selectionBox()).toMatchObject({ minX: 0, minY: 0, maxX: 20, maxY: 10 });
    drag(ed, [30, 0], [50, 10], { ctrl: true });
    const round = ed.selectedObjects()[0]!;
    const box = ed.selectionBox([round])!;
    expect(box.maxX - box.minX).toBeCloseTo(box.maxY - box.minY, 6);
  });

  it('digitizes two-rail satins rail by rail, and Columns with paired nodes', () => {
    const ed = new Editor(createDocument({ closestJoin: false }));
    ed.showRulers = false;
    ed.run('draw.column');
    click(ed, 0, 0);
    click(ed, 20, 0);
    ed.keyDown({ key: 'Enter' });
    expect(ed.status).toContain('rail 2');
    click(ed, 0, 5);
    click(ed, 20, 5);
    ed.keyDown({ key: 'Enter' });
    const o = ed.doc.objects[0]!;
    expect(o.settings.stitchType).toBe('radial_satin');
    expect(o.settings.pairedRails).toBe(true);
    expect(o.rail2.map((n) => [n.x, n.y])).toEqual([[0, 5], [20, 5]]);
    expect(ed.stitchCount(o)).toBeGreaterThan(50);
  });

  it('adds a hole to the selected closed shape', () => {
    const ed = new Editor(createDocument({ closestJoin: false }));
    ed.showRulers = false;
    ed.run('shape.rectangle');
    drag(ed, [0, 0], [30, 30]);
    ed.run('edit.addHole');
    for (const p of [[10, 10], [20, 10], [20, 20]] as Point[]) click(ed, p[0], p[1]);
    ed.keyDown({ key: 'Enter' });
    expect(ed.doc.objects[0]!.holes).toHaveLength(1);
    expect(ed.toolName).toBe('select');
  });

  it('toggles node types with Space and node widths with [ and ] in reshape', () => {
    const doc = createDocument({ closestJoin: false });
    const o = createObject(doc, { stitchType: 'satin', points: [pathNode(0, 0), pathNode(10, 0)] });
    doc.objects.push(o);
    const ed = new Editor(doc);
    ed.select(o.id);
    ed.setTool('reshape');
    click(ed, 10, 0);
    ed.keyDown({ key: ' ' });
    expect(ed.object(o.id)!.points[1]!.type).toBe('curve');
    ed.keyDown({ key: ']' });
    ed.keyDown({ key: ']' });
    expect(ed.object(o.id)!.points[1]!.width).toBeCloseTo(3.2, 9);
    ed.keyDown({ key: '[' });
    expect(ed.object(o.id)!.points[1]!.width).toBeCloseTo(3.1, 9);
  });

  it('sets the stitch type of new objects and of the selection', () => {
    const { ed, ids } = three();
    ed.select(ids[0]!);
    ed.run('type.satin');
    expect(ed.object(ids[0]!)!.settings.stitchType).toBe('satin');
    ed.clearSelection();
    ed.run('type.stipple');
    expect(ed.drawMode).toMatchObject({ stitchType: 'stipple', closed: true });
  });
});

describe('colours', () => {
  it('uses, adds, edits and removes palette colours', () => {
    const { ed, ids } = three();
    ed.select(ids[0]!);
    ed.useColour([200, 16, 46]);
    expect(ed.object(ids[0]!)!.color).toEqual([200, 16, 46]);
    const i = ed.doc.palette.findIndex((s) => s.color.join() === '200,16,46');
    ed.setPaletteSlot(i, { color: [1, 2, 3], thread: null });
    expect(ed.object(ids[0]!)!.color).toEqual([1, 2, 3]); // recoloured
    expect(ed.removePaletteSlot(i)).toBe(false); // still used
    ed.addPaletteSlot([9, 9, 9]);
    const n = ed.doc.palette.length;
    ed.removeUnusedColours();
    expect(ed.doc.palette.length).toBeLessThan(n);
    expect(ed.doc.palette.every((s) => ed.isColourUsed(s.color))).toBe(true);
  });
});

describe('stitch player and marks', () => {
  it('plays through the stitches and stops', () => {
    vi.useFakeTimers();
    const { ed } = three();
    const total = ed.totalStitches();
    ed.keyDown({ key: ' ' });
    expect(ed.player.playing).toBe(true);
    vi.advanceTimersByTime(5000);
    expect(ed.player.index).toBe(total);
    expect(ed.player.playing).toBe(false);
    ed.playerSeek(3);
    expect(ed.player.index).toBe(3);
    ed.keyDown({ key: 'Escape' });
    expect(ed.player.index).toBeNull();
  });

  it('lists machine marks, cached until the design changes', () => {
    const { ed } = three();
    const a = ed.machineMarks();
    expect(a.some((m) => m.kind === 'start')).toBe(true);
    expect(ed.machineMarks()).toBe(a);
    ed.changed('base');
    expect(ed.machineMarks()).not.toBe(a);
  });

  it('sets a hoop-out point with the pick tool', () => {
    const { ed, ids } = three();
    ed.select(ids[0]!);
    ed.run('pick.hoopOut');
    click(ed, 50, 50);
    expect(ed.object(ids[0]!)!.hoopOut).toEqual([50, 50]);
  });
});

describe('properties metadata', () => {
  it('lists the settings each stitch type uses', () => {
    const keys = (t: Parameters<typeof settingSections>[0]) => settingSections(t).flatMap((s) => s.fields.map((f) => f.key));
    expect(keys('running')).toContain('stitchLength');
    expect(keys('satin')).toEqual(expect.arrayContaining(['satinWidth', 'satinDensity', 'cornerMode', 'raisedLayers', 'raggedMode']));
    expect(keys('fill')).toEqual(expect.arrayContaining(['fillAngle', 'fillRowSpacing', 'fillPattern']));
    expect(keys('fill')).not.toContain('satinWidth');
    expect(underlaySections('running')).toEqual([]);
    const fillUnder = underlaySections('fill').flatMap((s) => s.fields.map((f) => f.key));
    expect(fillUnder).toContain('underlayAngle');
    expect(fillUnder).not.toContain('underlayStartMargin');
    expect(underlaySections('satin').flatMap((s) => s.fields.map((f) => f.key))).toContain('underlay2ZigzagAngle');
  });
});
