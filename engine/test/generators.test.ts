// Every stitch generator against the same checks: deterministic, a sensible stitch count, the
// stitches inside the shape's extent (plus pull and width), no stitch longer than the type
// allows, and the spacing the settings ask for.

import { describe, expect, it } from 'vitest';
import {
  STITCH_TYPES,
  createDocument,
  createObject,
  distance,
  isAreaType,
  pathNode,
  sewObject,
  stitchRuns,
  type NewObject,
  type Point,
  type StitchObject,
  type StitchSettings,
  type StitchType,
} from '../src/index';

const W = 30;
const H = 20;
const square: Point[] = [
  [0, 0],
  [W, 0],
  [W, H],
  [0, H],
];
const nodes = (pts: Point[]) => pts.map(([x, y]) => pathNode(x, y));

/** A representative object of each type: areas a 30 x 20 mm box, lines an L 30 + 20 mm long. */
function sample(t: StitchType, s: Partial<StitchSettings> = {}): StitchObject {
  const init: NewObject = isAreaType(t)
    ? { closed: true, points: nodes(square) }
    : t === 'radial_satin'
      ? { points: nodes([[0, 0], [W, 0]]), rail2: nodes([[0, 4], [W, 4]]) }
      : t === 'manual'
        ? { points: nodes([[0, 0], [2, 0], [4, 1], [6, 0]]) }
        : { points: nodes([[0, 0], [W, 0], [W, H]]) };
  const o = createObject(createDocument(), { stitchType: t, ...init });
  Object.assign(o.settings, s);
  return o;
}

/** The longest stitch each type may make with default settings, mm. */
const MAX_STITCH: Record<StitchType, number> = {
  running: 3,
  satin: 7,
  zigzag: 7,
  e_stitch: 7,
  motif_line: 7,
  manual: 3,
  radial_satin: 7,
  fill: 7,
  satin_fill: 7,
  outline: 7,
  motif_fill: 7,
  contour: 7,
  stipple: 7,
  cross_stitch: 7,
  laydown: 7,
};

const longest = (pts: Point[]) => Math.max(0, ...stitchRuns(pts).flatMap((run) => run.slice(1).map((p, i) => distance(run[i]!, p))));

const bounds = (pts: Point[]) => {
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
};

describe('every stitch type', () => {
  for (const t of STITCH_TYPES) {
    describe(t, () => {
      const o = sample(t);
      const pts = sewObject(o);

      it('sews deterministically', () => {
        expect(pts.length).toBeGreaterThan(t === 'manual' ? 3 : 10);
        expect(sewObject(sample(t))).toEqual(pts);
        for (const p of pts) expect(Number.isFinite(p[0]) && Number.isFinite(p[1])).toBe(true);
      });

      it('stays inside the shape (plus pull and width) and spans it', () => {
        const half = isAreaType(t) ? 0 : t === 'radial_satin' ? 0 : t === 'running' || t === 'motif_line' || t === 'manual' ? o.settings.motifWidth / 2 : o.settings.satinWidth / 2;
        const tol = half + o.settings.pullCompensation + 0.6;
        const b = bounds(pts);
        const shape = t === 'radial_satin' ? { minX: 0, minY: 0, maxX: W, maxY: 4 } : t === 'manual' ? { minX: 0, minY: 0, maxX: 6, maxY: 1 } : { minX: 0, minY: 0, maxX: W, maxY: H };
        expect(b.minX).toBeGreaterThanOrEqual(shape.minX - tol);
        expect(b.minY).toBeGreaterThanOrEqual(shape.minY - tol);
        expect(b.maxX).toBeLessThanOrEqual(shape.maxX + tol);
        expect(b.maxY).toBeLessThanOrEqual(shape.maxY + tol);
        // It reaches across most of the shape (grid fills of whole motifs or cells stop short of the edge).
        const reach = ['motif_fill', 'stipple', 'cross_stitch'].includes(t) ? 0.7 : 0.85;
        expect(b.maxX - b.minX).toBeGreaterThan(reach * (shape.maxX - shape.minX));
        expect(b.maxY - b.minY).toBeGreaterThan(reach * (shape.maxY - shape.minY) - 0.5);
      });

      it(`makes no stitch longer than ${MAX_STITCH[t]} mm`, () => {
        expect(longest(pts)).toBeLessThanOrEqual(MAX_STITCH[t] + 1e-6);
      });
    });
  }
});

describe('spacing and counts follow the settings', () => {
  it('running: one stitch per stitch length', () => {
    const pts = sewObject(sample('running', { stitchLength: 2.5 }));
    expect(pts.length).toBe(Math.ceil(W / 2.5) + Math.ceil(H / 2.5) + 1);
    expect(longest(pts)).toBeLessThanOrEqual(2.5 + 1e-9);
  });

  it('satin: needle points every half density along the column', () => {
    for (const density of [0.3, 0.5]) {
      const pts = sewObject(sample('satin', { satinDensity: density, underlayEnabled: false, autoSplit: false, cornerMode: 'none' }));
      const expected = (W + H) / (density / 2);
      expect(pts.length).toBeGreaterThan(0.85 * expected);
      expect(pts.length).toBeLessThan(1.15 * expected);
    }
  });

  it('tatami: rows half the row spacing apart; stitches at most the stitch length (1.25 x at row ends)', () => {
    for (const spacing of [0.4, 0.8]) {
      const pts = sewObject(sample('fill', { fillRowSpacing: spacing, fillAngle: 0, underlayEnabled: false }));
      const rows = new Set(pts.map((p) => Math.round(p[1] * 1000)));
      const expected = H / (spacing / 2);
      expect(rows.size).toBeGreaterThan(0.85 * expected);
      expect(rows.size).toBeLessThan(1.2 * expected);
      // Grid needles within a quarter stitch of a row end are dropped, so end stitches reach 1.25 L.
      expect(longest(pts)).toBeLessThanOrEqual(1.25 * 4 + 1e-6);
    }
  });

  it('zigzag and E stitch: one rung per spacing', () => {
    const zig = sewObject(sample('zigzag', { zigzagSpacing: 2, underlayEnabled: false, cornerMode: 'none' }));
    expect(zig.length).toBeGreaterThan(0.8 * ((W + H) / 1));
    expect(zig.length).toBeLessThan(1.3 * ((W + H) / 1));
    const e = sewObject(sample('e_stitch', { eSpacing: 2.5, underlayEnabled: false, cornerMode: 'none' }));
    expect(e.length / 3).toBeGreaterThan(0.8 * ((W + H) / 2.5));
    expect(e.length / 3).toBeLessThan(1.3 * ((W + H) / 2.5));
  });

  it('underlay adds stitches under satins and fills, and turning it off removes them', () => {
    for (const t of ['satin', 'fill', 'radial_satin', 'satin_fill'] as const) {
      const on = sewObject(sample(t, { underlayEnabled: true, underlayType: 'auto' }));
      const off = sewObject(sample(t, { underlayEnabled: false }));
      expect(on.length).toBeGreaterThan(off.length);
    }
  });
});
