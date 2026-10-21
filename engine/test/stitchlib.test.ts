import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  STITCH_TYPES,
  computeStitches,
  createDocument,
  createObject,
  defaultSettings,
  distance,
  pathNode,
  raisedSatin,
  runningStitch,
  sewnSpacing,
  type Point,
  type RunStyle,
} from '../src/index';

const line: Point[] = [[0, 0], [10, 0]];
const run = (runStyle: RunStyle, path: Point[] = line, stitchLength = 2.5, stemWidth = 1) =>
  runningStitch(path, { stitchLength, runStyle, stemWidth });
const xs = (pts: Point[]) => pts.map((p) => p[0]);

describe('sewnSpacing', () => {
  it('halves the row spacing for tatami and laydown', () => {
    for (const t of ['fill', 'laydown'] as const) {
      const s = sewnSpacing(defaultSettings({ stitchType: t, fillRowSpacing: 0.4 }));
      expect(s.fillRowSpacing).toBe(0.2);
      expect(s.satinDensity).toBe(DEFAULT_SETTINGS.satinDensity);
    }
  });

  it('halves satin density and graded end density for satin, two-rail satin and satin fill', () => {
    for (const t of ['satin', 'radial_satin', 'satin_fill'] as const) {
      const s = sewnSpacing(defaultSettings({ stitchType: t, satinDensity: 0.4, gradedEndDensity: 1.2 }));
      expect(s.satinDensity).toBe(0.2);
      expect(s.gradedEndDensity).toBe(0.6);
      expect(s.fillRowSpacing).toBe(DEFAULT_SETTINGS.fillRowSpacing);
    }
  });

  it('leaves every other type and the input alone', () => {
    const halved = ['fill', 'laydown', 'satin', 'radial_satin', 'satin_fill'];
    for (const t of STITCH_TYPES.filter((t) => !halved.includes(t))) {
      const s = defaultSettings({ stitchType: t });
      expect(sewnSpacing(s)).toEqual(s);
    }
    const input = defaultSettings({ stitchType: 'fill' });
    sewnSpacing(input);
    expect(input.fillRowSpacing).toBe(DEFAULT_SETTINGS.fillRowSpacing);
  });
});

describe('running stitch styles', () => {
  it('single: resampled every stitch length', () => {
    expect(run('single')).toEqual([[0, 0], [2.5, 0], [5, 0], [7.5, 0], [10, 0]]);
  });

  it('triple: start, then forward, back, forward for each stitch', () => {
    expect(xs(run('triple', [[0, 0], [5, 0]]))).toEqual([0, 2.5, 0, 2.5, 5, 2.5, 5]);
  });

  it('sculpture: odd stitches triple, even stitches single', () => {
    expect(xs(run('sculpture'))).toEqual([0, 2.5, 0, 2.5, 5, 7.5, 5, 7.5, 10]);
  });

  it('backstitch: first point, then point i and i - 1 for i >= 2, then the last point', () => {
    expect(xs(run('backstitch'))).toEqual([0, 5, 2.5, 7.5, 5, 10, 7.5, 10]);
    expect(xs(run('backstitch', [[0, 0], [2, 0]]))).toEqual([0, 2]);
  });

  it('stemstitch: a rope of overlapping slanted stitches', () => {
    const pts = run('stemstitch', [[0, 0], [10, 0]], 4, 2);
    // d = 0, 2, 4, 6 (d + 4 <= 10): left of d, then right of d + 4. Left is up on screen.
    expect(pts).toHaveLength(8);
    const expected: Point[] = [[0, -1], [4, 1], [2, -1], [6, 1], [4, -1], [8, 1], [6, -1], [10, 1]];
    pts.forEach((p, i) => {
      expect(p[0]).toBeCloseTo(expected[i]![0], 9);
      expect(p[1]).toBeCloseTo(expected[i]![1], 9);
    });
  });

  it('stemstitch: clamps the length and width', () => {
    const pts = run('stemstitch', [[0, 0], [1, 0]], 0.1, 0);
    // len = 0.5, half = 0.1: d = 0, 0.25, 0.5.
    expect(pts).toHaveLength(6);
    expect(pts[0]![1]).toBeCloseTo(-0.1, 9);
    expect(pts[1]![0]).toBeCloseTo(0.5, 9);
  });

  it('stemstitch: follows bends with normals from 0.1 mm either side', () => {
    const pts = run('stemstitch', [[0, 0], [0, 10]], 4, 2); // walking down the screen: left is +x
    expect(pts[0]![0]).toBeCloseTo(1, 9);
    expect(pts[1]![0]).toBeCloseTo(-1, 9);
  });

  it('stemstitch: a path shorter than one stitch is a plain run', () => {
    expect(run('stemstitch', [[0, 0], [0.3, 0]], 4, 2)).toEqual([[0, 0], [0.3, 0]]);
  });

  it('keeps triple stitches on the path', () => {
    const pts = run('triple', [[0, 0], [5, 0], [5, 5]]);
    for (let i = 1; i < pts.length; i++) expect(distance(pts[i - 1]!, pts[i]!)).toBeLessThanOrEqual(2.5 + 1e-9);
  });
});

describe('raised satin', () => {
  it('sews narrower, sparser layers first, then the normal satin', () => {
    const calls: [number, number][] = [];
    raisedSatin(3, (w, s) => {
      calls.push([w, s]);
      return [];
    });
    expect(calls.map(([w, s]) => [Number(w.toFixed(10)), s])).toEqual([
      [0.7, 2],
      [0.85, 2],
      [1, 1],
    ]);
  });

  it('is just the normal satin with one layer', () => {
    expect(raisedSatin(1, (w, s) => [[w, s]])).toEqual([[1, 1]]);
  });
});

describe('running objects', () => {
  it('sew through computeStitches', () => {
    const doc = createDocument();
    const o = createObject(doc, { points: [pathNode(0, 0), pathNode(6, 0)] });
    expect(computeStitches(o)).toEqual([[0, 0], [3, 0], [6, 0]]);
  });
});
