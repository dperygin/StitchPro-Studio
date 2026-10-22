import { describe, expect, it } from 'vitest';
import { createDocument, createObject, pathNode, type NewObject } from '@stitchpro/engine';
import { Editor, type PointerInput } from '../src/index';

// Default view: 4 px per mm, origin at the top left; rulers off so the origin area is canvas.
const at = (x: number, y: number, extra: Partial<PointerInput> = {}): PointerInput => ({ x: x * 4, y: y * 4, button: 0, ...extra });
const click = (ed: Editor, x: number, y: number) => {
  ed.pointerDown(at(x, y));
  ed.pointerUp(at(x, y));
};
function drag(ed: Editor, from: [number, number], to: [number, number], extra: Partial<PointerInput> = {}) {
  ed.pointerDown(at(from[0], from[1], extra));
  ed.pointerMove(at((from[0] + to[0]) / 2, (from[1] + to[1]) / 2, extra));
  ed.pointerUp(at(to[0], to[1], extra));
}
function editorWith(items: NewObject[]) {
  const doc = createDocument({ closestJoin: false });
  for (const it of items) doc.objects.push(createObject(doc, it));
  const ed = new Editor(doc);
  ed.showRulers = false;
  return { ed, ids: doc.objects.map((o) => o.id) };
}
const square = { stitchType: 'fill' as const, closed: true, points: [pathNode(10, 10), pathNode(50, 10), pathNode(50, 40), pathNode(10, 40)] };
const twoRail = { stitchType: 'radial_satin' as const, points: [pathNode(10, 10), pathNode(50, 10)], rail2: [pathNode(10, 20), pathNode(50, 20)] };

describe('stitch angle tool', () => {
  it('sets a fill angle: a second drag replaces it instead of warping the rows', () => {
    const { ed, ids } = editorWith([square]);
    ed.select(ids[0]!);
    ed.setTool('angle');
    drag(ed, [20, 30], [30, 20]);
    let o = ed.object(ids[0]!)!;
    expect(o.settings.fillAngle).toBeCloseTo(-45, 6);
    expect(o.stitchAngles).toHaveLength(1);
    const count = ed.stitchCount(o);
    drag(ed, [20, 20], [40, 20]);
    o = ed.object(ids[0]!)!;
    expect(o.settings.fillAngle).toBe(0);
    expect(o.stitchAngles).toEqual([[[20, 20], [40, 20]]]);
    expect(ed.status).toBe('Stitch angle 0°');
    expect(ed.stitchCount(o)).not.toBe(count);
  });

  it('Shift adds a line for a turning fill; a typed angle replaces a single line', () => {
    const { ed, ids } = editorWith([square]);
    ed.select(ids[0]!);
    ed.setTool('angle');
    drag(ed, [15, 30], [25, 15]);
    drag(ed, [35, 30], [45, 25], { shift: true });
    expect(ed.object(ids[0]!)!.stitchAngles).toHaveLength(2);
    expect(ed.status).toContain('2 stitch angle lines');
    // A plain drag starts over with one angle.
    drag(ed, [20, 20], [40, 20]);
    expect(ed.object(ids[0]!)!.stitchAngles).toHaveLength(1);
    // Typing an angle in Properties wins over the single line.
    ed.updateSelectedSettings({ fillAngle: 30 });
    expect(ed.object(ids[0]!)!.stitchAngles).toHaveLength(0);
    expect(ed.object(ids[0]!)!.settings.fillAngle).toBe(30);
  });

  it('sets the angle of a two-rail satin, picking the object under the line when none is selected', () => {
    const { ed, ids } = editorWith([twoRail]);
    ed.setTool('angle');
    const before = ed.stitchCount(ed.object(ids[0]!)!);
    drag(ed, [25, 15], [32, 25]);
    const o = ed.object(ids[0]!)!;
    expect(o.stitchAngles).toHaveLength(1);
    expect(ed.stitchCount(o)).not.toBe(before);
  });

  it('says what to do when nothing is under the line, or the type takes no angle', () => {
    const { ed, ids } = editorWith([{ stitchType: 'satin', points: [pathNode(10, 30), pathNode(50, 30)] }]);
    ed.setTool('angle');
    drag(ed, [80, 80], [90, 90]);
    expect(ed.status).toContain('Select an object first');
    ed.select(ids[0]!);
    drag(ed, [20, 25], [30, 35]);
    expect(ed.status).toContain('apply to fills');
    expect(ed.object(ids[0]!)!.stitchAngles).toHaveLength(0);
  });
});

describe('selecting columns', () => {
  it('selects a two-rail satin by clicking between its rails, and a satin within its width', () => {
    const { ed, ids } = editorWith([twoRail, { stitchType: 'satin', points: [pathNode(10, 40), pathNode(50, 40)] }]);
    click(ed, 30, 15);
    expect(ed.selectionOrder).toEqual([ids[0]]);
    click(ed, 30, 41.2); // 1.2 mm off the centreline of a 3 mm satin
    expect(ed.selectionOrder).toEqual([ids[1]]);
  });
});
