import { describe, expect, it } from 'vitest';
import {
  SHAPE_KINDS,
  STAR_INNER,
  applyAffine,
  compose,
  createDocument,
  createObject,
  mirror,
  naturalAspect,
  pathNode,
  reversedObject,
  rotation,
  scaling,
  skewX,
  standardShape,
  transformObject,
  type Point,
} from '../src/index';

const box = { x0: 0, y0: 0, x1: 20, y1: 10 };
const close = (a: Point, b: Point) => {
  expect(a[0]).toBeCloseTo(b[0], 9);
  expect(a[1]).toBeCloseTo(b[1], 9);
};

describe('standard shapes', () => {
  it('fit every shape inside the box, touching all four sides', () => {
    for (const k of SHAPE_KINDS) {
      const nodes = standardShape(k, box);
      const xs = nodes.map((n) => n.x);
      const ys = nodes.map((n) => n.y);
      expect(Math.min(...xs), k).toBeGreaterThanOrEqual(-1e-9);
      expect(Math.max(...xs), k).toBeLessThanOrEqual(20 + 1e-9);
      expect(Math.min(...ys), k).toBeCloseTo(0, 9);
      expect(Math.max(...ys), k).toBeCloseTo(10, 9);
    }
  });

  it('makes a circle of 12 curve nodes', () => {
    const c = standardShape('circle', { x0: -5, y0: -5, x1: 5, y1: 5 });
    expect(c).toHaveLength(12);
    expect(c.every((n) => n.type === 'curve')).toBe(true);
    for (const n of c) expect(Math.hypot(n.x, n.y)).toBeCloseTo(5, 9);
  });

  it('makes a star with inner radius 0.382 x outer (in its natural proportions)', () => {
    // A box with the star's natural aspect keeps it regular: find its centre and outer radius.
    const h = 20;
    const w = h * naturalAspect('star');
    const st = standardShape('star', { x0: 0, y0: 0, x1: w, y1: h });
    expect(st).toHaveLength(10);
    const top = st[0]!;
    expect(top.y).toBeCloseTo(0, 9); // a point at the top
    const cx = top.x;
    const R = (h / (1 + Math.sin((54 * Math.PI) / 180)));
    const cy = R;
    expect(Math.hypot(st[2]!.x - cx, st[2]!.y - cy)).toBeCloseTo(R, 6);
    expect(Math.hypot(st[1]!.x - cx, st[1]!.y - cy)).toBeCloseTo(R * STAR_INNER, 6);
  });

  it('makes rectangles, diamonds and triangles from corners', () => {
    expect(standardShape('rectangle', box).map((n) => [n.x, n.y])).toEqual([[0, 0], [20, 0], [20, 10], [0, 10]]);
    expect(standardShape('diamond', box).map((n) => [n.x, n.y])).toEqual([[10, 0], [20, 5], [10, 10], [0, 5]]);
    expect(standardShape('triangle', box).every((n) => n.type === 'corner')).toBe(true);
  });
});

describe('affine transforms', () => {
  it('rotate, scale, skew, mirror and compose', () => {
    close(applyAffine(rotation(90), [1, 0]), [0, 1]); // clockwise on screen (y down)
    close(applyAffine(rotation(90, 5, 5), [6, 5]), [5, 6]);
    close(applyAffine(scaling(2, 3, 1, 1), [2, 2]), [3, 4]);
    close(applyAffine(skewX(45, 10), [0, 12]), [-2, 12]); // x' = x - tan(a) (y - anchorY)
    close(applyAffine(mirror(5, 0), [7, 3]), [3, 3]);
    close(applyAffine(compose(rotation(90), scaling(2, 1)), [1, 0]), [0, 2]);
  });

  it('transforms every position of an object, widths by the geometric mean, turning the fill angle', () => {
    const doc = createDocument();
    const o = createObject(doc, {
      stitchType: 'satin',
      points: [pathNode(0, 0, 'corner', 2), pathNode(10, 0)],
      holes: [[pathNode(1, 1), pathNode(2, 1), pathNode(2, 2)]],
      fillStart: [1, 0],
      stitchAngles: [[[0, 0], [1, 1]]],
    });
    o.settings.fillAngle = 0;
    o.settings.satinWidth = 3;
    const t = transformObject(o, scaling(4, 1));
    expect(t.points[1]).toMatchObject({ x: 40, y: 0 });
    expect(t.points[0]!.width).toBeCloseTo(4, 9); // 2 x sqrt(4 x 1)
    expect(t.settings.satinWidth).toBeCloseTo(6, 9);
    expect(t.holes[0]![1]).toMatchObject({ x: 8, y: 1 });
    expect(t.fillStart).toEqual([4, 0]);
    expect(t.stitchAngles[0]![1]).toEqual([4, 1]);
    expect(t.version).toBe(o.version + 1);
    expect(transformObject(o, rotation(30)).settings.fillAngle).toBeCloseTo(30, 9);
    expect(o.points[1]!.x).toBe(10); // the original is untouched
  });

  it('reverses node order for backtracking', () => {
    const o = createObject(createDocument(), { points: [pathNode(0, 0), pathNode(5, 0), pathNode(9, 0)] });
    expect(reversedObject(o).points.map((n) => n.x)).toEqual([9, 5, 0]);
  });
});
