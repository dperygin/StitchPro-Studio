import { describe, expect, it } from 'vitest';
import {
  FILL_PATTERNS,
  JUMP_MARK,
  carvedCrossings,
  computeStitches,
  createDocument,
  createObject,
  defaultSettings,
  distance,
  fillEdgeRun,
  fillZigzagUnderlay,
  pathNode,
  pointInRegion,
  polygonFromRings,
  rowNeedles,
  rowPhase,
  scanSections,
  sewnSpacing,
  tatamiFill,
  tatamiLayer,
  tatamiParams,
  tatamiUnderlay,
  type Point,
  type Region,
  type StitchSettings,
} from '../src/index';

const rect = (x0: number, y0: number, x1: number, y1: number): Point[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const square = polygonFromRings(rect(0, 0, 10, 10));
const fill = (o: Partial<StitchSettings> = {}) => sewnSpacing(defaultSettings({ stitchType: 'fill', ...o }));
// A U open at the top: two arms joined by a base.
const U = polygonFromRings([[0, 0], [3, 0], [3, 7], [7, 7], [7, 0], [10, 0], [10, 10], [0, 10]]);
const donut = polygonFromRings(rect(0, 0, 10, 10), [rect(3, 3, 7, 7)]);
const jumps = (pts: Point[]) =>
  pts.filter((p, i) => i >= JUMP_MARK - 1 && pts.slice(i - JUMP_MARK + 1, i + 1).every((q) => q[0] === p[0] && q[1] === p[1])).length;
/** Every stitch stays inside the region (row ends may poke out by the pull compensation). */
const staysInside = (pts: Point[], region: Region, tol: number) => {
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const n = Math.max(1, Math.ceil(distance(a, b) / 0.1));
    for (let k = 0; k <= n; k++) {
      const p: Point = [a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n];
      if (pointInRegion(region, p, tol) === 'outside') return false;
    }
  }
  return true;
};

describe('scanline sections', () => {
  it('fills a square as one section of rows on the y = r x spacing grid', () => {
    const sections = scanSections(square[0]!, 1);
    expect(sections).toHaveLength(1);
    expect(sections[0]!.map((r) => r.r)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]); // y = 10 lies on the bottom edge
    expect(sections[0]![0]!.y).toBeCloseTo(1e-6, 12); // nudged off the top edge
    expect(sections[0]![3]).toEqual({ r: 3, y: 3, x0: 0, x1: 10 });
  });

  it('starts new sections where spans split or merge', () => {
    const sections = scanSections(U[0]!, 1);
    expect(sections).toHaveLength(3); // left arm, right arm, base
    expect(sections.map((s) => s.length).sort()).toEqual([3, 7, 7]);
  });

  it('handles holes with the even-odd rule', () => {
    const sections = scanSections(donut[0]!, 1);
    // Top band, left side, right side, bottom band.
    expect(sections).toHaveLength(4);
  });
});

describe('row phase per pattern', () => {
  const phases = (p: (typeof FILL_PATTERNS)[number], n = 8) => Array.from({ length: n }, (_, r) => Number(rowPhase(p, r).toFixed(6)));

  it('matches the specified sequences', () => {
    expect(phases('thirds', 4)).toEqual([0, 0.333333, 0.666667, 0]);
    expect(phases('quarters', 5)).toEqual([0, 0.25, 0.5, 0.75, 0]);
    expect(phases('fifths', 5)).toEqual([0, 0.4, 0.8, 0.2, 0.6]);
    expect(phases('brick', 3)).toEqual([0, 0.5, 0]);
    expect(phases('diagonal', 4)).toEqual([0, 0.3, 0.9, 0.2]);
    expect(phases('diagonal-left', 4)).toEqual([0, 0.7, 0.1, 0.8]);
    expect(phases('chevron')).toEqual([0, 1, 2, 3, 4, 3, 2, 1].map((x) => x / 8));
    expect(phases('herringbone')).toEqual([0, 2, 4, 6, 0, 6, 4, 2].map((x) => x / 8));
    expect(phases('basket')).toEqual([0, 0, 0, 0, 4, 4, 4, 4].map((x) => x / 8));
    expect(phases('diamonds', 3)).toEqual(phases('thirds', 3));
  });

  it('counts rows from y = 0 (negative rows too)', () => {
    expect(rowPhase('thirds', -1)).toBeCloseTo(2 / 3, 12);
    expect(rowPhase('random', 7)).toBe(rowPhase('random', 7));
    expect(rowPhase('random', 7)).not.toBe(rowPhase('random', 8));
  });
});

describe('row needles', () => {
  const base = { ...tatamiParams(fill({ pullCompensation: 0, fillStitchLength: 4 })), pattern: 'thirds' as const };
  const row = (r: number) => ({ r, y: r, x0: 0, x1: 10 });
  const xs = (pts: Point[]) => pts.map((p) => Number(p[0].toFixed(6)));

  it('puts needles on a shared grid shifted per row, always sewing the ends', () => {
    expect(xs(rowNeedles(row(0), 1, base))).toEqual([0, 4, 8, 10]);
    expect(xs(rowNeedles(row(1), 1, base))).toEqual([0, 1.333333, 5.333333, 10]); // 9.33 is within a quarter stitch of the end
    expect(xs(rowNeedles(row(2), -1, base))).toEqual([10, 6.666667, 2.666667, 0]);
  });

  it('divides each row evenly from its start with stagger off', () => {
    expect(xs(rowNeedles(row(5), 1, { ...base, stagger: false }))).toEqual([0, 3.333333, 6.666667, 10]);
  });

  it('extends row ends by the pull compensation', () => {
    expect(xs(rowNeedles(row(0), 1, { ...base, pull: 0.2 }))).toEqual([-0.2, 4, 8, 10.2]);
  });

  it('adds carved points for embossed patterns, replacing the grid point beside them', () => {
    expect(carvedCrossings('stripes', 1, 0.5, 20, 6, 6)).toEqual([6, 12, 18]);
    expect(carvedCrossings('diamonds', 1.5, 0, 6, 6, 6)).toEqual([1.5, 4.5]);
    const pts = xs(rowNeedles({ r: 0, y: 0, x0: 0, x1: 20 }, 1, { ...base, pattern: 'stripes', embossWidth: 6 }));
    // 12 replaces the grid point it sits on; 6 and 18 are exactly half a stitch from their
    // neighbours, so they are added instead (replacing would leave 6 mm gaps).
    expect(pts).toEqual([0, 4, 6, 8, 12, 16, 18, 20]);
    const near = xs(rowNeedles({ r: 0, y: 0, x0: 0, x1: 20 }, 1, { ...base, pattern: 'stripes', embossWidth: 7 }));
    expect(near).toEqual([0, 4, 7, 12, 14, 16, 20]); // 7 replaces 8; 14 is 2 mm from both 12 and 16, so it is added
  });
});

describe('tatami fill', () => {
  it('fills a square back and forth, forward first, row ends pulled out', () => {
    const pts = tatamiFill(square, fill());
    expect(pts[0]![0]).toBeCloseTo(-0.2, 9);
    expect(pts[0]![1]).toBeCloseTo(0, 5);
    const ys = [...new Set(pts.map((p) => p[1].toFixed(4)))];
    expect(ys).toHaveLength(50); // rows every 0.2 mm (0.4 forward spacing halved)
    for (const [x] of pts) expect(x >= -0.2 - 1e-9 && x <= 10.2 + 1e-9).toBe(true);
    // Grid points within a quarter stitch of a row end are skipped, so a stitch is at most
    // 1.25 stitch lengths plus the pull compensation.
    for (let i = 1; i < pts.length; i++) expect(distance(pts[i - 1]!, pts[i]!)).toBeLessThanOrEqual(1.25 * 4 + 0.2 + 1e-9);
    expect(jumps(pts)).toBe(0);
  });

  it('turns rows to the fill angle', () => {
    const pts = tatamiFill(square, fill({ fillAngle: 90 }));
    const xs = new Set(pts.map((p) => p[0].toFixed(4)));
    expect(xs.size).toBe(50); // vertical rows
  });

  it('starts at the entry and finishes at the exit', () => {
    const pts = tatamiFill(square, fill(), [9, 9], [1, 1]);
    expect(pts[0]).toEqual([9, 9]);
    expect(distance(pts[pts.length - 1]!, [1, 1])).toBeLessThanOrEqual(0.3 + 1e-9);
  });

  it('travels inside a U between sections, never across the gap', () => {
    const pts = tatamiFill(U, fill());
    expect(jumps(pts)).toBe(0);
    expect(staysInside(pts, U, 0.25)).toBe(true);
  });

  it('travels round a hole', () => {
    const pts = tatamiFill(donut, fill());
    expect(staysInside(pts, donut, 0.25)).toBe(true);
  });

  it('sews separate pieces whole, jumping between them', () => {
    const two = [...polygonFromRings(rect(0, 0, 5, 5)), ...polygonFromRings(rect(20, 0, 25, 5))];
    const pts = tatamiFill(two, fill());
    expect(jumps(pts)).toBe(1);
    const firstFar = pts.findIndex((p) => p[0] > 10);
    expect(pts.slice(firstFar).every((p) => p[0] > 10)).toBe(true);
  });

  it('sews the piece with the exit last', () => {
    const two = [...polygonFromRings(rect(0, 0, 5, 5)), ...polygonFromRings(rect(20, 0, 25, 5))];
    const pts = tatamiFill(two, fill(), null, [1, 1]);
    expect(pts[0]![0]).toBeGreaterThan(10);
    expect(pts[pts.length - 1]![0]).toBeLessThan(10);
  });

  it('runs every pattern', () => {
    for (const pattern of FILL_PATTERNS) {
      const pts = tatamiFill(square, fill({ fillPattern: pattern }));
      expect(pts.length).toBeGreaterThan(100);
      expect(pts.every((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]))).toBe(true);
    }
  });

  it('is repeatable', () => {
    expect(tatamiFill(U, fill({ fillPattern: 'random' }))).toEqual(tatamiFill(U, fill({ fillPattern: 'random' })));
  });

  it('falls back to travel inside with travel on edge off', () => {
    const pts = tatamiLayer(U, { ...tatamiParams(fill()), travelOnEdge: false });
    expect(staysInside(pts, U, 0.25)).toBe(true);
  });
});

describe('fill underlay', () => {
  it('tatami underlay: at fillAngle + underlay angle, 0.5 mm minimum spacing, inset ends', () => {
    const pts = tatamiUnderlay(square, fill({ underlaySpacing: 2, underlayInset: 0.3 }));
    const xs = [...new Set(pts.map((p) => p[0].toFixed(3)))];
    expect(xs.length).toBe(5); // vertical rows every 2 mm
    for (const [, y] of pts) expect(y >= 0.3 - 1e-6 && y <= 9.7 + 1e-6).toBe(true);
    const dense = tatamiUnderlay(square, fill({ underlaySpacing: 0.1 }));
    expect(new Set(dense.map((p) => p[0].toFixed(3))).size).toBe(20); // clamped to 0.5 mm
  });

  it('zigzag underlay: one point per row on alternate sides', () => {
    const pts = fillZigzagUnderlay(square, fill({ underlaySpacing: 2, underlayAngle: 0, underlayInset: 0.3 }));
    expect(pts.length).toBeGreaterThanOrEqual(5);
    expect(pts[0]![0]).toBeCloseTo(0.3, 6);
    expect(pts.some((p) => Math.abs(p[0] - 9.7) < 1e-6)).toBe(true);
    for (let i = 1; i < pts.length; i++) expect(distance(pts[i - 1]!, pts[i]!)).toBeLessThanOrEqual(7 + 1e-9);
    expect(fillZigzagUnderlay(square, fill({ underlaySpacing: 2, underlayAngle: 0 }), true).length).toBeGreaterThan(2 * 5);
  });

  it('edge run: running stitch round outline and holes, inset', () => {
    const pts = fillEdgeRun(donut, fill({ underlayInset: 0.5, underlayStitchLength: 2.5 }));
    expect(pts.some((p) => Math.abs(p[0] - 0.5) < 1e-6)).toBe(true); // outline inset
    expect(pts.some((p) => Math.abs(p[0] - 2.5) < 1e-6)).toBe(true); // hole grown by the inset
    for (const p of pts) expect(pointInRegion(donut, p)).toBe('inside');
  });
});

describe('fill objects', () => {
  it('sew through computeStitches', () => {
    const doc = createDocument();
    const o = createObject(doc, { stitchType: 'fill', closed: true, points: rect(0, 0, 10, 10).map(([x, y]) => pathNode(x, y)) });
    const pts = computeStitches(o);
    expect(pts.length).toBeGreaterThan(100);
    expect(staysInside(pts, square, 0.25)).toBe(true);
  });
});
