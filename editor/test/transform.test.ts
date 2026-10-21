import { describe, expect, it } from 'vitest';
import { createDocument, createObject, pathNode, ringArea, type NewObject, type Point, type StitchType } from '@stitchpro/engine';
import {
  Editor,
  moveByColourBlock,
  optimizeColourChanges,
  selectionHandles,
  sequenceByColour,
  type Box,
  type HandleKind,
  type PointerInput,
} from '../src/index';

// Default view: 4 px per mm, origin at the top left; rulers off so the origin area is canvas.
const at = (x: number, y: number, extra: Partial<PointerInput> = {}): PointerInput => ({ x: x * 4, y: y * 4, button: 0, ...extra });
function drag(ed: Editor, from: PointerInput, to: PointerInput) {
  ed.pointerDown(from);
  ed.pointerMove({ ...from, x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 });
  ed.pointerMove(to);
  ed.pointerUp(to);
}
const click = (ed: Editor, p: PointerInput) => {
  ed.pointerDown(p);
  ed.pointerUp(p);
};
const rect = (x0: number, y0: number, x1: number, y1: number) => [pathNode(x0, y0), pathNode(x1, y0), pathNode(x1, y1), pathNode(x0, y1)];

function editorWith(items: (NewObject & { stitchType?: StitchType })[]) {
  const doc = createDocument({ closestJoin: false });
  for (const it of items) doc.objects.push(createObject(doc, it));
  const ed = new Editor(doc);
  ed.showRulers = false;
  return { ed, ids: doc.objects.map((o) => o.id) };
}
const square = (x0: number, y0: number, size: number, extra: NewObject = {}) => ({ stitchType: 'fill' as const, closed: true, points: rect(x0, y0, x0 + size, y0 + size), ...extra });
const handle = (ed: Editor, kind: HandleKind) => {
  const h = selectionHandles(ed).find((x) => x.kind === kind)!;
  return { x: h.x, y: h.y, button: 0 as const };
};
const box = (ed: Editor, id: number): Box => ed.selectionBox([ed.object(id)!])!;

describe('snapping and the 15 degree constraint', () => {
  it('snaps to grid lines within 8 px, guides first; Alt holds it free', () => {
    const { ed } = editorWith([]);
    ed.snap = true;
    ed.gridSpacing = 10;
    expect(ed.snapPoint([9.6, 20.4])).toEqual([10, 20]); // within 2 mm (8 px at 4 px/mm)
    expect(ed.snapPoint([6, 25])).toEqual([6, 25]);
    expect(ed.snapPoint([9.6, 20.4], { alt: true })).toEqual([9.6, 20.4]);
    ed.addGuide('v', 8.5);
    expect(ed.snapPoint([9.6, 20.4])).toEqual([8.5, 20]);
    ed.snap = false;
    expect(ed.snapPoint([9.6, 20.4])).toEqual([9.6, 20.4]);
  });

  it('snaps digitized nodes and constrains lines to 15 degrees with Ctrl', () => {
    const { ed } = editorWith([]);
    ed.snap = true;
    ed.startDrawing({ stitchType: 'running', closed: false });
    click(ed, at(0.4, 0.3));
    click(ed, at(10, 2.5, { ctrl: true })); // 14 degrees -> 15
    ed.keyDown({ key: 'Enter' });
    const [a, b] = ed.doc.objects[0]!.points;
    expect([a!.x, a!.y]).toEqual([0, 0]);
    expect((Math.atan2(b!.y - a!.y, b!.x - a!.x) * 180) / Math.PI).toBeCloseTo(15, 9);
    expect(Math.hypot(b!.x, b!.y)).toBeCloseTo(Math.hypot(10, 2.5), 9);
  });

  it('drags guides out of the rulers and back to remove them', () => {
    const { ed } = editorWith([]);
    ed.showRulers = true;
    drag(ed, { x: 200, y: 10 }, { x: 200, y: 120 }); // from the top ruler
    expect(ed.doc.guides).toEqual([{ axis: 'h', pos: 30 }]);
    drag(ed, { x: 200, y: 120 }, { x: 200, y: 160 }); // grab it and move it
    expect(ed.doc.guides).toEqual([{ axis: 'h', pos: 40 }]);
    drag(ed, { x: 200, y: 160 }, { x: 200, y: 5 }); // back onto the ruler
    expect(ed.doc.guides).toEqual([]);
  });
});

describe('polygon select', () => {
  it('selects objects with every point inside the polygon', () => {
    const { ed, ids } = editorWith([
      { points: [pathNode(10, 10), pathNode(20, 10)] },
      { points: [pathNode(30, 10), pathNode(60, 10)] },
    ]);
    ed.run('tool.polygon');
    for (const p of [[5, 5], [40, 5], [40, 15], [5, 15]] as Point[]) click(ed, at(p[0], p[1], { time: Math.random() * 1e6 }));
    ed.keyDown({ key: 'Enter' });
    expect(ed.selectionOrder).toEqual([ids[0]]); // the second line pokes out
  });
});

describe('handles', () => {
  it('resizes from a corner proportionally and from a side one way', () => {
    const { ed, ids } = editorWith([square(10, 10, 10)]);
    ed.select(ids[0]!);
    const se = handle(ed, 'se');
    drag(ed, se, { ...se, x: se.x + 40, y: se.y + 40 }); // +10 mm both ways
    expect(box(ed, ids[0]!)).toMatchObject({ minX: 10, minY: 10, maxX: 30, maxY: 30 });
    const e = handle(ed, 'e');
    drag(ed, e, { ...e, x: e.x + 40, y: e.y + 77 });
    expect(box(ed, ids[0]!)).toMatchObject({ minX: 10, minY: 10, maxX: 40, maxY: 30 });
    ed.undo();
    expect(box(ed, ids[0]!)).toMatchObject({ maxX: 30 });
  });

  it('scales column widths by the geometric mean and turns the fill angle with the stretch', () => {
    const { ed, ids } = editorWith([
      { stitchType: 'satin', points: [pathNode(10, 10, 'corner', 2), pathNode(20, 20)] },
      square(30, 10, 10),
    ]);
    ed.object(ids[0]!)!.settings.satinWidth = 3;
    ed.object(ids[1]!)!.settings.fillAngle = 45;
    ed.setSelection(ids);
    ed.setSelectionBox({ width: 60 }); // 30 mm wide -> 60: x2 one way
    const satin = ed.object(ids[0]!)!;
    expect(satin.settings.satinWidth).toBeCloseTo(3 * Math.SQRT2, 9);
    expect(satin.points[0]!.width).toBeCloseTo(2 * Math.SQRT2, 9);
    expect(ed.object(ids[1]!)!.settings.fillAngle).toBeCloseTo((Math.atan2(1, 2) * 180) / Math.PI, 6);
  });

  it('switches to rotate handles on a second click; Shift rotates in 15 degree steps', () => {
    const { ed, ids } = editorWith([square(10, 10, 10)]);
    click(ed, at(15, 15));
    expect(ed.handleMode).toBe('scale');
    click(ed, at(15, 15));
    expect(ed.handleMode).toBe('rotate');
    const corner = handle(ed, 'rot-ne');
    // Drag the top-right corner round the centre (15, 15) by about 40 degrees.
    const c = { x: 60, y: 60 };
    const r = Math.hypot(corner.x - c.x, corner.y - c.y);
    const a0 = Math.atan2(corner.y - c.y, corner.x - c.x);
    const a1 = a0 + (40 * Math.PI) / 180;
    drag(ed, corner, { x: c.x + r * Math.cos(a1), y: c.y + r * Math.sin(a1), shift: true });
    const [p0, p1] = ed.object(ids[0]!)!.points;
    expect((Math.atan2(p1!.y - p0!.y, p1!.x - p0!.x) * 180) / Math.PI).toBeCloseTo(45, 6);
  });

  it('skews with the diamond handles in 5 degree steps, never past 70', () => {
    const { ed, ids } = editorWith([square(10, 10, 10)]);
    ed.select(ids[0]!);
    ed.setHandleMode('rotate');
    const top = handle(ed, 'skew-n');
    drag(ed, top, { ...top, x: top.x + 4 * 4.4, shift: true }); // atan(4.4 / 10) = 23.7 -> 25 degrees
    const pts = ed.object(ids[0]!)!.points;
    // The bottom edge stays; the top edge shifts by tan(25) x 10.
    expect(pts[3]!.x).toBeCloseTo(10, 9);
    expect(pts[0]!.x).toBeCloseTo(10 + Math.tan((25 * Math.PI) / 180) * 10, 6);
    ed.undo();
    ed.select(ids[0]!); // undo restores the selection saved with that step (none)
    const t2 = handle(ed, 'skew-n');
    drag(ed, t2, { ...t2, x: t2.x + 4 * 100 });
    expect(ed.object(ids[0]!)!.points[0]!.x).toBeCloseTo(10 + Math.tan((70 * Math.PI) / 180) * 10, 6);
  });

  it('moves with the centre handle', () => {
    const { ed, ids } = editorWith([square(10, 10, 10)]);
    ed.select(ids[0]!);
    const m = handle(ed, 'move');
    drag(ed, m, { ...m, x: m.x + 20 });
    expect(box(ed, ids[0]!).minX).toBeCloseTo(15, 9);
  });
});

describe('align and space evenly', () => {
  it('aligns with the last selected object', () => {
    const { ed, ids } = editorWith([square(0, 0, 4), square(20, 30, 10)]);
    ed.setSelection([ids[0]!, ids[1]!]);
    ed.alignSelection('right');
    expect(box(ed, ids[0]!).maxX).toBe(30);
    ed.alignSelection('middle');
    expect((box(ed, ids[0]!).minY + box(ed, ids[0]!).maxY) / 2).toBe(35);
    expect(box(ed, ids[1]!)).toMatchObject({ minX: 20, minY: 30 }); // the reference stays
  });

  it('spaces centres evenly between the outermost two', () => {
    const { ed, ids } = editorWith([square(0, 0, 2), square(3, 0, 2), square(30, 0, 2), square(8, 0, 2)]);
    ed.setSelection(ids);
    ed.spaceEvenly('x');
    const centres = ids.map((id) => (box(ed, id).minX + box(ed, id).maxX) / 2).sort((a, b) => a - b);
    expect(centres).toEqual([1, 11, 21, 31]);
  });
});

describe('copy tools', () => {
  it('makes arrays', () => {
    const { ed, ids } = editorWith([square(0, 0, 5)]);
    ed.select(ids[0]!);
    ed.arrayCopies(2, 3, 10, 20);
    expect(ed.doc.objects).toHaveLength(6);
    const minXs = ed.doc.objects.map((o) => ed.selectionBox([o])!.minX).sort((a, b) => a - b);
    expect(minXs).toEqual([0, 0, 10, 10, 20, 20]);
  });

  it('mirrors a copy beside the selection', () => {
    const { ed, ids } = editorWith([{ points: [pathNode(0, 0), pathNode(10, 5)] }]);
    ed.select(ids[0]!);
    ed.mirrorCopy(false, 2);
    const copy = ed.doc.objects[1]!;
    expect(copy.points.map((n) => [n.x, n.y])).toEqual([[22, 0], [12, 5]]);
  });

  it('places circle copies, every other one reflected in kaleidoscope mode', () => {
    const tri = { stitchType: 'fill' as const, closed: true, points: [pathNode(0, -20), pathNode(5, -20), pathNode(0, -10)] };
    const { ed, ids } = editorWith([tri]);
    ed.select(ids[0]!);
    ed.circleCopies(4, [0, 0], true);
    expect(ed.doc.objects).toHaveLength(4);
    const sign = (i: number) => Math.sign(ringArea(ed.doc.objects[i]!.points.map((n) => [n.x, n.y] as Point)));
    expect([sign(1), sign(2), sign(3)]).toEqual([-sign(0), sign(0), -sign(0)]);
    // Copy 2 (not reflected) is the original turned 180 degrees round the centre.
    expect(ed.doc.objects[2]!.points[0]!.y).toBeCloseTo(20, 9);
  });

  it('inserts offset outlines and borders', () => {
    const { ed, ids } = editorWith([square(0, 0, 10)]);
    ed.select(ids[0]!);
    expect(ed.insertOffset(2)).toBe(1);
    const off = ed.selectedObjects()[0]!;
    expect(off.settings.stitchType).toBe('running');
    expect(ed.selectionBox([off])).toMatchObject({ minX: -2, minY: -2, maxX: 12, maxY: 12 });
    ed.select(ids[0]!);
    ed.addBorder(-1, 'scallop');
    const border = ed.selectedObjects()[0]!;
    expect(border.settings).toMatchObject({ stitchType: 'motif_line', motifName: 'scallop' });
    expect(ed.selectionBox([border])).toMatchObject({ minX: 1, maxX: 9 });
  });
});

describe('sequencing by colour', () => {
  const RED = [200, 0, 0] as [number, number, number];
  const BLUE = [0, 0, 200] as [number, number, number];
  const make = (colors: [number, number, number][], boxes: [number, number][]) => {
    const doc = createDocument();
    return colors.map((color, i) => createObject(doc, { color, points: [pathNode(boxes[i]![0], 0), pathNode(boxes[i]![1], 1)] }));
  };
  const boxOf = (o: ReturnType<typeof make>[number]) => ({ minX: o.points[0]!.x, minY: 0, maxX: o.points[1]!.x, maxY: 1 });

  it('sequences by colour, keeping the order within a colour', () => {
    const objs = make([RED, BLUE, RED, BLUE], [[0, 1], [2, 3], [4, 5], [6, 7]]);
    expect(sequenceByColour(objs).map((o) => o.id)).toEqual([objs[0]!.id, objs[2]!.id, objs[1]!.id, objs[3]!.id]);
  });

  it('optimizes colour changes only where nothing in between overlaps (with 0.5 mm)', () => {
    const apart = make([RED, BLUE, RED], [[0, 1], [10, 11], [20, 21]]);
    expect(optimizeColourChanges(apart, boxOf).map((o) => o.id)).toEqual([apart[0]!.id, apart[2]!.id, apart[1]!.id]);
    const stacked = make([RED, BLUE, RED], [[0, 1], [10, 11], [11.3, 12]]); // within 0.5 mm of the blue one
    expect(optimizeColourChanges(stacked, boxOf).map((o) => o.id)).toEqual(stacked.map((o) => o.id));
  });

  it('moves back and forward one colour block', () => {
    const objs = make([RED, RED, BLUE, BLUE, RED], [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5]]);
    const ids = objs.map((o) => o.id);
    expect(moveByColourBlock(objs, [ids[4]!], -1).map((o) => o.id)).toEqual([ids[0], ids[1], ids[4], ids[2], ids[3]]);
    expect(moveByColourBlock(objs, [ids[0]!], 1).map((o) => o.id)).toEqual([ids[1], ids[2], ids[3], ids[0], ids[4]]);
  });

  it('runs as editor commands', () => {
    const { ed, ids } = editorWith([
      { color: RED, points: [pathNode(0, 0), pathNode(1, 0)] },
      { color: BLUE, points: [pathNode(10, 0), pathNode(11, 0)] },
      { color: RED, points: [pathNode(20, 0), pathNode(21, 0)] },
    ]);
    ed.run('arrange.optimize');
    expect(ed.doc.objects.map((o) => o.id)).toEqual([ids[0], ids[2], ids[1]]);
    ed.select(ids[1]!);
    ed.run('arrange.backColour');
    expect(ed.doc.objects.map((o) => o.id)).toEqual([ids[1], ids[0], ids[2]]);
  });
});

describe('reshape nodes', () => {
  it('inserts a node on a double click on the outline and deletes the active node', () => {
    const { ed, ids } = editorWith([{ points: [pathNode(0, 10), pathNode(20, 10)] }]);
    ed.select(ids[0]!);
    ed.setTool('reshape');
    click(ed, at(8, 10, { time: 1000 }));
    click(ed, at(8, 10, { time: 1200 }));
    expect(ed.object(ids[0]!)!.points.map((n) => n.x)).toEqual([0, 8, 20]);
    click(ed, at(8, 10, { time: 5000 }));
    ed.keyDown({ key: 'Delete' });
    expect(ed.object(ids[0]!)!.points.map((n) => n.x)).toEqual([0, 20]);
    ed.keyDown({ key: 'Delete' }); // no active node left: nothing happens to the line
    expect(ed.object(ids[0]!)!.points).toHaveLength(2);
  });
});
