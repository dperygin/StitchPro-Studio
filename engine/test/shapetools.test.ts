import { describe, expect, it } from 'vitest';
import {
  appliquePieces,
  appliqueRole,
  createDocument,
  createObject,
  cutColumn,
  cutObject,
  fillHoleObjects,
  knockoutPlan,
  laydownRegion,
  partialAppliquePlan,
  pathNode,
  polygonFromRings,
  regionArea,
  sewObject,
  pointInRegion,
  weldObjects,
  type NewObject,
  type Point,
  type StitchObject,
} from '../src';

const doc = createDocument();
const make = (init: NewObject): StitchObject => createObject(doc, init);
const nodes = (pts: Point[]) => pts.map(([x, y]) => pathNode(x, y));
const square = (x0: number, y0: number, x1: number, y1: number): Point[] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];
const fillSquare = (x0: number, y0: number, x1: number, y1: number, init: NewObject = {}) =>
  make({ stitchType: 'fill', closed: true, points: nodes(square(x0, y0, x1, y1)), ...init });
const xsOf = (o: NewObject) => (o.points ?? []).map((n) => n.x);
const bounds = (o: NewObject) => {
  const xs = (o.points ?? []).map((n) => n.x);
  const ys = (o.points ?? []).map((n) => n.y);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
};
const asObject = (n: NewObject) => make(n);

describe('cutColumn', () => {
  const cutter = polygonFromRings(square(8, -5, 12, 5));

  it('keeps the runs of a satin outside the cutter', () => {
    const satin = make({ stitchType: 'satin', points: nodes([[0, 0], [20, 0]]) });
    const pieces = cutColumn(satin, cutter)!;
    expect(pieces).toHaveLength(2);
    expect(Math.max(...xsOf(pieces[0]!))).toBeCloseTo(8, 0);
    expect(Math.min(...xsOf(pieces[1]!))).toBeCloseTo(12, 0);
    expect(pieces.every((p) => p.settings!.stitchType === 'satin')).toBe(true);
  });

  it('rebuilds two-rail pieces with paired rails and opens a closed satin once', () => {
    const rails = make({ stitchType: 'radial_satin', points: nodes([[0, -1], [20, -1]]), rail2: nodes([[0, 1], [20, 1]]) });
    const pieces = cutColumn(rails, cutter)!;
    expect(pieces).toHaveLength(2);
    expect(pieces[0]!.settings!.pairedRails).toBe(true);
    expect(pieces[0]!.points!.length).toBe(pieces[0]!.rail2!.length);
    const ring = make({ stitchType: 'satin', closed: true, points: nodes(square(0, -10, 20, 10)) });
    const opened = cutColumn(ring, polygonFromRings(square(-3, -3, 3, 3)))!;
    expect(opened).toHaveLength(1);
    expect(opened[0]!.closed).toBe(false);
    expect(cutColumn(rails, polygonFromRings(square(50, 50, 60, 60)))).toBeNull();
  });
});

describe('knockout overlaps', () => {
  it('cuts the cutter (shrunk by the overlap) out of earlier dense fills only', () => {
    const under = fillSquare(0, 0, 20, 20);
    const run = make({ stitchType: 'running', points: nodes([[0, 10], [20, 10]]) });
    const cutter = fillSquare(5, 5, 15, 15);
    const plan = knockoutPlan([under, run, cutter], [cutter.id]);
    expect([...plan.keys()]).toEqual([under.id]);
    const [piece] = plan.get(under.id)!;
    expect(piece!.holes).toHaveLength(1);
    const hole = piece!.holes![0]!;
    expect(Math.min(...hole.map((n) => n.x))).toBeCloseTo(6, 1);
    expect(Math.max(...hole.map((n) => n.x))).toBeCloseTo(14, 1);
  });

  it('ignores narrow cutters and later objects, and drops pieces under 1 mm', () => {
    const under = fillSquare(0, 0, 20, 20);
    const narrow = fillSquare(5, 0, 6.5, 20);
    expect(knockoutPlan([under, narrow], [narrow.id]).size).toBe(0);
    const later = fillSquare(0, 0, 20, 20);
    const cutterFirst = fillSquare(5, 5, 15, 15);
    expect(knockoutPlan([cutterFirst, later], [cutterFirst.id]).size).toBe(0);
    // Shrunk by the overlap, the cutter leaves a 0.5 mm strip on the right: it is dropped.
    const big = fillSquare(-5, -5, 20.5, 25);
    expect(knockoutPlan([under, big], [big.id]).get(under.id)).toEqual([]);
  });

  it('cuts satins under a cutter with cutColumn', () => {
    const satin = make({ stitchType: 'satin', points: nodes([[0, 10], [30, 10]]) });
    const cutter = fillSquare(10, 0, 20, 20);
    expect(knockoutPlan([satin, cutter], [cutter.id]).get(satin.id)).toHaveLength(2);
  });
});

describe('cut shapes (knife)', () => {
  const knife: Point[] = [
    [10, -5],
    [10, 25],
  ];

  it('splits an area exactly, nearest-first from the entry with the exit piece last', () => {
    const area = fillSquare(0, 0, 20, 20, { fillStart: [19, 1] });
    const pieces = cutObject(area, knife)!;
    expect(pieces).toHaveLength(2);
    expect(bounds(pieces[0]!)[0]).toBeCloseTo(10, 6);
    expect(bounds(pieces[1]!)[2]).toBeCloseTo(10, 6);
    const withExit = fillSquare(0, 0, 20, 20, { fillStart: [19, 1], fillEnd: [18, 19] });
    const ordered = cutObject(withExit, knife)!;
    expect(bounds(ordered[1]!)[0]).toBeCloseTo(10, 6);
    expect(ordered[1]!.fillEnd).toEqual([18, 19]);
  });

  it('drops slivers and misses objects the line does not cross', () => {
    const area = fillSquare(0, 0, 20, 20);
    expect(cutObject(area, [[0.2, -5], [0.2, 25]])).toBeNull();
    expect(cutObject(area, [[30, -5], [30, 25]])).toBeNull();
  });

  it('cuts lines and satins with the ends brought back to the line', () => {
    const run = make({ stitchType: 'running', points: nodes([[0, 10], [20, 10]]) });
    const pieces = cutObject(run, knife)!;
    expect(pieces).toHaveLength(2);
    expect(Math.max(...xsOf(pieces[0]!))).toBeCloseTo(10, 6);
    expect(Math.min(...xsOf(pieces[1]!))).toBeCloseTo(10, 6);
    const ring = make({ stitchType: 'satin', closed: true, points: nodes(square(0, 5, 20, 15)) });
    const halves = cutObject(ring, knife)!;
    expect(halves).toHaveLength(2);
    expect(halves.every((h) => !h.closed)).toBe(true);
  });

  it('cuts two-rail columns rung by rung, rails ending on the line', () => {
    const col = make({ stitchType: 'radial_satin', points: nodes([[0, 9], [20, 9]]), rail2: nodes([[0, 11], [20, 11]]) });
    const pieces = cutObject(col, knife)!;
    expect(pieces).toHaveLength(2);
    expect(pieces[0]!.points!.at(-1)!.x).toBeCloseTo(10, 6);
    expect(pieces[0]!.rail2!.at(-1)!.x).toBeCloseTo(10, 6);
    expect(pieces[1]!.points![0]!.x).toBeCloseTo(10, 6);
  });

  it('leaves manual and hand-edited objects alone', () => {
    const manual = make({ stitchType: 'manual', points: nodes([[0, 10], [20, 10]]) });
    expect(cutObject(manual, knife)).toBeNull();
    const edited = make({ stitchType: 'running', points: nodes([[0, 10], [20, 10]]), customStitches: [[0, 10], [20, 10]] });
    expect(cutObject(edited, knife)).toBeNull();
  });
});

describe('weld and fill holes', () => {
  it('welds areas into one object with the first settings; lines become tatami', () => {
    const a = fillSquare(0, 0, 10, 10, { settings: { ...createObject(doc, { stitchType: 'fill' }).settings, fillAngle: 30 } });
    const b = fillSquare(5, 5, 15, 15);
    const [w, ...rest] = weldObjects([a, b]);
    expect(rest).toHaveLength(0);
    expect(w!.settings!.fillAngle).toBe(30);
    expect(regionArea(polygonFromRings(w!.points!.map((n): Point => [n.x, n.y])))).toBeCloseTo(175, 3);
    const outline = make({ stitchType: 'running', closed: true, points: nodes(square(20, 0, 30, 10)) });
    expect(weldObjects([outline, b]).every((o) => o.settings!.stitchType === 'fill')).toBe(true);
    expect(weldObjects([outline, b])).toHaveLength(2);
  });

  it('fills each hole with the same settings, grown by the margin', () => {
    const o = fillSquare(0, 0, 20, 20, { holes: [nodes(square(5, 5, 15, 15))] });
    const [h] = fillHoleObjects(o);
    expect(h!.settings!.stitchType).toBe('fill');
    const [x0, y0, x1] = bounds(h!);
    expect(x0).toBeCloseTo(4.7, 2);
    expect(y0).toBeCloseTo(4.7, 2);
    expect(x1).toBeCloseTo(15.3, 2);
  });
});

describe('laydown', () => {
  const area = fillSquare(0, 0, 10, 10);
  const line = make({ stitchType: 'running', points: nodes([[20, 5], [30, 5]]) });

  it('grows the union of areas and line bands by the offset', () => {
    const r = laydownRegion([area, line], 'outline', 2);
    expect(r).toHaveLength(2);
    expect(pointInRegion(r, [-1.9, 5])).toBe('inside');
    expect(pointInRegion(r, [25, 5 + 0.75 + 1.9])).toBe('inside');
    expect(pointInRegion(r, [25, 5 + 0.75 + 2.1])).toBe('outside');
  });

  it('makes a box, or an ellipse through the box corners', () => {
    const box = laydownRegion([area], 'box', 2);
    expect(regionArea(box)).toBeCloseTo(14 * 14, 6);
    const ellipse = laydownRegion([area], 'ellipse', 2);
    expect(pointInRegion(ellipse, [-1.9, -1.9])).toBe('inside');
    expect(regionArea(ellipse)).toBeCloseTo(Math.PI * 7 * Math.SQRT2 * 7 * Math.SQRT2, -1);
  });
});

describe('applique', () => {
  const ring = square(0, 0, 20, 20);

  it('makes placement + stop, tack-down + stop, then cover', () => {
    const pieces = appliquePieces([ring], { color: [200, 0, 0] });
    expect(pieces.map((p) => asObject(p)).map(appliqueRole)).toEqual(['placement', 'tackDown', 'cover']);
    expect(pieces.map((p) => p.settings!.stitchType)).toEqual(['running', 'e_stitch', 'satin']);
    expect(pieces.map((p) => p.stopAfter)).toEqual([true, true, false]);
    const hooped = appliquePieces([ring], {}, { hoopOut: [0, 60], tackDown: 'zigzag' });
    expect(hooped[0]!.hoopOut).toEqual([0, 60]);
    expect(hooped[0]!.stopAfter).toBe(false);
    expect(hooped[1]!.settings!.stitchType).toBe('zigzag');
  });

  it('points the E stitch prongs into the fabric either way round', () => {
    const fabric = polygonFromRings(ring);
    for (const r of [ring, [...ring].reverse()]) {
      const tack = asObject(appliquePieces([r], {})[1]!);
      const pts = sewObject(tack);
      // Each E is base, tip, base: the tips point into the fabric, the bases sit outside it.
      const tips = pts.filter((_, i) => i % 3 === 1);
      const bases = pts.filter((_, i) => i % 3 === 0);
      const count = (pts: Point[], where: string) => pts.filter((p) => pointInRegion(fabric, p, 0.05) === where).length;
      expect(count(tips, 'inside')).toBeGreaterThan(4 * count(tips, 'outside'));
      expect(count(bases, 'outside')).toBeGreaterThan(4 * count(bases, 'inside'));
    }
  });

  it('partial applique: a later fabric cuts the earlier cover', () => {
    const first = appliquePieces([square(0, 0, 20, 20)], { groupId: 1 }).map(asObject);
    const second = appliquePieces([square(15, 5, 35, 15)], { groupId: 2 }).map(asObject);
    const plan = partialAppliquePlan([...first, ...second]);
    expect([...plan.keys()]).toEqual([first[2]!.id]);
    const cover = plan.get(first[2]!.id)!;
    expect(cover).toHaveLength(1);
    expect(cover[0]!.closed).toBe(false);
  });
});
