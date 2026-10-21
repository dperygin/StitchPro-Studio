import { describe, expect, it } from 'vitest';
import {
  autoSplit,
  columnRungs,
  columnStitches,
  computeStitches,
  createDocument,
  createObject,
  defaultSettings,
  distance,
  materializeDetailed,
  mulberry32,
  pathNode,
  sewnSpacing,
  sharpenBends,
  type ColumnKind,
  type ColumnOptions,
  type PathNode,
  type Point,
  type StitchSettings,
} from '../src/index';

const corner = (x: number, y: number, w: number | null = null) => pathNode(x, y, 'corner', w);
const curve = (x: number, y: number, w: number | null = null) => pathNode(x, y, 'curve', w);
const satinSettings = (o: Partial<StitchSettings> = {}) =>
  sewnSpacing(defaultSettings({ stitchType: 'satin', satinWidth: 4, pullCompensation: 0.2, ...o }));
const sew = (nodes: PathNode[], o: Partial<StitchSettings> = {}, closed = false, kind: ColumnKind = 'satin', opts: ColumnOptions = {}) =>
  columnStitches(nodes, closed, satinSettings({ stitchType: kind, ...o }), kind, opts);
const near = (a: Point, b: Point, tol = 1e-6) => distance(a, b) <= tol;
const finite = (pts: Point[]) => pts.every((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]));
const straight = [corner(0, 0), corner(10, 0)];

describe('straight satin', () => {
  it('alternates edges every sewn spacing, pull compensation pushing both ends out', () => {
    const pts = sew(straight);
    expect(pts).toHaveLength(51); // 0..10 every 0.2 (half of the 0.4 forward spacing)
    pts.forEach((p, i) => {
      expect(p[0]).toBeCloseTo(0.2 * i, 9);
      expect(p[1]).toBeCloseTo(i % 2 === 0 ? -2.2 : 2.2, 9); // left edge (up on screen) first
    });
  });

  it('starts on the requested side and adds one stitch back to end on the right side', () => {
    expect(sew(straight, {}, false, 'satin', { firstSide: 1 })[0]![1]).toBeCloseTo(2.2, 9);
    const pts = sew(straight, {}, false, 'satin', { lastSide: 1 });
    expect(pts).toHaveLength(52);
    expect(near(pts[51]!, [10, 2.2])).toBe(true);
    expect(sew(straight, {}, false, 'satin', { lastSide: 0 })).toHaveLength(51);
  });

  it('grades the spacing from satinDensity to gradedEndDensity', () => {
    const pts = sew(straight, { gradedDensity: true, satinDensity: 0.4, gradedEndDensity: 1.2 });
    const gaps = pts.slice(1).map((p, i) => p[0] - pts[i]![0]);
    expect(gaps[0]).toBeCloseTo(0.2, 6);
    expect(gaps[gaps.length - 2]!).toBeGreaterThan(0.55);
    for (let i = 1; i < gaps.length - 1; i++) expect(gaps[i]!).toBeGreaterThanOrEqual(gaps[i - 1]! - 1e-9);
  });
});

describe('tapered satin', () => {
  it('follows the node widths along the column', () => {
    const pts = sew([corner(0, 0, 2), corner(10, 0, 6)], { pullCompensation: 0 });
    for (const [x, y] of pts) expect(Math.abs(y)).toBeCloseTo(1 + 0.2 * x, 6);
  });

  it('opens the spacing on narrow columns (auto spacing)', () => {
    const pts = sew([corner(0, 0, 2), corner(10, 0, 6)], { pullCompensation: 0 });
    expect(pts[1]![0] - pts[0]![0]).toBeCloseTo(0.2 * 1.1, 6); // narrow factor at width 2
    const fixed = sew([corner(0, 0, 2), corner(10, 0, 6)], { pullCompensation: 0, autoSpacing: false });
    expect(fixed[1]![0]).toBeCloseTo(0.2, 6);
  });
});

describe('mitred satin', () => {
  // East then down the screen: a right turn, so the outside is the left (upper) edge.
  const L = [corner(0, 0), corner(10, 0), corner(10, 10)];

  it('reaches the mitre point and stays inside both legs', () => {
    const pts = sew(L);
    expect(finite(pts)).toBe(true);
    // The outer edges run out to the mitre point; the last sliver under 0.5 mm is dropped.
    expect(pts.some((p) => near(p, [12.2, -2.2], 0.65))).toBe(true);
    expect(pts.some((p) => near(p, [12.2, -2.2], 0.3))).toBe(false);
    for (const [x, y] of pts) {
      expect(y).toBeGreaterThanOrEqual(-2.2 - 1e-6);
      expect(x).toBeLessThanOrEqual(12.2 + 1e-6);
      expect(x < 7.8 - 1e-6 && y > 2.2 + 1e-6).toBe(false);
    }
  });

  it('clips the inside corner at the mitre line', () => {
    const rungs = columnRungs(L, false, satinSettings(), 'satin');
    for (const r of rungs.filter((r) => r.c[1] === 0 && r.c[0] <= 10)) {
      // Incoming leg: every end keeps (x - 10) + y <= 0.
      const right: Point = [r.c[0] - r.n[0] * r.right, r.c[1] - r.n[1] * r.right];
      expect(right[0] - 10 + right[1]).toBeLessThanOrEqual(1e-6);
    }
  });

  it('caps instead when the mode says so', () => {
    const pts = sew(L, { cornerMode: 'cap' });
    expect(pts.some((p) => near(p, [12.2, -2.2], 0.65))).toBe(false);
    const outer = pts.filter(([x, y]) => x > 10 + 1e-6 && y < -1e-6);
    expect(outer.length).toBeGreaterThan(3);
    for (const p of outer) expect(distance(p, [10, 0])).toBeLessThanOrEqual(2.2 + 1e-6);
  });
});

describe('capped satin', () => {
  // A 16.7 degree V: below capBelowDeg, so auto mode caps it.
  const V = [corner(0, 0), corner(10, 0), corner(0, 3)];

  it('fans round the outside of a sharp corner', () => {
    const pts = sew(V, { stitchShortening: false }); // shortening would pull crowded inner ends in
    expect(finite(pts)).toBe(true);
    const fan = pts.filter((p) => p[0] > 10.3 && p[1] < 0.5);
    expect(fan.length).toBeGreaterThan(5);
    for (const p of fan) expect(distance(p, [10, 0])).toBeCloseTo(2.2, 6);
    // Nothing pokes out past the cap.
    for (const p of pts) expect(p[0]).toBeLessThanOrEqual(12.2 + 1e-6);
  });

  it('puts the fan rungs inner ends on a small arc', () => {
    const rungs = columnRungs(V, false, satinSettings(), 'satin').filter((r) => r.corner && near(r.c, [10, 0]));
    const fan = rungs.filter((r) => Math.min(r.left, r.right) > 0.1);
    expect(fan.length).toBeGreaterThan(5);
    for (const r of fan) {
      expect(Math.max(r.left, r.right)).toBeCloseTo(2.2, 9);
      expect(Math.min(r.left, r.right)).toBeCloseTo(Math.min(0.5, 4 / 4), 9);
    }
  });

  it('drops corner stitches shorter than 0.5 mm in auto mode', () => {
    const rungs = columnRungs(V, false, satinSettings(), 'satin');
    for (const r of rungs.filter((r) => r.corner)) expect(r.left + r.right).toBeGreaterThanOrEqual(0.5);
  });
});

describe('heart-shaped satin', () => {
  const heart = [
    corner(0, 0),
    curve(4, -4),
    curve(8, -1),
    curve(6, 5),
    corner(0, 12),
    curve(-6, 5),
    curve(-8, -1),
    curve(-4, -4),
  ];

  it('sews a closed heart with both points mitred', () => {
    const pts = sew(heart, { satinWidth: 3 }, true);
    expect(finite(pts)).toBe(true);
    expect(pts.length).toBeGreaterThan(300);
    const ys = pts.map((p) => p[1]);
    expect(Math.max(...ys)).toBeGreaterThan(12 + 1.5); // the tip is mitred to a point
    expect(Math.max(...ys)).toBeLessThan(12 + 4);
    for (const p of pts) {
      expect(Math.abs(p[0])).toBeLessThan(10.5);
      expect(p[1]).toBeGreaterThan(-6.5);
    }
  });

  it('moves the seam away from the corners and sews it once', () => {
    const pts = sew(heart, { satinWidth: 3 }, true);
    expect(distance(pts[0]!, [0, 0])).toBeGreaterThan(4);
    expect(distance(pts[0]!, [0, 12])).toBeGreaterThan(4);
    const rungs = columnRungs(heart, true, satinSettings({ satinWidth: 3 }), 'satin');
    expect(near(rungs[0]!.c, rungs[rungs.length - 1]!.c, 0.01)).toBe(false);
  });
});

describe('closed satin without corners', () => {
  it('runs round a circle without doubling the seam', () => {
    const ring = Array.from({ length: 12 }, (_, i) => curve(10 * Math.cos((i * Math.PI) / 6), 10 * Math.sin((i * Math.PI) / 6)));
    const rungs = columnRungs(ring, true, satinSettings({ autoSpacing: false }), 'satin');
    expect(rungs.length).toBeGreaterThan(300); // 2 pi 10 / 0.2 = 314
    expect(rungs.length).toBeLessThan(330);
    expect(distance(rungs[0]!.c, rungs[rungs.length - 1]!.c)).toBeGreaterThan(0.1);
  });
});

describe('sharp bends hidden by curve nodes', () => {
  const rounded = [corner(0, 0), curve(9.6, 0), curve(10, 0.4), corner(10, 10)];

  it('replaces the rounded stretch with a corner at the sides intersection', () => {
    const m = materializeDetailed(rounded, false, 3);
    const flags = m.points.map(() => false);
    flags[0] = true;
    flags[flags.length - 1] = true;
    const out = sharpenBends({ pts: m.points, widths: m.widths, corner: flags }, 120);
    const corners = out.pts.filter((_, i) => out.corner[i] && i > 0 && i < out.pts.length - 1);
    expect(corners).toHaveLength(1);
    expect(near(corners[0]!, [10, 0], 0.15)).toBe(true);
  });

  it('leaves broad curves alone', () => {
    const arc = Array.from({ length: 9 }, (_, i) => {
      const a = (i * Math.PI) / 8;
      return (i === 0 || i === 8 ? corner : curve)(20 * Math.cos(a), -20 * Math.sin(a));
    });
    const m = materializeDetailed(arc, false, 3);
    const line = { pts: m.points, widths: m.widths, corner: m.points.map(() => false) };
    expect(sharpenBends(line, 120)).toBe(line);
  });

  it('mitres the sharpened bend', () => {
    const pts = sew(rounded, { satinWidth: 3, pullCompensation: 0 });
    // A cap would stay within 1.5 mm of the corner; the mitre reaches out towards (11.5, -1.5).
    const outer = pts.filter(([x, y]) => x > 10 && y < 0);
    expect(Math.max(...outer.map((p) => distance(p, [10, 0])))).toBeGreaterThan(1.6);
    expect(Math.max(...pts.map((p) => p[0]))).toBeLessThan(11.5 + 0.1);
    expect(Math.min(...pts.map((p) => p[1]))).toBeGreaterThan(-1.5 - 0.1);
  });
});

describe('ragged edges', () => {
  it('pulls the edges in periodically, within bounds', () => {
    const pts = sew(straight, { raggedMode: 'periodic', raggedAmount: 0.8, raggedPeriod: 4 });
    for (const p of pts) {
      expect(Math.abs(p[1])).toBeLessThanOrEqual(2.2 + 1e-9);
      expect(Math.abs(p[1])).toBeGreaterThanOrEqual(1.4 - 1e-9);
    }
    // Left edge at d = 0: 0.8 x (0.5 - 0.5 cos 0) = 0; at d = 2: full amount.
    expect(pts[0]![1]).toBeCloseTo(-2.2, 9);
    expect(pts[10]![1]).toBeCloseTo(-1.4, 9);
  });

  it('is random but repeatable', () => {
    const a = sew(straight, { raggedMode: 'random' });
    const b = sew(straight, { raggedMode: 'random' });
    expect(a).toEqual(b);
    expect(new Set(a.map((p) => Math.abs(p[1]).toFixed(4))).size).toBeGreaterThan(10);
  });

  it('never pulls in more than 0.9 x the half width', () => {
    const pts = sew(straight, { satinWidth: 1, pullCompensation: 0, raggedMode: 'periodic', raggedAmount: 5 });
    for (const p of pts) expect(Math.abs(p[1])).toBeGreaterThanOrEqual(0.05 - 1e-9);
  });

  it('mulberry32 is a deterministic generator in [0, 1)', () => {
    const vals = [0, 1, 2, 12345, -7].map(mulberry32);
    expect(vals).toEqual([0, 1, 2, 12345, -7].map(mulberry32));
    for (const v of vals) expect(v >= 0 && v < 1).toBe(true);
    expect(new Set(vals).size).toBe(5);
  });
});

describe('stitch shortening', () => {
  // A tight half circle: radius 3 centreline, width 4, so the inside edge has radius 1.
  const half = Array.from({ length: 9 }, (_, i) => {
    const a = Math.PI + (i * Math.PI) / 8;
    return (i === 0 || i === 8 ? corner : curve)(3 * Math.cos(a), 3 * Math.sin(a));
  });
  const midRadius = (pts: Point[]) => pts.filter((p) => Math.hypot(p[0], p[1]) > 1.4 && Math.hypot(p[0], p[1]) < 4.6);

  it('stops crowded inside stitches 35 % of the way across', () => {
    const pts = sew(half, { pullCompensation: 0, autoSplit: false });
    const short = midRadius(pts);
    expect(short.length).toBeGreaterThan(5);
    for (const p of short) expect(Math.hypot(p[0], p[1])).toBeCloseTo(5 - 0.35 * 4, 1);
  });

  it('can be turned off, and never applies to zigzag', () => {
    expect(midRadius(sew(half, { pullCompensation: 0, autoSplit: false, stitchShortening: false }))).toHaveLength(0);
    expect(midRadius(sew(half, { pullCompensation: 0 }, false, 'zigzag'))).toHaveLength(0);
  });
});

describe('auto split', () => {
  it('splits stitches longer than splitLength', () => {
    const pts = sew(straight, { satinWidth: 10 });
    for (let i = 1; i < pts.length; i++) expect(distance(pts[i - 1]!, pts[i]!)).toBeLessThanOrEqual(7);
    expect(pts.length).toBe(51 + 50);
  });

  it('shifts split points by a golden-ratio sequence so they never line up', () => {
    const out = autoSplit([[0, 0], [0, 10], [0.2, 0], [0.4, 10]], 7);
    // n = ceil(10 / 5.6) = 2 per stitch; shifts ((i x 0.618) mod 1 - 0.5) x 0.25.
    const shift = (i: number) => (((i * 0.6180339887498949) % 1) - 0.5) * 0.25;
    expect(out).toHaveLength(7);
    expect(out[1]![1]).toBeCloseTo(10 * (0.5 + shift(1)), 9);
    expect(out[3]![1]).toBeCloseTo(10 - 10 * (0.5 + shift(2)), 9);
    expect(out[1]![1]).not.toBeCloseTo(10 - out[3]![1], 3);
  });

  it('can be turned off', () => {
    expect(sew(straight, { satinWidth: 10, autoSplit: false })).toHaveLength(51);
  });
});

describe('automatic spacing on curves', () => {
  it('tightens spacing so it is measured on the outside edge', () => {
    const arc = Array.from({ length: 9 }, (_, i) => {
      const a = (i * Math.PI) / 8;
      return (i === 0 || i === 8 ? corner : curve)(5 * Math.cos(a), -5 * Math.sin(a));
    });
    const auto = columnRungs(arc, false, satinSettings(), 'satin').length;
    const fixed = columnRungs(arc, false, satinSettings({ autoSpacing: false }), 'satin').length;
    // outer = 1 + (1/5) x 2 = 1.4 on this arc.
    expect(auto / fixed).toBeGreaterThan(1.3);
    expect(auto / fixed).toBeLessThan(1.45);
  });
});

describe('zigzag and E stitch', () => {
  it('zigzags at half the zigzag spacing', () => {
    const pts = sew(straight, { zigzagSpacing: 2 }, false, 'zigzag');
    expect(pts).toHaveLength(11);
    pts.forEach((p, i) => {
      expect(p[0]).toBeCloseTo(i, 9);
      expect(p[1]).toBeCloseTo(i % 2 ? 2.2 : -2.2, 9);
    });
  });

  it('sews E stitch as base, tip, base per rung', () => {
    const pts = sew(straight, { eSpacing: 2.5 }, false, 'e_stitch');
    expect(pts).toHaveLength(15);
    expect(pts.slice(0, 6).map((p) => [Number(p[0].toFixed(6)), Number(p[1].toFixed(6))])).toEqual([
      [0, -2.2],
      [0, 2.2],
      [0, -2.2],
      [2.5, -2.2],
      [2.5, 2.2],
      [2.5, -2.2],
    ]);
  });

  it('flips E stitch to the other edge', () => {
    const pts = sew(straight, { eSpacing: 2.5, eFlip: true }, false, 'e_stitch');
    expect(pts[0]![1]).toBeCloseTo(2.2, 9);
    expect(pts[1]![1]).toBeCloseTo(-2.2, 9);
  });
});

describe('satin objects', () => {
  it('sew through computeStitches, raised satin adding layers', () => {
    const doc = createDocument();
    const one = createObject(doc, { stitchType: 'satin', points: straight });
    const two = createObject(doc, { stitchType: 'satin', points: straight });
    two.settings.raisedLayers = 2;
    const a = computeStitches(one);
    const b = computeStitches(two);
    expect(a.length).toBeGreaterThan(40);
    expect(b.length).toBeGreaterThan(a.length);
    expect(Math.max(...b.slice(0, 20).map((p) => Math.abs(p[1])))).toBeLessThan(Math.max(...a.map((p) => Math.abs(p[1]))));
  });
});
