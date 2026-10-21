import { describe, expect, it } from 'vitest';
import {
  applyClosestJoin,
  buildExportPlan,
  computeStitches,
  createDocument,
  createObject,
  pathNode,
  planDesign,
  splitRuns,
  type Command,
  type NewObject,
  type Point,
  type StitchDocument,
  type StitchObject,
  type StitchType,
} from '../src/index';

const rect = (x0: number, y0: number, x1: number, y1: number): Point[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const nodes = (pts: Point[]) => pts.map(([x, y]) => pathNode(x, y));

/** A document whose objects sew exactly the given stitches (manual objects unless told otherwise: their connectors are > 12 mm). */
function design(items: { type?: StitchType; init?: NewObject; stitches: Point[] }[], docInit: Partial<StitchDocument> = {}) {
  const doc = createDocument({ closestJoin: false, ...docInit });
  const stitches = new Map<StitchObject, Point[]>();
  for (const it of items) {
    const o = createObject(doc, { stitchType: it.type ?? 'manual', points: nodes(it.stitches), ...it.init });
    doc.objects.push(o);
    stitches.set(o, it.stitches);
  }
  const of = (o: StitchObject) => stitches.get(o) ?? stitches.get(doc.objects.find((d) => d.id === o.id)!)!;
  return { doc, of };
}
const fmt = (cmds: Command[]) => cmds.map(([k, x, y]) => `${k} ${Number(x.toFixed(3))},${Number(y.toFixed(3))}`);
const kinds = (cmds: Command[]) => cmds.map((c) => c[0]);

describe('a single run', () => {
  it('starts with jump, stitch, tie-in and ends with tie-off and trim', () => {
    const { doc, of } = design([{ stitches: [[0, 0], [3, 0], [6, 0], [9, 0]] }]);
    const plan = buildExportPlan(doc, of);
    expect(fmt(plan.commands)).toEqual([
      'jump 0,0', 'stitch 0,0', 'stitch 0.7,0', 'stitch 0,0', // tie-in
      'stitch 3,0', 'stitch 6,0', 'stitch 9,0',
      'stitch 8.3,0', 'stitch 9,0', 'trim 9,0', // tie-off, trim
    ]);
    expect(plan).toMatchObject({ name: 'Untitled', autoJump: true, maxStitch: 12, trimJumps: 3 });
    expect(plan.threads).toEqual([{ color: [0, 0, 0], name: '', brand: '', code: '' }]);
  });

  it('omits ties when tie stitches are off', () => {
    const { doc, of } = design([{ stitches: [[0, 0], [3, 0]] }], { tieStitches: false });
    expect(fmt(buildExportPlan(doc, of).commands)).toEqual(['jump 0,0', 'stitch 0,0', 'stitch 3,0', 'trim 3,0']);
  });

  it('skips hidden objects', () => {
    const { doc, of } = design([{ stitches: [[0, 0], [3, 0]], init: { visible: false } }]);
    expect(buildExportPlan(doc, of).commands).toEqual([]);
  });
});

describe('between runs', () => {
  it('runs straight on when the next start is within the trim distance', () => {
    const { doc, of } = design([{ stitches: [[0, 0], [3, 0]] }, { stitches: [[5, 0], [8, 0]] }], { tieStitches: false });
    expect(fmt(buildExportPlan(doc, of).commands)).toEqual(['jump 0,0', 'stitch 0,0', 'stitch 3,0', 'stitch 5,0', 'stitch 8,0', 'trim 8,0']);
  });

  it('ties off, trims, jumps and ties in when farther', () => {
    const { doc, of } = design([{ stitches: [[0, 0], [3, 0]] }, { stitches: [[20, 0], [23, 0]] }]);
    expect(fmt(buildExportPlan(doc, of).commands).slice(4, 13)).toEqual([
      'stitch 3,0', 'stitch 2.3,0', 'stitch 3,0', 'trim 3,0',
      'jump 20,0', 'stitch 20,0', 'stitch 20.7,0', 'stitch 20,0', 'stitch 23,0',
    ]);
  });

  it('jumps without trimming when auto trim is off', () => {
    const { doc, of } = design([{ stitches: [[0, 0], [3, 0]] }, { stitches: [[20, 0], [23, 0]] }], { autoTrim: false, tieStitches: false });
    expect(fmt(buildExportPlan(doc, of).commands)).toEqual(['jump 0,0', 'stitch 0,0', 'stitch 3,0', 'jump 20,0', 'stitch 20,0', 'stitch 23,0', 'trim 23,0']);
  });

  it('changes colour with tie-off, trim, colour change, jump, tie-in', () => {
    const { doc, of } = design([
      { stitches: [[0, 0], [3, 0]] },
      { stitches: [[4, 0], [7, 0]], init: { color: [200, 16, 46], thread: { chart: 'Isacord', code: '1902', name: 'Poppy' } } },
    ]);
    const plan = buildExportPlan(doc, of);
    expect(kinds(plan.commands)).toEqual([
      'jump', 'stitch', 'stitch', 'stitch', 'stitch',
      'stitch', 'stitch', 'trim', 'color_change',
      'jump', 'stitch', 'stitch', 'stitch', 'stitch',
      'stitch', 'stitch', 'trim',
    ]);
    expect(plan.threads).toEqual([
      { color: [0, 0, 0], name: '', brand: '', code: '' },
      { color: [200, 16, 46], name: 'Poppy', brand: 'Isacord', code: '1902' },
    ]);
  });

  it('sews a connector hidden under the next same-colour objects as 2.5 mm stitches', () => {
    const { doc, of } = design(
      [
        { stitches: [[0, 0], [5, 0], [15, 0]] },
        { type: 'fill', init: { closed: true, points: nodes(rect(10, -5, 40, 5)) }, stitches: [[30, 0], [35, 0]] },
      ],
      { tieStitches: false },
    );
    const { plan, marks } = planDesign(doc, of);
    expect(fmt(plan.commands)).toEqual([
      'jump 0,0', 'stitch 0,0', 'stitch 5,0', 'stitch 15,0',
      'stitch 17.5,0', 'stitch 20,0', 'stitch 22.5,0', 'stitch 25,0', 'stitch 27.5,0', 'stitch 30,0',
      'stitch 35,0', 'trim 35,0',
    ]);
    expect(marks.find((m) => m.kind === 'travel')?.path).toHaveLength(7);
  });

  it('trims when the connector is mostly over open fabric', () => {
    const { doc, of } = design([
      { stitches: [[0, 0], [5, 0], [15, 0]] },
      { type: 'fill', init: { closed: true, points: nodes(rect(28, -5, 40, 5)) }, stitches: [[30, 0], [35, 0]] },
    ]);
    expect(kinds(buildExportPlan(doc, of).commands)).toContain('trim');
    expect(kinds(buildExportPlan(doc, of).commands).filter((k) => k === 'trim')).toHaveLength(2);
  });

  it('closest join: steps to the next object nearest stitch and runs inside it to its entry', () => {
    const { doc, of } = design([{ stitches: [[-5, 0], [0, 0]] }, { stitches: [[20, 0], [12, 0], [2, 0]] }], { closestJoin: true, tieStitches: false });
    const { plan, marks } = planDesign(doc, of);
    const cmds = fmt(plan.commands);
    expect(cmds).not.toContain('trim 0,0');
    // Step to (2,0), then back along its stitches to its first point, 18 mm in 8 even travel stitches.
    expect(cmds.slice(2, 6)).toEqual(['stitch 0,0', 'stitch 2,0', 'stitch 4.25,0', 'stitch 6.5,0']);
    expect(marks.some((m) => m.kind === 'travel')).toBe(true);
  });
});

describe('stops and hoop out', () => {
  it('stops after an object', () => {
    const { doc, of } = design([{ stitches: [[0, 0], [3, 0]], init: { stopAfter: true } }, { stitches: [[4, 0], [6, 0]] }], { tieStitches: false });
    expect(fmt(buildExportPlan(doc, of).commands)).toEqual(['jump 0,0', 'stitch 0,0', 'stitch 3,0', 'stop 3,0', 'stitch 4,0', 'stitch 6,0', 'trim 6,0']);
  });

  it('hoops out: tie-off, trim, jump to the point, stop; then starts afresh', () => {
    const { doc, of } = design([{ stitches: [[0, 0], [3, 0]], init: { hoopOut: [50, 50] } }, { stitches: [[4, 0], [6, 0]] }], { tieStitches: false });
    const { plan, marks } = planDesign(doc, of);
    expect(fmt(plan.commands)).toEqual([
      'jump 0,0', 'stitch 0,0', 'stitch 3,0', 'trim 3,0', 'jump 50,50', 'stop 50,50',
      'jump 4,0', 'stitch 4,0', 'stitch 6,0', 'trim 6,0',
    ]);
    expect(marks.map((m) => m.kind)).toEqual(['start', 'trim', 'hoop_out', 'trim', 'end']);
  });
});

describe('runs inside an object', () => {
  it('drops stitches shorter than minStitch, keeping the run ends', () => {
    const { doc, of } = design([{ stitches: [[0, 0], [0.1, 0], [2, 0], [2.1, 0]] }]);
    expect(splitRuns(doc.objects[0]!, of(doc.objects[0]!), doc)[0]!.points).toEqual([[0, 0], [2.1, 0]]);
  });

  it('splits at jump marks', () => {
    const { doc, of } = design([{ type: 'fill', init: { closed: true, points: nodes(rect(0, 0, 25, 5)) }, stitches: [[0, 0], [5, 0], [20, 0], [20, 0], [20, 0], [25, 0]] }]);
    const runs = splitRuns(doc.objects[0]!, of(doc.objects[0]!), doc);
    // The jump goes from (5,0) to the landing point, which starts the next run.
    expect(runs.map((r) => r.points)).toEqual([
      [[0, 0], [5, 0]],
      [[20, 0], [25, 0]],
    ]);
  });

  it('splits areas at long moves across open fabric, lines at moves longer than their longest stitch', () => {
    const two = [...rect(0, 0, 5, 5)];
    const { doc, of } = design([
      { type: 'fill', init: { closed: true, points: nodes(two), holes: [] }, stitches: [[1, 1], [4, 1], [4, 4]] },
      { type: 'running', stitches: [[0, 10], [3, 10], [13, 10], [16, 10]] },
    ]);
    // Fill: every move stays inside -> one run. Line: the 10 mm move is a connector.
    expect(splitRuns(doc.objects[0]!, [[1, 1], [4, 1], [4.5, 4.5]], doc)).toHaveLength(1);
    expect(splitRuns(doc.objects[1]!, of(doc.objects[1]!), doc)).toHaveLength(2);
    const gap = createObject(doc, { stitchType: 'fill', closed: true, points: nodes([[0, 0], [5, 0], [5, 5], [0, 5]]) });
    expect(splitRuns(gap, [[1, 1], [1, 4], [20, 4]], doc)).toHaveLength(2); // leaves the shape for 15 mm
  });

  it('keeps columns as one run', () => {
    const { doc, of } = design([{ type: 'satin', stitches: [[0, 0], [0, 20], [1, 0]] }]);
    expect(splitRuns(doc.objects[0]!, of(doc.objects[0]!), doc)).toHaveLength(1);
  });
});

describe('real designs', () => {
  it('plans computed stitches end to end', () => {
    const doc = createDocument();
    doc.objects.push(createObject(doc, { stitchType: 'fill', closed: true, points: nodes(rect(0, 0, 20, 20)) }));
    doc.objects.push(createObject(doc, { stitchType: 'satin', points: nodes([[0, 30], [20, 30]]), color: [0, 94, 184] }));
    const plan = buildExportPlan(doc, (o) => computeStitches(o));
    expect(plan.threads).toHaveLength(2);
    expect(kinds(plan.commands).filter((k) => k === 'color_change')).toHaveLength(1);
    expect(plan.commands.filter((c) => c[0] === 'stitch').length).toBeGreaterThan(500);
    expect(plan.commands.every((c) => Number.isFinite(c[1]) && Number.isFinite(c[2]))).toBe(true);
  });
});

describe('closest join in the editor', () => {
  const line = (pts: Point[], init: NewObject = {}) => ({ stitches: pts, init: { points: nodes(pts), ...init } });

  it('starts an auto-entry object at its point nearest the previous same-colour exit', () => {
    const { doc, of } = design([line([[0, 0], [10, 0]]), line([[20, 0], [11, 0]])], { closestJoin: true });
    const out = applyClosestJoin(doc, of);
    expect(out[0]).toBe(doc.objects[0]);
    expect(out[1]!.fillStart).toEqual([11, 0]);
    expect(out[1]!.version).toBe(doc.objects[1]!.version + 1);
  });

  it('leaves entries automatic when too far, a different colour, or not auto', () => {
    const far = design([line([[0, 0], [10, 0]]), line([[20, 0], [15, 0]])], { closestJoin: true });
    expect(applyClosestJoin(far.doc, far.of)[1]).toBe(far.doc.objects[1]);
    const colour = design([line([[0, 0], [10, 0]]), line([[20, 0], [11, 0]], { color: [255, 0, 0] })], { closestJoin: true });
    expect(applyClosestJoin(colour.doc, colour.of)[1]!.fillStart).toBeNull();
    const manual = design([line([[0, 0], [10, 0]]), line([[20, 0], [11, 0]], { autoEntry: false })], { closestJoin: true });
    expect(applyClosestJoin(manual.doc, manual.of)[1]).toBe(manual.doc.objects[1]);
    const off = design([line([[0, 0], [10, 0]]), line([[20, 0], [11, 0]])], { closestJoin: false });
    expect(applyClosestJoin(off.doc, off.of)).toBe(off.doc.objects);
  });

  it('moves a row fill exit toward the next object', () => {
    const { doc, of } = design(
      [{ type: 'fill', init: { closed: true, points: nodes(rect(0, 0, 10, 10)) }, stitches: [[1, 1]] }, line([[30, 5], [40, 5]])],
      { closestJoin: true },
    );
    expect(applyClosestJoin(doc, of)[0]!.fillEnd).toEqual([10, 5]);
  });
});
