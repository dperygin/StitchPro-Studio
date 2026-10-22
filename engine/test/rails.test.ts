import { describe, expect, it } from 'vitest';
import {
  computeStitches,
  createDocument,
  createObject,
  defaultSettings,
  distance,
  pathNode,
  railColumn,
  railRungs,
  railUnderlay,
  rungEnd,
  sewnSpacing,
  twoRailStitches,
  type PathNode,
  type Point,
  type RailInput,
  type StitchSettings,
} from '../src/index';

const corner = (x: number, y: number) => pathNode(x, y, 'corner', null);
const curve = (x: number, y: number) => pathNode(x, y, 'curve', null);
const settings = (o: Partial<StitchSettings> = {}) =>
  sewnSpacing(defaultSettings({ stitchType: 'radial_satin', pullCompensation: 0.2, ...o }));
const input = (rail1: PathNode[], rail2: PathNode[], o: Partial<RailInput> = {}): RailInput => ({
  rail1,
  rail2,
  closed: false,
  paired: false,
  ...o,
});
const near = (a: Point, b: Point, tol = 1e-6) => distance(a, b) <= tol;
const r1 = [corner(0, 0), corner(10, 0)];

describe('two-rail satin', () => {
  it('aligns rail 2 so its ends are nearest rail 1 ends', () => {
    const pts = twoRailStitches(input(r1, [corner(10, 4), corner(0, 4)]), settings());
    expect(pts).toHaveLength(51);
    pts.forEach((p, i) => {
      expect(p[0]).toBeCloseTo(0.2 * i, 9);
      // Alternates rails; pull compensation pushes both ends out by 0.2 mm.
      expect(p[1]).toBeCloseTo(i % 2 === 0 ? -0.2 : 4.2, 9);
    });
  });

  it('walks both rails by the same fraction, spacing measured on the longer rail', () => {
    const col = railColumn(input(r1, [corner(-5, 4), corner(15, 4)]))!;
    expect(col.length).toBe(20);
    const rungs = railRungs(col, settings({ pullCompensation: 0 }));
    expect(rungs).toHaveLength(101);
    rungs.forEach((r, k) => {
      expect(rungEnd(r, 0)[0]).toBeCloseTo((10 * k) / 100, 9);
      expect(rungEnd(r, 1)[0]).toBeCloseTo(-5 + (20 * k) / 100, 9);
    });
  });

  it('applies the ragged edge', () => {
    const a = twoRailStitches(input(r1, [corner(0, 4), corner(10, 4)]), settings({ raggedMode: 'periodic', raggedAmount: 0.8 }));
    expect(a).toEqual(twoRailStitches(input(r1, [corner(0, 4), corner(10, 4)]), settings({ raggedMode: 'periodic', raggedAmount: 0.8 })));
    expect(Math.min(...a.filter((_, i) => i % 2 === 0).map((p) => p[1]))).toBeCloseTo(-0.2, 6);
    expect(Math.max(...a.filter((_, i) => i % 2 === 0).map((p) => p[1]))).toBeGreaterThan(0.4);
  });

  it('runs closed rails the same way round', () => {
    const ring = (r: number, reverse: boolean) => {
      const nodes = Array.from({ length: 12 }, (_, i) => curve(r * Math.cos((i * Math.PI) / 6), r * Math.sin((i * Math.PI) / 6)));
      return reverse ? nodes.reverse() : nodes;
    };
    const col = railColumn(input(ring(10, false), ring(6, true), { closed: true }))!;
    const rungs = railRungs(col, settings({ pullCompensation: 0 }));
    for (const r of rungs) expect(distance(rungEnd(r, 0), rungEnd(r, 1))).toBeCloseTo(4, 1);
  });

  it('sews radial_satin objects through computeStitches', () => {
    const doc = createDocument();
    const o = createObject(doc, { stitchType: 'radial_satin', points: r1, rail2: [corner(0, 4), corner(10, 4)] });
    expect(computeStitches(o).length).toBeGreaterThan(50);
    expect(computeStitches(createObject(doc, { stitchType: 'radial_satin', points: r1 }))).toEqual([]);
  });
});

describe('Column tool (paired rails)', () => {
  const rail1 = [corner(0, 0), corner(10, 0), corner(20, 0)];
  const rail2 = [corner(0, 4), corner(14, 4), corner(20, 4)];

  it('pairs node i with node i and keeps every pair as a rung', () => {
    const col = railColumn(input(rail1, rail2, { paired: true }))!;
    expect(col.piecewise).toBe(true);
    expect(col.pieces).toHaveLength(2);
    const rungs = railRungs(col, settings({ pullCompensation: 0 }));
    expect(rungs.some((r) => near(rungEnd(r, 0), [10, 0], 1e-9) && near(rungEnd(r, 1), [14, 4], 1e-9))).toBe(true);
  });

  it('divides each piece into round(longer length / spacing) steps, turning the angle smoothly', () => {
    const col = railColumn(input(rail1, rail2, { paired: true }))!;
    const rungs = railRungs(col, settings({ pullCompensation: 0 }));
    expect(rungs).toHaveLength(70 + 50 + 1); // pieces' longer rails are 14 and 10 mm, at 0.2 mm
    const slant = rungs.map((r) => rungEnd(r, 1)[0] - rungEnd(r, 0)[0]);
    for (let i = 1; i <= 70; i++) expect(slant[i]!).toBeGreaterThan(slant[i - 1]!); // 0 -> 4
    for (let i = 71; i < slant.length; i++) expect(slant[i]!).toBeLessThan(slant[i - 1]!); // 4 -> 0
  });
});

describe('stitch angle lines', () => {
  const r2 = [corner(0, 4), corner(10, 4)];

  it('add a rung where a line crosses both rails', () => {
    const col = railColumn(input(r1, r2, { stitchAngles: [[[3, -1], [7, 5]]] }))!;
    expect(col.piecewise).toBe(true);
    const rungs = railRungs(col, settings({ pullCompensation: 0 }));
    expect(rungs.some((r) => near(rungEnd(r, 0), [3 + 4 / 6, 0], 1e-9) && near(rungEnd(r, 1), [3 + 20 / 6, 4], 1e-9))).toBe(true);
  });

  it('take the crossing nearest the middle of the line', () => {
    const bent = [corner(0, 0), corner(10, 0), corner(10, 6), corner(20, 6)];
    const col = railColumn(input(bent, [corner(0, 10), corner(20, 10)], { stitchAngles: [[[5, -3], [5, 12]]] }))!;
    const rungs = railRungs(col, settings({ pullCompensation: 0 }));
    expect(rungs.some((r) => near(rungEnd(r, 0), [5, 0], 1e-9) && near(rungEnd(r, 1), [5, 10], 1e-9))).toBe(true);
  });

  it('are ignored when they miss a rail, sit within 0.05 mm of a rung, or cross one', () => {
    const one = railColumn(input(r1, r2, { stitchAngles: [[[3, -1], [3, 1]]] }))!;
    expect(railColumn(input(r1, r2, { stitchAngles: [[[20, -1], [20, 5]]] }))!.piecewise).toBe(false);
    expect(one.piecewise).toBe(true); // segments are extended: the infinite line crosses both rails
    expect(railColumn(input(r1, r2, { stitchAngles: [[[0.02, -1], [0.02, 5]]] }))!.piecewise).toBe(false);
    const crossing = railColumn(input(r1, r2, { stitchAngles: [[[2, -1], [2, 5]], [[5, -1], [-1, 5]]] }))!;
    // The second line crosses the first and is dropped: away from the ends every rung keeps the
    // first (vertical) line's angle.
    for (const r of railRungs(crossing, settings({ pullCompensation: 0 }))) {
      if (r.c[0] > 1 && r.c[0] < 9) expect(rungEnd(r, 0)[0]).toBeCloseTo(rungEnd(r, 1)[0], 6);
    }
  });

  it('hold their angle past the first and last line (fanning only at the ends)', () => {
    const long = [corner(0, 0), corner(30, 0)];
    const col = railColumn(input(long, [corner(0, 6), corner(30, 6)], { stitchAngles: [[[10, -3], [20, 9]]] }))!;
    const slant = (r: ReturnType<typeof railRungs>[number]) => rungEnd(r, 1)[0] - rungEnd(r, 0)[0];
    const rungs = railRungs(col, settings({ pullCompensation: 0 }));
    // The line runs 10 across for 12 down: 5 across over the 6 mm column, everywhere but the ends.
    const held = rungs.filter((r) => r.c[0] > 4 && r.c[0] < 26);
    expect(held.length).toBeGreaterThan(50);
    for (const r of held) expect(slant(r)).toBeCloseTo(5, 1);
    // The ends still meet the column's end edges.
    expect(slant(rungs[0]!)).toBeCloseTo(0, 6);
    expect(slant(rungs.at(-1)!)).toBeCloseTo(0, 6);
  });

  it('lose to the Column own rungs', () => {
    const rail1 = [corner(0, 0), corner(10, 0), corner(20, 0)];
    const rail2 = [corner(0, 4), corner(10, 4), corner(20, 4)];
    const col = railColumn(input(rail1, rail2, { paired: true, stitchAngles: [[[11, -1], [7, 5]]] }))!;
    expect(col.pieces).toHaveLength(2); // it would cross the node rung at x = 10
  });
});

describe('column shortening', () => {
  // Concentric half rings: rail 1 radius 5 (outside), rail 2 radius 1 (inside).
  const arc = (r: number) =>
    Array.from({ length: 9 }, (_, i) => {
      const a = Math.PI + (i * Math.PI) / 8;
      return (i === 0 || i === 8 ? corner : curve)(r * Math.cos(a), r * Math.sin(a));
    });
  const mid = (pts: Point[]) => pts.filter((p) => Math.hypot(p[0], p[1]) > 1.4 && Math.hypot(p[0], p[1]) < 4.6);

  it('is off by default', () => {
    expect(mid(twoRailStitches(input(arc(5), arc(1)), settings({ pullCompensation: 0, autoSplit: false })))).toHaveLength(0);
  });

  it('stops crowded stitches 35 % of the way from the far rail when on', () => {
    const pts = twoRailStitches(input(arc(5), arc(1)), settings({ pullCompensation: 0, autoSplit: false, columnShortening: true }));
    const short = mid(pts);
    expect(short.length).toBeGreaterThan(5);
    for (const p of short) expect(Math.hypot(p[0], p[1])).toBeCloseTo(5 - 0.35 * 4, 1);
  });
});

describe('underlay for rails', () => {
  const col = railColumn(input(r1, [corner(0, 4), corner(10, 4)]))!;
  const s = settings();
  const round = (pts: Point[]) => pts.map((p) => [Number(p[0].toFixed(6)), Number(p[1].toFixed(6))]);

  it('edge run: down one side inset, back up the other, inside the margins', () => {
    expect(round(railUnderlay(col, s, 'edge'))).toEqual([
      [0.3, 0.3], [2.8, 0.3], [5.3, 0.3], [7.8, 0.3], [9.7, 0.3],
      [9.7, 3.7], [7.8, 3.7], [5.3, 3.7], [2.8, 3.7], [0.3, 3.7],
    ]);
  });

  it('centre run', () => {
    expect(round(railUnderlay(col, s, 'center'))).toEqual([[0.3, 2], [2.8, 2], [5.3, 2], [7.8, 2], [9.7, 2]]);
  });

  it('zigzag: across the rungs, then a centre run back', () => {
    expect(round(railUnderlay(col, s, 'zigzag'))).toEqual([
      [0.3, 0.3], [2.3, 3.7], [4.3, 0.3], [6.3, 3.7], [8.3, 0.3], [9.7, 3.7],
      [9.7, 2], [7.8, 2], [5.3, 2], [2.8, 2], [0.3, 2],
    ]);
  });

  it('double zigzag: a second zigzag back crosses the first', () => {
    const pts = round(railUnderlay(col, s, 'double-zigzag'));
    expect(pts.slice(6)).toEqual([[9.7, 0.3], [8.3, 3.7], [6.3, 0.3], [4.3, 3.7], [2.3, 0.3], [0.3, 3.7]]);
  });

  it('slants the zigzag by the underlay zigzag angle', () => {
    const pts = round(railUnderlay(col, settings({ underlayZigzagAngle: 45 }), 'zigzag'));
    expect(pts[1]![0]).toBeCloseTo(2.3 + 3.4, 9); // width 3.4 / tan 45
    expect(pts[1]![1]).toBeCloseTo(3.7, 9);
  });

  it('uses the layer 2 settings for layer 2', () => {
    const pts = railUnderlay(col, settings({ underlay2Inset: 1, underlay2StitchLength: 5 }), 'edge', 2);
    expect(round(pts)).toEqual([[0.3, 1], [5.3, 1], [9.7, 1], [9.7, 3], [5.3, 3], [0.3, 3]]);
  });

  it('never insets a rung below 0.2 mm', () => {
    const narrow = railColumn(input(r1, [corner(0, 0.5), corner(10, 0.5)]))!;
    for (const p of railUnderlay(narrow, s, 'edge').slice(0, 3)) expect(p[1]).toBeCloseTo(0.15, 9);
  });
});
