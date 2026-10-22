import { describe, expect, it } from 'vitest';
import {
  cumulativeLengths,
  distance,
  distanceToPolyline,
  douglasPeucker,
  findCorners,
  flattenArc,
  flattenBezier,
  floorMod,
  materializeDetailed,
  materializePath,
  materializeSegments,
  materializeWidths,
  pathNode,
  pointAt,
  polylineLength,
  resampleKeepingCorners,
  resamplePolyline,
  resampleWithValues,
  restartRing,
  roundHalfEven,
  smoothPath,
  trimEnds,
  type PathNode,
  type Point,
} from '../src/index';

const close = (a: Point, b: Point, digits = 9) => {
  expect(a[0]).toBeCloseTo(b[0], digits);
  expect(a[1]).toBeCloseTo(b[1], digits);
};
const closeAll = (a: Point[], b: Point[], digits = 9) => {
  expect(a).toHaveLength(b.length);
  a.forEach((p, i) => close(p, b[i]!, digits));
};
const gaps = (pts: Point[]) => pts.slice(1).map((p, i) => distance(pts[i]!, p));
const deviation = (a: Point[], b: Point[]) =>
  Math.max(...a.map((p) => distanceToPolyline(p, b)), ...b.map((p) => distanceToPolyline(p, a)));
const corner = (x: number, y: number, w: number | null = null) => pathNode(x, y, 'corner', w);
const curve = (x: number, y: number, w: number | null = null) => pathNode(x, y, 'curve', w);

describe('Python-compatible helpers', () => {
  it('rounds half to even', () => {
    expect([0.5, 1.5, 2.5, 3.5, -0.5, -1.5, -2.5].map((x) => roundHalfEven(x) + 0)).toEqual([0, 2, 2, 4, 0, -2, -2]);
    expect([2.4, 2.6, -2.4, -2.6, 7].map(roundHalfEven)).toEqual([2, 3, -2, -3, 7]);
  });

  it('takes the floored modulo (sign of the divisor)', () => {
    expect(floorMod(-1, 3)).toBe(2);
    expect(floorMod(5, 3)).toBe(2);
    expect(floorMod(1, -3)).toBe(-2);
    expect(floorMod(-7, -3)).toBe(-1);
    expect(floorMod(5.5, 2)).toBe(1.5);
    expect(floorMod(-0.5, 1)).toBe(0.5);
    expect(floorMod(6, 3)).toBe(0);
  });
});

describe('lengths and positions', () => {
  const path: Point[] = [[0, 0], [3, 4], [3, 10]];

  it('accumulates lengths', () => {
    expect(cumulativeLengths(path)).toEqual([0, 5, 11]);
    expect(polylineLength(path)).toBe(11);
    expect(cumulativeLengths([])).toEqual([]);
  });

  it('finds the point at a distance, clamped to the ends', () => {
    expect(pointAt(path, 8)).toEqual([3, 7]);
    expect(pointAt(path, 2.5)).toEqual([1.5, 2]);
    expect(pointAt(path, -1)).toEqual([0, 0]);
    expect(pointAt(path, 99)).toEqual([3, 10]);
    expect(pointAt([[1, 1]], 5)).toEqual([1, 1]);
  });
});

describe('resampling', () => {
  const line: Point[] = [[0, 0], [10, 0]];

  it('steps a fixed spacing from the start and always keeps the end', () => {
    expect(resamplePolyline(line, 3)).toEqual([[0, 0], [3, 0], [6, 0], [9, 0], [10, 0]]);
    expect(resamplePolyline(line, 5)).toEqual([[0, 0], [5, 0], [10, 0]]);
    expect(resamplePolyline([[0, 0], [0, 4], [3, 4]], 2)).toEqual([[0, 0], [0, 2], [0, 4], [2, 4], [3, 4]]);
  });

  it('accepts a spacing function of position', () => {
    const pts = resamplePolyline(line, (d) => (d < 5 ? 1 : 2.5));
    expect(pts.map((p) => p[0])).toEqual([0, 1, 2, 3, 4, 5, 7.5, 10]);
  });

  it('carries values along by linear interpolation', () => {
    const r = resampleWithValues(line, [2, 4], 2.5);
    expect(r.points.map((p) => p[0])).toEqual([0, 2.5, 5, 7.5, 10]);
    expect(r.values).toEqual([2, 2.5, 3, 3.5, 4]);
    const bent = resampleWithValues([[0, 0], [4, 0], [4, 4]], [0, 4, 0], 2);
    expect(bent.values).toEqual([0, 2, 4, 2, 0]);
  });

  it('puts a needle point on every sharp corner', () => {
    const l: Point[] = [[0, 0], [5, 0], [5, 5]];
    expect(resamplePolyline(l, 2)).not.toContainEqual([5, 0]);
    const pts = resampleKeepingCorners(l, 2);
    closeAll(pts, [[0, 0], [5 / 3, 0], [10 / 3, 0], [5, 0], [5, 5 / 3], [5, 10 / 3], [5, 5]]);
  });

  it('keeps given corners only', () => {
    const l: Point[] = [[0, 0], [5, 0], [5, 5], [0, 5]];
    const pts = resampleKeepingCorners(l, 10, { corners: [2] });
    expect(pts).toEqual([[0, 0], [5, 5], [0, 5]]);
  });
});

describe('findCorners', () => {
  it('finds sharp turns of an open line, never its ends', () => {
    expect(findCorners([[0, 0], [10, 0], [10, 10], [0, 10]])).toEqual([1, 2]);
  });

  it('includes the seam of a closed ring', () => {
    expect(findCorners([[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]], { closed: true })).toEqual([0, 1, 2, 3]);
  });

  it('ignores gentle turns and respects the angle limit', () => {
    const gentle: Point[] = [[0, 0], [10, 0], [20, 1]];
    expect(findCorners(gentle)).toEqual([]);
    const right: Point[] = [[0, 0], [10, 0], [10, 10]];
    expect(findCorners(right, { angleBelowDeg: 90 })).toEqual([]);
    expect(findCorners(right, { angleBelowDeg: 91 })).toEqual([1]);
  });

  it('counts a repeated point once and only checks candidates', () => {
    expect(findCorners([[0, 0], [10, 0], [10, 0], [10, 10]])).toEqual([1]);
    expect(findCorners([[0, 0], [10, 0], [10, 10], [0, 10]], { candidates: [2] })).toEqual([2]);
  });
});

describe('restartRing and trimEnds', () => {
  const ring: Point[] = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]];

  it('restarts a ring at the nearest point, inserting it between vertices', () => {
    expect(restartRing(ring, [12, 5])).toEqual([[10, 5], [10, 10], [0, 10], [0, 0], [10, 0], [10, 5]]);
  });

  it('restarts a ring at a vertex when that is nearest', () => {
    expect(restartRing(ring, [11, -1])).toEqual([[10, 0], [10, 10], [0, 10], [0, 0], [10, 0]]);
    expect(restartRing(ring, [-1, -1])).toEqual(ring);
  });

  it('shortens ends', () => {
    expect(trimEnds([[0, 0], [10, 0]], 2, 3)).toEqual([[2, 0], [7, 0]]);
    expect(trimEnds([[0, 0], [5, 0], [5, 5]], 6, 1)).toEqual([[5, 1], [5, 4]]);
  });

  it('extends ends straight on', () => {
    expect(trimEnds([[0, 0], [10, 0]], -1, -2)).toEqual([[-1, 0], [0, 0], [10, 0], [12, 0]]);
    expect(trimEnds([[0, 0], [5, 0], [5, 5]], 1, -1)).toEqual([[1, 0], [5, 0], [5, 5], [5, 6]]);
  });

  it('leaves one point when shortened past its length', () => {
    expect(trimEnds([[0, 0], [10, 0]], 8, 8)).toEqual([[5, 0]]);
  });
});

describe('douglasPeucker', () => {
  it('drops points within tolerance and keeps the ends', () => {
    const pts: Point[] = [[0, 0], [1, 0.05], [2, 0], [3, 1], [4, 0]];
    expect(douglasPeucker(pts, 0.1)).toEqual([[0, 0], [2, 0], [3, 1], [4, 0]]);
    expect(douglasPeucker(pts, 2)).toEqual([[0, 0], [4, 0]]);
    expect(douglasPeucker(pts, 0)).toEqual(pts);
    expect(douglasPeucker([[0, 0], [1, 1]], 5)).toEqual([[0, 0], [1, 1]]);
  });
});

describe('flattenBezier', () => {
  it('flattens an evenly spaced straight cubic exactly', () => {
    closeAll(flattenBezier([[0, 0], [1, 0], [2, 0], [3, 0]], 1), [[0, 0], [1, 0], [2, 0], [3, 0]]);
  });

  it('spaces quadratic and cubic curves evenly by arc length, at most the resolution', () => {
    const q = flattenBezier([[0, 0], [5, 10], [10, 0]], 0.4);
    const c = flattenBezier([[0, 0], [0, 10], [10, 10], [10, 0]], 0.4);
    for (const pts of [q, c]) {
      const g = gaps(pts);
      expect(Math.max(...g)).toBeLessThanOrEqual(0.4 + 1e-6);
      expect(Math.max(...g) - Math.min(...g)).toBeLessThan(0.01);
    }
    expect(q[0]).toEqual([0, 0]);
    expect(q[q.length - 1]).toEqual([10, 0]);
    close(pointAt(q, polylineLength(q) / 2), [5, 5], 1);
  });

  it('rejects other control point counts', () => {
    expect(() => flattenBezier([[0, 0], [1, 1]])).toThrow();
  });
});

describe('flattenArc', () => {
  const onCircle = (pts: Point[], c: Point, r: number) => pts.forEach((p) => expect(distance(p, c)).toBeCloseTo(r, 9));

  it('draws a semicircle above (sweep) or below (no sweep) the chord, y down', () => {
    const up = flattenArc([0, 0], 5, 5, 0, false, true, [10, 0], 0.4);
    onCircle(up, [5, 0], 5);
    expect(up).toHaveLength(Math.ceil((Math.PI * 5) / 0.4) + 1);
    expect(Math.min(...up.map((p) => p[1]))).toBeCloseTo(-5, 3);
    const down = flattenArc([0, 0], 5, 5, 0, false, false, [10, 0], 0.4);
    expect(Math.max(...down.map((p) => p[1]))).toBeCloseTo(5, 3);
    expect(up[0]).toEqual([0, 0]);
    expect(up[up.length - 1]).toEqual([10, 0]);
  });

  it('scales radii that are too small (radius correction)', () => {
    onCircle(flattenArc([0, 0], 1, 1, 0, false, true, [10, 0]), [5, 0], 5);
  });

  it('picks the large or small arc', () => {
    // r = 10 through (0,0) and (10,0): centre (5, +-8.660...).
    const small = flattenArc([0, 0], 10, 10, 0, false, true, [10, 0]);
    const large = flattenArc([0, 0], 10, 10, 0, true, true, [10, 0]);
    const theta = 2 * Math.asin(0.5);
    expect(polylineLength(small)).toBeCloseTo(10 * theta, 2);
    expect(polylineLength(large)).toBeCloseTo(10 * (2 * Math.PI - theta), 2);
    onCircle(small, [5, Math.sqrt(75)], 10);
    onCircle(large, [5, -Math.sqrt(75)], 10);
  });

  it('handles rotated ellipses and degenerate arcs', () => {
    // Ellipse rx 10, ry 5 rotated 90 degrees: from its top to its bottom through x = +-5.
    const half = flattenArc([0, -10], 10, 5, 90, false, true, [0, 10]);
    half.forEach(([x, y]) => expect((y / 10) ** 2 + (x / 5) ** 2).toBeCloseTo(1, 9));
    expect(Math.max(...half.map((p) => p[0]))).toBeCloseTo(5, 2);
    expect(flattenArc([1, 1], 0, 5, 0, false, true, [4, 5])).toEqual([[1, 1], [4, 5]]);
    expect(flattenArc([1, 1], 5, 5, 0, false, true, [1, 1])).toEqual([[1, 1]]);
  });
});

describe('materializePath', () => {
  it('keeps straight lines between corner nodes', () => {
    const nodes = [corner(0, 0), corner(10, 0), corner(10, 10)];
    expect(materializePath(nodes, false)).toEqual([[0, 0], [10, 0], [10, 10]]);
    expect(materializePath(nodes, true)).toEqual([[0, 0], [10, 0], [10, 10], [0, 0]]);
    expect(materializePath([corner(1, 2)], false)).toEqual([[1, 2]]);
    expect(materializePath([], false)).toEqual([]);
  });

  it('makes a circle from four (or more) evenly spaced curve nodes', () => {
    const r = 10;
    const four = [pathNode(r, 0, 'curve'), pathNode(0, r, 'curve'), pathNode(-r, 0, 'curve'), pathNode(0, -r, 'curve')];
    const circle = materializePath(four, true, 0.1);
    for (const p of circle) expect(Math.hypot(p[0], p[1])).toBeCloseTo(r, 2); // within 0.005 mm
    // Six, eight: still a circle.
    for (const k of [6, 8]) {
      const ring = Array.from({ length: k }, (_, i) => pathNode(r * Math.cos((2 * Math.PI * i) / k), r * Math.sin((2 * Math.PI * i) / k), 'curve'));
      for (const p of materializePath(ring, true, 0.1)) expect(Math.abs(Math.hypot(p[0], p[1]) - r)).toBeLessThan(0.003);
    }
    // Corners stay corners: two corners are a straight line.
    expect(materializePath([pathNode(0, 0), pathNode(10, 0)], false)).toEqual([[0, 0], [10, 0]]);
  });

  it('curves through a curve node with a Catmull-Rom tangent', () => {
    const pts = materializePath([corner(0, 0), curve(5, 5), corner(10, 0)], false);
    expect(pts).toContainEqual([5, 5]);
    expect(Math.max(...pts.map((p) => p[1]))).toBeCloseTo(5, 9); // tangent at the curve node is horizontal
    expect(Math.max(...gaps(pts))).toBeLessThanOrEqual(0.4 + 1e-6);
    // Symmetric about x = 5.
    const n = pts.length;
    pts.forEach((p, i) => close(p, [10 - pts[n - 1 - i]![0], pts[n - 1 - i]![1]], 6));
  });

  it('keeps corner nodes sharp: a curve leaves a corner along its chord', () => {
    const pts = materializePath([corner(0, 0), corner(10, 0), curve(10, 10), corner(0, 20)], false);
    const k = pts.findIndex((p) => p[0] === 10 && p[1] === 0);
    const next = pts[k + 1]!;
    // Chord from (10,0) to (10,10) is straight down; the first step follows it (no hook).
    expect(Math.abs(next[0] - 10)).toBeLessThan(0.02);
    expect(next[1]).toBeGreaterThan(0);
  });

  it('never loops past its end points or far outside its nodes', () => {
    const layouts = [
      [corner(5, 60), curve(25, 20), curve(40, 75), curve(48, 30), curve(90, 55), corner(95, 20)],
      [corner(5, 50), curve(30, 50), curve(34, 46), curve(36, 40), curve(90, 15), corner(95, 90)],
      [corner(70, 10), curve(30, 18), curve(25, 45), curve(70, 55), curve(75, 82), corner(20, 90)],
      [corner(10, 80), curve(50, 15), corner(90, 80)],
    ];
    for (const nodes of layouts) {
      const xs = nodes.map((n) => n.x);
      const ys = nodes.map((n) => n.y);
      for (const [x, y] of materializePath(nodes, false)) {
        expect(x).toBeGreaterThan(Math.min(...xs) - 8);
        expect(x).toBeLessThan(Math.max(...xs) + 8);
        expect(y).toBeGreaterThan(Math.min(...ys) - 8);
        expect(y).toBeLessThan(Math.max(...ys) + 8);
      }
    }
  });

  it('closes curved paths smoothly through every node', () => {
    const nodes = [curve(10, 0), curve(0, 10), curve(-10, 0), curve(0, -10)];
    const pts = materializePath(nodes, true);
    expect(pts[0]).toEqual(pts[pts.length - 1]);
    for (const nd of nodes) expect(pts).toContainEqual([nd.x, nd.y]);
    pts.forEach((p) => expect(Math.hypot(p[0], p[1])).toBeGreaterThan(9.3));
  });

  it('gives one dense piece per segment', () => {
    const nodes = [corner(0, 0), curve(5, 5), corner(10, 0)];
    expect(materializeSegments(nodes, false)).toHaveLength(2);
    const closed = materializeSegments(nodes, true);
    expect(closed).toHaveLength(3);
    expect(closed[2]).toEqual([[10, 0], [0, 0]]);
    expect(closed[0]![0]).toEqual([0, 0]);
    expect(closed[0]![closed[0]!.length - 1]).toEqual([5, 5]);
  });

  it('reports where each node landed', () => {
    const d = materializeDetailed([corner(0, 0), curve(5, 5), corner(10, 0)], false);
    expect(d.nodeIndex).toHaveLength(3);
    expect(d.points[d.nodeIndex[1]!]).toEqual([5, 5]);
    expect(d.nodeIndex[2]).toBe(d.points.length - 1);
  });
});

describe('materializeWidths', () => {
  it('interpolates node widths by arc length, defaulting null widths', () => {
    expect(materializeWidths([corner(0, 0, 2), corner(10, 0, 4)], false, 3)).toEqual([2, 4]);
    expect(materializeWidths([corner(0, 0), corner(10, 0, 4)], false, 3)).toEqual([3, 4]);
    const nodes = [curve(0, 0, 2), curve(10, 0, 4)]; // a straight curve segment, so dense
    const pts = materializePath(nodes, false);
    const w = materializeWidths(nodes, false, 3);
    expect(w).toHaveLength(pts.length);
    expect(pts.length).toBeGreaterThan(20);
    pts.forEach((p, i) => expect(w[i]).toBeCloseTo(2 + 0.2 * p[0], 6));
  });
});

describe('smoothPath', () => {
  const arcNodes = (count: number): PathNode[] =>
    Array.from({ length: count }, (_, i) => {
      const x = (20 * i) / (count - 1);
      return pathNode(x, 0.02 * (x - 10) ** 2, i === 0 || i === count - 1 ? 'corner' : 'curve', 2 + x / 10);
    });

  it('uses fewer nodes and stays within precision', () => {
    const nodes = arcNodes(21);
    const out = smoothPath(nodes, false, 0.1);
    expect(out.length).toBeLessThanOrEqual(5);
    expect(out[0]).toBe(nodes[0]);
    expect(out[out.length - 1]).toBe(nodes[20]);
    expect(out.slice(1, -1).every((n) => n.type === 'curve')).toBe(true);
    expect(deviation(materializePath(out, false, 0.1), materializePath(nodes, false, 0.1))).toBeLessThanOrEqual(0.1);
  });

  it('carries widths over', () => {
    const out = smoothPath(arcNodes(21), false, 0.1);
    for (const n of out) expect(n.width).toBeCloseTo(2 + n.x / 10, 2);
  });

  it('keeps every corner node', () => {
    const nodes = [corner(0, 0), curve(2, 1), curve(4, 1.5), curve(6, 1), corner(8, 0), curve(10, -1), curve(12, -1.2), corner(16, 0)];
    const out = smoothPath(nodes, false, 0.2);
    for (const c of nodes.filter((n) => n.type === 'corner')) expect(out).toContain(c);
    expect(out.length).toBeLessThan(nodes.length);
  });

  it('smooths a closed loop with no corners', () => {
    const nodes = Array.from({ length: 24 }, (_, i) => {
      const a = (2 * Math.PI * i) / 24;
      return curve(10 * Math.cos(a), 10 * Math.sin(a));
    });
    const out = smoothPath(nodes, true, 0.2);
    expect(out.length).toBeLessThanOrEqual(8);
    expect(out[0]).toBe(nodes[0]);
    expect(deviation(materializePath(out, true, 0.1), materializePath(nodes, true, 0.1))).toBeLessThanOrEqual(0.2);
  });

  it('returns the input unchanged when nothing is saved', () => {
    const nodes = [corner(0, 0), curve(5, 5), corner(10, 0)];
    expect(smoothPath(nodes, false, 0.01)).toBe(nodes);
    const square = [corner(0, 0), corner(10, 0), corner(10, 10), corner(0, 10)];
    expect(smoothPath(square, true, 1)).toBe(square);
  });
});
