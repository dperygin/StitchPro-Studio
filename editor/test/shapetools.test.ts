import { describe, expect, it } from 'vitest';
import { APPLIQUE_NAMES, createDocument, createObject, pathNode, type NewObject, type StitchType } from '@stitchpro/engine';
import { Editor, type PointerInput } from '../src/index';

// Default view: 4 px per mm, origin at the top left; rulers off so the origin area is canvas.
const at = (x: number, y: number): PointerInput => ({ x: x * 4, y: y * 4, button: 0 });
function drag(ed: Editor, from: PointerInput, to: PointerInput) {
  ed.pointerDown(from);
  ed.pointerMove({ ...from, x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 });
  ed.pointerMove(to);
  ed.pointerUp(to);
}
const rect = (x0: number, y0: number, x1: number, y1: number) => [pathNode(x0, y0), pathNode(x1, y0), pathNode(x1, y1), pathNode(x0, y1)];
const square = (x0: number, y0: number, size: number, extra: NewObject = {}) => ({ stitchType: 'fill' as const, closed: true, points: rect(x0, y0, x0 + size, y0 + size), ...extra });

function editorWith(items: (NewObject & { stitchType?: StitchType })[]) {
  const doc = createDocument({ closestJoin: false });
  for (const it of items) doc.objects.push(createObject(doc, it));
  const ed = new Editor(doc);
  ed.showRulers = false;
  return { ed, ids: doc.objects.map((o) => o.id) };
}

describe('cut shapes tool', () => {
  it('cuts what the dragged line crosses (everything when nothing is selected), and undoes', () => {
    const { ed, ids } = editorWith([square(10, 10, 20), square(50, 10, 20)]);
    expect(ed.run('tool.cut')).toBe(true);
    expect(ed.toolName).toBe('cut');
    drag(ed, at(20, 0), at(20, 40));
    expect(ed.doc.objects).toHaveLength(3);
    expect(ed.doc.objects[2]!.id).toBe(ids[1]);
    expect(ed.selectionOrder).toHaveLength(2);
    ed.undo();
    expect(ed.doc.objects.map((o) => o.id)).toEqual(ids);
  });

  it('only cuts the selection when there is one, and reports a miss', () => {
    const { ed, ids } = editorWith([square(10, 10, 20), square(10, 40, 20)]);
    ed.setSelection([ids[1]!]);
    ed.setTool('cut');
    drag(ed, at(20, 0), at(20, 80));
    expect(ed.doc.objects).toHaveLength(3);
    expect(ed.doc.objects[0]!.id).toBe(ids[0]);
    expect(ed.cutWithLine([[200, 0], [200, 10]])).toBe(0);
    expect(ed.status).toContain('cuts nothing');
  });
});

describe('shape tools', () => {
  it('knocks the selection out of earlier objects', () => {
    const { ed, ids } = editorWith([square(0, 0, 20), square(5, 5, 10)]);
    ed.setSelection([ids[1]!]);
    expect(ed.run('dialog.knockout')).toBe(true);
    expect(ed.doc.objects).toHaveLength(2);
    expect(ed.doc.objects[0]!.holes).toHaveLength(1);
    expect(ed.selectionOrder).toEqual([ids[1]]);
  });

  it('welds the selection in place of the earliest one, with the first selected settings', () => {
    const { ed, ids } = editorWith([{ stitchType: 'running', points: rect(40, 0, 50, 10) }, square(0, 0, 10, { name: 'A' }), square(5, 5, 10)]);
    ed.setSelection([ids[2]!, ids[1]!]);
    expect(ed.run('arrange.weld')).toBe(true);
    expect(ed.doc.objects).toHaveLength(2);
    expect(ed.doc.objects[0]!.id).toBe(ids[0]);
    expect(ed.doc.objects[1]!.settings.stitchType).toBe('fill');
    expect(ed.selectionOrder).toEqual([ed.doc.objects[1]!.id]);
  });

  it('fills holes right after their object', () => {
    const { ed, ids } = editorWith([square(0, 0, 20, { holes: [rect(5, 5, 15, 15)] }), square(40, 0, 5)]);
    expect(ed.isEnabled('dialog.fillHoles')).toBe(false);
    ed.setSelection([ids[0]!]);
    expect(ed.isEnabled('dialog.fillHoles')).toBe(true);
    expect(ed.fillHoles(0.3)).toBe(1);
    expect(ed.doc.objects.map((o) => o.id).slice(0, 1)).toEqual([ids[0]]);
    expect(ed.doc.objects[2]!.id).toBe(ids[1]);
  });

  it('adds a laydown sewn first', () => {
    const { ed } = editorWith([square(0, 0, 20), { stitchType: 'running', points: [pathNode(30, 5), pathNode(50, 5)] }]);
    expect(ed.addLaydown('outline', 2)).toBe(2);
    expect(ed.doc.objects.slice(0, 2).every((o) => o.settings.stitchType === 'laydown')).toBe(true);
    expect(ed.addLaydown('box', 2)).toBe(1);
    expect(ed.doc.objects[0]!.points).toHaveLength(4);
  });

  it('makes a grouped applique and lets a later fabric cut an earlier cover', () => {
    const { ed, ids } = editorWith([square(0, 0, 20, { color: [200, 0, 0] }), square(15, 5, 20, { color: [0, 0, 200] })]);
    ed.setSelection([ids[0]!]);
    expect(ed.autoApplique({ tackDown: 'zigzag' })).toBe(1);
    ed.setSelection([ed.doc.objects.at(-1)!.id]);
    expect(ed.autoApplique()).toBe(1);
    const names = ed.doc.objects.map((o) => o.name);
    expect(names).toEqual([...Object.values(APPLIQUE_NAMES), ...Object.values(APPLIQUE_NAMES)]);
    const groups = new Set(ed.doc.objects.map((o) => o.groupId));
    expect(groups.size).toBe(2);
    expect(ed.doc.objects[0]!.stopAfter).toBe(true);
    ed.selectAll();
    expect(ed.run('dialog.partialApplique')).toBe(true);
    const firstCover = ed.doc.objects[2]!;
    expect(firstCover.name).toBe(APPLIQUE_NAMES.cover);
    expect(firstCover.closed).toBe(false);
  });
});
