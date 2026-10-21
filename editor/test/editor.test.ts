import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDocument, createObject, pathNode, type Point, type StitchObject } from '@stitchpro/engine';
import {
  Clipboard,
  Editor,
  FontLibrary,
  Renderer,
  formatLength,
  fromDisplay,
  parseLength,
  setPickMode,
  toDisplay,
  type CanvasLike,
  type PathLike,
  type PointerInput,
} from '../src/index';

// The default view: 4 px per mm, origin at the top left. at(x, y) is the screen point of (x, y) mm.
const at = (x: number, y: number, extra: Partial<PointerInput> = {}): PointerInput => ({ x: x * 4, y: y * 4, button: 0, ...extra });

function click(ed: Editor, x: number, y: number, extra: Partial<PointerInput> = {}) {
  ed.pointerDown(at(x, y, extra));
  ed.pointerUp(at(x, y, extra));
}

function drag(ed: Editor, from: Point, to: Point, extra: Partial<PointerInput> = {}) {
  ed.pointerDown(at(from[0], from[1], extra));
  ed.pointerMove(at((from[0] + to[0]) / 2, (from[1] + to[1]) / 2, extra));
  ed.pointerMove(at(to[0], to[1], extra));
  ed.pointerUp(at(to[0], to[1], extra));
}

/** An editor with a 10 mm running line at y = 10 and a filled square from (20,20) to (30,30). */
function withObjects() {
  const doc = createDocument({ closestJoin: false });
  const line = createObject(doc, { points: [pathNode(0, 10), pathNode(10, 10)] });
  const square = createObject(doc, {
    stitchType: 'fill',
    closed: true,
    points: [pathNode(20, 20), pathNode(30, 20), pathNode(30, 30), pathNode(20, 30)],
    color: [0, 94, 184],
  });
  doc.objects.push(line, square);
  const ed = new Editor(doc);
  ed.showRulers = false; // these tests work near the origin, under where the rulers would be
  return { ed, line, square };
}

afterEach(() => vi.useRealTimers());

describe('construction and notification', () => {
  it('shares fonts and clipboard between editors', () => {
    const fonts = new FontLibrary();
    const clipboard = new Clipboard();
    const a = new Editor(createDocument(), { fonts, clipboard });
    const b = new Editor(createDocument(), { fonts, clipboard });
    expect(a.fonts).toBe(b.fonts);
    expect(a.clipboard).toBe(b.clipboard);
  });

  it('notifies subscribers and says what changed', () => {
    const ed = new Editor();
    const kinds: string[] = [];
    const off = ed.subscribe((k) => kinds.push(k));
    ed.setStatus('Hello');
    ed.setStatus('Hello');
    ed.changed('base');
    off();
    ed.setStatus('Bye');
    expect(kinds).toEqual(['state', 'base']);
    expect(ed.status).toBe('Bye');
  });

  it('touch bumps an object version and invalidates the base layer', () => {
    const { ed, line } = withObjects();
    const v = line.version;
    const base = ed.baseRevision;
    ed.touch(line);
    expect(line.version).toBeGreaterThan(v);
    expect(ed.baseRevision).toBe(base + 1);
  });

  it('caches stitches by (id, version)', () => {
    const { ed, line } = withObjects();
    const a = ed.stitches(line);
    expect(ed.stitches(line)).toBe(a);
    ed.touch(line);
    expect(ed.stitches(line)).not.toBe(a);
  });
});

describe('selection', () => {
  it('selects, toggles, keeps pick order and selects all', () => {
    const { ed, line, square } = withObjects();
    ed.select(square.id);
    ed.select(line.id, true);
    expect(ed.selectionOrder).toEqual([square.id, line.id]);
    ed.toggleSelected(square.id);
    expect([...ed.selection]).toEqual([line.id]);
    ed.selectAll();
    expect(ed.selectionOrder).toEqual([line.id, square.id]);
    ed.setSelection([999, square.id]);
    expect(ed.selectionOrder).toEqual([square.id]);
  });

  it('click selects the object under the pointer; Ctrl-click toggles; clicking empty space clears', () => {
    const { ed, line, square } = withObjects();
    click(ed, 5, 10.5); // within 6 px of the line
    expect(ed.selectionOrder).toEqual([line.id]);
    click(ed, 25, 25, { ctrl: true }); // inside the fill
    expect(ed.selectionOrder).toEqual([line.id, square.id]);
    click(ed, 25, 25, { ctrl: true });
    expect(ed.selectionOrder).toEqual([line.id]);
    click(ed, 60, 60);
    expect(ed.selectionOrder).toEqual([]);
  });

  it('box-selects objects wholly inside the dragged box', () => {
    const { ed, square } = withObjects();
    drag(ed, [15, 15], [35, 35]);
    expect(ed.selectionOrder).toEqual([square.id]);
    drag(ed, [-1, 5], [5, 15]); // only half of the line
    expect(ed.selectionOrder).toEqual([]);
  });
});

describe('moving', () => {
  it('drags the selection by the pointer movement, as one undo step', () => {
    const { ed, line } = withObjects();
    drag(ed, [5, 10], [8, 14]);
    const moved = ed.object(line.id)!;
    expect(moved.points.map((n) => [n.x, n.y])).toEqual([[3, 14], [13, 14]]);
    expect(ed.live.size).toBe(0);
    ed.undo();
    expect(ed.object(line.id)!.points.map((n) => [n.x, n.y])).toEqual([[0, 10], [10, 10]]);
    ed.redo();
    expect(ed.object(line.id)!.points[0]!.y).toBe(14);
  });

  it('ignores movements under the drag threshold', () => {
    const { ed, line } = withObjects();
    ed.pointerDown(at(5, 10));
    ed.pointerMove({ x: 5 * 4 + 3, y: 10 * 4 });
    ed.pointerUp({ x: 5 * 4 + 3, y: 10 * 4 });
    expect(ed.object(line.id)!.points[0]!.x).toBe(0);
    expect(ed.history.size).toBe(1);
  });

  it('keeps dragged objects live (off the base layer) until the drop; Esc cancels', () => {
    const { ed, line } = withObjects();
    ed.pointerDown(at(5, 10));
    ed.pointerMove(at(9, 10));
    expect([...ed.live]).toEqual([line.id]);
    ed.keyDown({ key: 'Escape' });
    expect(ed.live.size).toBe(0);
    expect(ed.object(line.id)!.points[0]!.x).toBe(0);
  });

  it('nudges by 0.5 mm, Shift x 10', () => {
    const { ed, line } = withObjects();
    ed.select(line.id);
    ed.keyDown({ key: 'ArrowRight' });
    expect(ed.object(line.id)!.points[0]!.x).toBe(0.5);
    ed.keyDown({ key: 'ArrowDown', shift: true });
    expect(ed.object(line.id)!.points[0]!.y).toBe(15);
  });

  it('deletes the selection', () => {
    const { ed, line } = withObjects();
    ed.select(line.id);
    ed.keyDown({ key: 'Delete' });
    expect(ed.object(line.id)).toBeUndefined();
    ed.keyDown({ key: 'z', ctrl: true });
    expect(ed.object(line.id)).toBeDefined();
    ed.keyDown({ key: 'y', ctrl: true });
    expect(ed.object(line.id)).toBeUndefined();
  });
});

describe('drawing', () => {
  it('adds corner nodes on left click and curve nodes on right click; Enter finishes', () => {
    const ed = new Editor(createDocument({ closestJoin: false }));
    ed.showRulers = false;
    ed.setTool('draw');
    ed.drawMode = { stitchType: 'running', closed: false };
    click(ed, 0, 0);
    click(ed, 10, 0, { button: 2 });
    click(ed, 20, 5);
    ed.keyDown({ key: 'Enter' });
    expect(ed.doc.objects).toHaveLength(1);
    const o = ed.doc.objects[0]!;
    expect(o.points).toEqual([pathNode(0, 0, 'corner'), pathNode(10, 0, 'curve'), pathNode(20, 5, 'corner')]);
    expect(ed.selectionOrder).toEqual([o.id]);
    ed.undo();
    expect(ed.doc.objects).toHaveLength(0);
  });

  it('finishes on a double click and makes closed shapes in closed mode', () => {
    const ed = new Editor(createDocument({ closestJoin: false }));
    ed.showRulers = false;
    ed.setTool('draw');
    ed.drawMode = { stitchType: 'fill', closed: true };
    click(ed, 0, 0, { time: 0 });
    click(ed, 10, 0, { time: 1000 });
    click(ed, 10, 10, { time: 2000 });
    click(ed, 10, 10, { time: 2200 });
    expect(ed.doc.objects).toHaveLength(1);
    expect(ed.doc.objects[0]!.closed).toBe(true);
    expect(ed.doc.objects[0]!.settings.stitchType).toBe('fill');
  });

  it('Backspace removes the last node; Esc cancels; too few nodes adds nothing', () => {
    const ed = new Editor(createDocument({ closestJoin: false }));
    ed.showRulers = false;
    ed.setTool('draw');
    click(ed, 0, 0);
    click(ed, 5, 0);
    ed.keyDown({ key: 'Backspace' });
    ed.keyDown({ key: 'Enter' });
    expect(ed.doc.objects).toHaveLength(0);
    expect(ed.status).toContain('at least 2 nodes');
    click(ed, 0, 0);
    ed.keyDown({ key: 'Escape' });
    expect(ed.tool.overlay().nodes).toEqual([]);
  });
});

describe('other tools', () => {
  it('reshape drags a node of the selected object', () => {
    const { ed, line } = withObjects();
    ed.select(line.id);
    ed.setTool('reshape');
    drag(ed, [10, 10], [12, 4]);
    expect(ed.object(line.id)!.points[1]).toMatchObject({ x: 12, y: 4 });
  });

  it('stitches tool drags a needle point into hand edits', () => {
    const { ed, line } = withObjects();
    ed.select(line.id);
    ed.setTool('stitches');
    const first = ed.stitches(line)[1]!;
    drag(ed, first, [first[0], first[1] + 3]);
    const edited = ed.object(line.id)!;
    expect(edited.customStitches![1]).toEqual([first[0], first[1] + 3]);
  });

  it('pick sets entry and exit points, or takes a colour', () => {
    const { ed, square } = withObjects();
    ed.select(square.id);
    ed.setTool('pick');
    click(ed, 21, 21);
    expect(ed.object(square.id)!.fillStart).toEqual([21, 21]);
    expect(ed.object(square.id)!.autoEntry).toBe(false);
    setPickMode(ed.tool, 'exit');
    click(ed, 29, 29);
    expect(ed.object(square.id)!.fillEnd).toEqual([29, 29]);
    setPickMode(ed.tool, 'colour');
    click(ed, 25, 25);
    expect(ed.currentColor).toEqual([0, 94, 184]);
  });

  it('angle adds a stitch angle line to the selected object', () => {
    const { ed, square } = withObjects();
    ed.select(square.id);
    ed.setTool('angle');
    drag(ed, [20, 20], [30, 25]);
    expect(ed.object(square.id)!.stitchAngles).toEqual([[[20, 20], [30, 25]]]);
  });

  it('measure reports the distance in the display units', () => {
    const ed = new Editor();
    ed.setTool('measure');
    drag(ed, [0, 0], [3, 4]);
    expect(ed.status).toContain('5.00 mm');
    ed.setUnits('in');
    drag(ed, [0, 0], [25.4, 0]);
    expect(ed.status).toContain('1.000 in');
  });

  it('switches tools with keys', () => {
    const ed = new Editor();
    ed.keyDown({ key: 'r' });
    expect(ed.toolName).toBe('reshape');
    ed.keyDown({ key: 'Escape' });
    expect(ed.toolName).toBe('select');
    ed.keyDown({ key: 's' });
    expect(ed.simStitch).toBe(true);
  });
});

describe('commit', () => {
  it('applies closest join and palette sync', () => {
    const doc = createDocument({ closestJoin: true });
    const a = createObject(doc, { points: [pathNode(0, 0), pathNode(9, 0)] });
    const b = createObject(doc, { points: [pathNode(20, 0), pathNode(10, 0)], color: [1, 2, 3] });
    const c = createObject(doc, { points: [pathNode(30, 0), pathNode(12, 0)], color: [1, 2, 3] });
    doc.objects.push(a, b, c);
    const ed = new Editor(doc);
    ed.commit('Test');
    // b ends at (10,0); c's nearer end (12,0) is within the 3 mm join distance, so c starts there.
    expect(ed.object(c.id)!.fillStart).toEqual([12, 0]);
    expect(ed.object(b.id)!.fillStart).toBeNull(); // a is another colour
    expect(ed.doc.palette.some((s) => s.color.join() === '1,2,3')).toBe(true);
  });

  it('commitSoon waits, then makes one undo step', () => {
    vi.useFakeTimers();
    const { ed, line } = withObjects();
    const steps = ed.history.size;
    ed.replace({ ...line, name: 'A' });
    ed.commitSoon();
    ed.replace({ ...ed.object(line.id)!, name: 'AB' });
    ed.commitSoon();
    expect(ed.history.size).toBe(steps);
    vi.advanceTimersByTime(400);
    expect(ed.history.size).toBe(steps + 1);
  });
});

describe('undo history', () => {
  it('shares unchanged objects between snapshots and copies changed ones', () => {
    const { ed, line, square } = withObjects();
    ed.doc.artwork.push({ id: 99, name: 'pic', src: 'data:image/png;base64,AAAA', x: 0, y: 0, width: 10, height: 10, opacity: 0.5, visible: true, locked: false });
    ed.commit('Artwork');
    const before = ed.history.current();
    ed.select(line.id);
    ed.moveSelection(1, 0);
    ed.commit('Move');
    const after = ed.history.current();
    const sq = (s: typeof before) => s.objects.find((o: StitchObject) => o.id === square.id);
    const ln = (s: typeof before) => s.objects.find((o: StitchObject) => o.id === line.id);
    expect(sq(after)).toBe(sq(before));
    expect(ln(after)).not.toBe(ln(before));
    expect(after.artwork[0]!.src).toBe(before.artwork[0]!.src);
    // Snapshots are copies: editing the document doesn't change them.
    expect(ln(after)).not.toBe(ed.object(line.id));
  });

  it('gives restored objects fresh versions, so cached stitches never go stale', () => {
    const { ed, line } = withObjects();
    ed.select(line.id);
    const original = ed.stitches(ed.object(line.id)!);
    ed.moveSelection(5, 0);
    ed.commit('Move');
    const moved = ed.stitches(ed.object(line.id)!);
    ed.undo();
    const back = ed.object(line.id)!;
    expect(ed.stitches(back)).toEqual(original);
    ed.select(line.id); // undo restores the selection saved with that step (none)
    ed.moveSelection(0, 5);
    ed.commit('Move again');
    const again = ed.stitches(ed.object(line.id)!);
    expect(again).not.toEqual(moved);
    expect(again[0]).toEqual([0, 15]);
  });

  it('keeps objects that did not change across undo', () => {
    const { ed, line, square } = withObjects();
    ed.select(line.id);
    ed.moveSelection(1, 0);
    ed.commit('Move');
    const sq = ed.object(square.id);
    ed.undo();
    expect(ed.object(square.id)).toBe(sq);
  });
});

describe('units', () => {
  it('converts and formats mm and inches', () => {
    expect(toDisplay(25.4, 'in')).toBe(1);
    expect(fromDisplay(2, 'in')).toBe(50.8);
    expect(formatLength(12.345, 'mm')).toBe('12.35 mm');
    expect(formatLength(25.4, 'in')).toBe('1.000 in');
    expect(parseLength('2', 'in')).toBe(50.8);
    expect(parseLength('12,5 mm', 'in')).toBe(12.5);
    expect(parseLength('1"', 'mm')).toBe(25.4);
    expect(parseLength('abc', 'mm')).toBeNull();
  });
});

describe('renderer', () => {
  function fakeCanvas(): CanvasLike & { ops: string[] } {
    const ops: string[] = [];
    const ctx = new Proxy({} as Record<string, unknown>, {
      get: (t, k) => (k in t ? t[k as string] : (...args: unknown[]) => ops.push(`${String(k)}(${args.length})`)),
      set: (t, k, v) => {
        t[k as string] = v;
        return true;
      },
    });
    return { width: 400, height: 300, getContext: () => ctx as unknown as CanvasRenderingContext2D, ops };
  }

  function setup() {
    const { ed, line, square } = withObjects();
    const frames: (() => void)[] = [];
    let paths = 0;
    const createPath = (): PathLike => {
      paths++;
      return { moveTo() {}, lineTo() {} };
    };
    const r = new Renderer(ed, fakeCanvas(), {
      pixelRatio: 1,
      createCanvas: () => fakeCanvas(),
      createPath,
      requestFrame: (f) => frames.push(f),
    });
    const flush = () => frames.splice(0).forEach((f) => f());
    return { ed, line, square, r, flush, paths: () => paths };
  }

  it('redraws at most once per animation frame', () => {
    const { ed, r, flush } = setup();
    ed.changed('overlay');
    ed.changed('overlay');
    ed.changed('base');
    flush();
    expect(r.stats.frames).toBe(1);
  });

  it('builds each object path once per version', () => {
    const { ed, line, r, flush, paths } = setup();
    r.draw();
    expect(paths()).toBe(2);
    r.draw();
    ed.changed('base');
    flush();
    expect(paths()).toBe(2);
    ed.touch(ed.object(line.id)!);
    flush();
    expect(paths()).toBe(3);
  });

  it('redraws the base layer only when base objects or the view change, not while dragging', () => {
    const { ed, r, flush } = setup();
    r.draw();
    const base = r.stats.baseDraws;
    ed.pointerDown(at(5, 10));
    ed.pointerMove(at(7, 10)); // starts the drag: the line leaves the base layer
    flush();
    expect(r.stats.baseDraws).toBe(base + 1);
    for (let x = 8; x < 20; x++) {
      ed.pointerMove(at(x, 10));
      flush();
    }
    expect(r.stats.baseDraws).toBe(base + 1);
    ed.pointerUp(at(19, 10));
    flush();
    expect(r.stats.baseDraws).toBe(base + 2);
    ed.zoomAt([100, 100], 2);
    flush();
    expect(r.stats.baseDraws).toBe(base + 3);
  });
});
