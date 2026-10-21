import { describe, expect, it } from 'vitest';
import {
  angleOfLine,
  chainLines,
  computeStitches,
  createDocument,
  createObject,
  defaultSettings,
  distance,
  fillWithAngles,
  fromLocal,
  generateTopStitching,
  pathNode,
  pointInRegion,
  polygonFromRings,
  rowLine,
  sewnSpacing,
  tatamiLayer,
  tatamiParams,
  toLocal,
  turningFrame,
  turningTatami,
  type AngleLine,
  type Point,
} from '../src/index';

const rect = (x0: number, y0: number, x1: number, y1: number): Point[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const square = polygonFromRings(rect(0, 0, 20, 20));
const params = (o = {}) => tatamiParams(sewnSpacing(defaultSettings({ stitchType: 'fill', ...o })));
const close = (a: Point, b: Point, digits = 6) => {
  expect(a[0]).toBeCloseTo(b[0], digits);
  expect(a[1]).toBeCloseTo(b[1], digits);
};
/** Direction of the stitches near a point: the longest stitch whose midpoint is within r. */
const rowDirectionNear = (pts: Point[], q: Point, r = 1.5) => {
  let best: [number, Point] = [0, [0, 0]];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const m: Point = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const len = distance(a, b);
    if (distance(m, q) < r && len > best[0] && len < 5) best = [len, [(b[0] - a[0]) / len, (b[1] - a[1]) / len]];
  }
  return best[1];
};

describe('chaining angle lines', () => {
  it('starts with the line farthest from the others and walks nearest neighbours', () => {
    const lines: AngleLine[] = [
      [[10, 0], [10, 10]],
      [[0, 0], [0, 10]],
      [[20, 10], [20, 0]], // drawn the other way
      [[5, 0], [5, 10]],
    ];
    const chain = chainLines(lines);
    expect(chain.map((l) => l[0][0])).toEqual([20, 10, 5, 0]);
    // Every line now points the same way as its neighbour.
    for (let i = 1; i < chain.length; i++) {
      const a = chain[i - 1]!;
      const b = chain[i]!;
      expect((a[1][1] - a[0][1]) * (b[1][1] - b[0][1])).toBeGreaterThan(0);
    }
  });
});

describe('the straightened frame', () => {
  const lines: AngleLine[] = [
    [[0, -5], [0, 25]],
    [[20, -5], [30, 25]],
  ];

  it('puts max(1, round(largest end gap / spacing)) rows between lines', () => {
    const f = turningFrame(lines, 0.5)!;
    expect(f.rows).toEqual([0, 60]); // the ends are 20 and 30 mm apart: round(30 / 0.5)
  });

  it('interpolates row lines and steps away in parallel beyond the ends', () => {
    const f = turningFrame([[[0, 0], [0, 10]], [[10, 0], [10, 10]]], 1)!;
    expect(f.rows).toEqual([0, 10]);
    expect(rowLine(f, 5)).toEqual([[5, 0], [5, 10]]);
    const before = rowLine(f, -2);
    close(before[0], [-2, 0]);
    close(before[1], [-2, 10]);
    const after = rowLine(f, 13);
    close(after[0], [13, 0]);
  });

  it('maps points to the frame and back', () => {
    const f = turningFrame(lines, 0.2)!;
    for (const p of [[1, 1], [10, 10], [19, 3], [5, 18], [-3, 7], [26, 20]] as Point[]) {
      const q = toLocal(f, p, -200, 400)!;
      expect(q).not.toBeNull();
      close(fromLocal(f, q), p, 5);
    }
  });

  it('gives up when there is no sign change', () => {
    const f = turningFrame([[[0, 0], [0, 10]], [[10, 0], [10, 10]]], 1)!;
    expect(toLocal(f, [5, 5], 7, 9)).toBeNull();
  });
});

describe('turning tatami', () => {
  it('uses a single line as the fill angle', () => {
    const one: AngleLine[] = [[[0, 0], [10, 10]]];
    expect(angleOfLine(one[0]!)).toBeCloseTo(45, 9);
    expect(fillWithAngles(square, one, params())).toEqual(tatamiLayer(square, { ...params(), angle: 45 }));
  });

  it('turns the rows from one line to the next', () => {
    // Rows run vertically at the left and at 45 degrees through the right side.
    const lines: AngleLine[] = [
      [[0, -2], [0, 22]],
      [[10, 0], [30, 20]],
    ];
    const pts = turningTatami(square, lines, params())!;
    expect(pts).not.toBeNull();
    expect(pts.length).toBeGreaterThan(500);
    const left = rowDirectionNear(pts, [1.5, 10]);
    expect(Math.abs(left[0])).toBeLessThan(0.15); // nearly vertical
    const right = rowDirectionNear(pts, [18.5, 10]);
    expect(Math.abs(Math.abs(right[0]) - Math.SQRT1_2)).toBeLessThan(0.15); // nearly diagonal
    for (const p of pts) expect(pointInRegion(square, p, 0.3)).not.toBe('outside');
  });

  it('gives up (and fill angle is used) when the lines cross inside the shape', () => {
    const crossing: AngleLine[] = [
      [[0, 0], [20, 20]],
      [[0, 20], [20, 0]],
    ];
    expect(turningTatami(square, crossing, params())).toBeNull();
    expect(fillWithAngles(square, crossing, params({ fillAngle: 30 }))).toEqual(tatamiLayer(square, { ...params({ fillAngle: 30 }) }));
  });

  it('sews fill objects with stitch angle lines', () => {
    const doc = createDocument();
    const o = createObject(doc, {
      stitchType: 'fill',
      closed: true,
      points: rect(0, 0, 20, 20).map(([x, y]) => pathNode(x, y)),
      stitchAngles: [
        [[0, -2], [0, 22]],
        [[20, 0], [32, 12]],
      ],
    });
    expect(generateTopStitching(o, [])).toEqual(turningTatami(square, o.stitchAngles, params()));
    expect(computeStitches(o).length).toBeGreaterThan(generateTopStitching(o, []).length); // plus underlay
  });
});
