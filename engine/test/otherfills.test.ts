import { describe, expect, it } from 'vitest';
import {
  BUILTIN_MOTIFS,
  JUMP_MARK,
  chaikin,
  computeStitches,
  contourFill,
  generateTopStitching,
  createDocument,
  createObject,
  crossStitchFill,
  defaultSettings,
  distance,
  findMotif,
  laydown,
  motifFill,
  motifLine,
  mulberry32,
  mulberry32Stream,
  pathNode,
  pointInRegion,
  polygonFromRings,
  radialFill,
  sewnSpacing,
  stippleFill,
  unionAll,
  type Point,
  type Region,
  type StitchSettings,
  type StitchType,
} from '../src/index';

const rect = (x0: number, y0: number, x1: number, y1: number): Point[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const square = polygonFromRings(rect(0, 0, 10, 10));
const settings = (stitchType: StitchType, o: Partial<StitchSettings> = {}) => sewnSpacing(defaultSettings({ stitchType, ...o }));
const inside = (pts: Point[], region: Region, tol = 1e-6) => pts.every((p) => pointInRegion(region, p, tol) !== 'outside');
const round = (pts: Point[]) => pts.map((p) => [Number(p[0].toFixed(6)), Number(p[1].toFixed(6))]);
const objectOf = (stitchType: StitchType, ring: Point[], o: Partial<StitchSettings> = {}) => {
  const obj = createObject(createDocument(), { stitchType, closed: true, points: ring.map(([x, y]) => pathNode(x, y)) });
  Object.assign(obj.settings, o);
  return obj;
};

describe('satin fill', () => {
  it('sews only row ends at the satin density, splitting long stitches', () => {
    const pts = generateTopStitching(objectOf('satin_fill', rect(0, 0, 10, 10)), []);
    const rows = new Set(pts.map((p) => p[1].toFixed(4)));
    expect(rows.size).toBe(50); // 0.4 forward density halved
    for (let i = 1; i < pts.length; i++) expect(distance(pts[i - 1]!, pts[i]!)).toBeLessThanOrEqual(7 + 1e-9);
    // Each 10.4 mm row stitch gets one split point; nothing else lies between the ends.
    const middles = pts.filter((p) => p[0] > 0.5 && p[0] < 9.5);
    expect(middles.length).toBe(50);
  });

  it('turns with stitch angle lines like tatami', () => {
    const plain = computeStitches(objectOf('satin_fill', rect(0, 0, 20, 20)));
    const o = objectOf('satin_fill', rect(0, 0, 20, 20));
    o.stitchAngles = [
      [[0, -2], [0, 22]],
      [[10, 0], [30, 20]],
    ];
    const turned = computeStitches(o);
    expect(turned).not.toEqual(plain);
    expect(inside(turned, polygonFromRings(rect(0, 0, 20, 20)), 0.3)).toBe(true);
  });
});

describe('radial fill', () => {
  const s = settings('outline', { outlineSpacing: 0.6, outlineStitchLength: 2.5 });

  it('sews rings inset step by step from the outline inwards', () => {
    const pts = radialFill(square, s);
    expect(inside(pts, square)).toBe(true);
    const edge = (p: Point) => Math.min(p[0], p[1], 10 - p[0], 10 - p[1]);
    expect(edge(pts[0]!)).toBeCloseTo(0, 9);
    expect(edge(pts[pts.length - 1]!)).toBeGreaterThan(3.5);
    // Inset distance only grows along the way (allowing for stitches cutting corners).
    let deepest = 0;
    for (const p of pts) {
      expect(edge(p)).toBeGreaterThan(deepest - 0.7);
      deepest = Math.max(deepest, edge(p));
    }
  });

  it('ripples outward: the same rings sewn from the centre out', () => {
    const out = radialFill(square, { ...s, rippleOutward: true });
    expect(out).toEqual([...radialFill(square, s)].reverse());
  });

  it('finishes each pinched piece before moving on', () => {
    const dumbbell = unionAll([polygonFromRings(rect(0, 0, 10, 10)), polygonFromRings(rect(9, 4.5, 15, 5.5)), polygonFromRings(rect(14, 0, 24, 10))]);
    const pts = radialFill(dumbbell, s);
    // Only the inner rings (the outline itself goes round both lobes before the neck pinches off).
    const side = (p: Point) => (Math.min(p[1], 10 - p[1]) < 1.5 ? 'edge' : p[0] > 1 && p[0] < 8.5 ? 'A' : p[0] > 15.5 && p[0] < 23 ? 'B' : 'other');
    const deep = pts.map(side).filter((x) => x === 'A' || x === 'B');
    let switches = 0;
    for (let i = 1; i < deep.length; i++) if (deep[i] !== deep[i - 1]) switches++;
    expect(switches).toBe(1);
  });

  it('sews the rings round holes last', () => {
    const donut = polygonFromRings(rect(0, 0, 12, 12), [rect(4, 4, 8, 8)]);
    const pts = radialFill(donut, s);
    expect(inside(pts, donut)).toBe(true);
    const onHole = (p: Point) => p[0] >= 4 - 1e-6 && p[0] <= 8 + 1e-6 && p[1] >= 4 - 1e-6 && p[1] <= 8 + 1e-6 && (Math.abs(p[0] - 4) < 1e-6 || Math.abs(p[0] - 8) < 1e-6 || Math.abs(p[1] - 4) < 1e-6 || Math.abs(p[1] - 8) < 1e-6);
    const first = pts.findIndex(onHole);
    expect(first).toBeGreaterThan(pts.length / 2);
  });
});

describe('contour', () => {
  const s = settings('contour', { fillRowSpacing: 0.5, fillStitchLength: 2 });
  const strip = polygonFromRings(rect(0, 0, 20, 10));

  it('runs rows between the two sides, from extreme to extreme along the fill angle', () => {
    const pts = contourFill(strip, s);
    expect(pts[0]![0]).toBeCloseTo(0, 6);
    expect(pts[0]![1]).toBeCloseTo(5, 6); // the middle of the flat left end
    expect(inside(pts, strip)).toBe(true);
    // 10 mm widest gap / 0.5 = 20 rows -> 21 lines, alternating direction.
    let turns = 0;
    for (let i = 1; i < pts.length; i++) if (Math.abs(pts[i]![0] - 0) < 1e-6 || Math.abs(pts[i]![0] - 20) < 1e-6) turns++;
    expect(turns).toBeGreaterThanOrEqual(20);
    for (let i = 1; i < pts.length; i++) expect(distance(pts[i - 1]!, pts[i]!)).toBeLessThanOrEqual(2 + 1e-6);
  });
});

describe('stipple', () => {
  it('walks a random maze, the same every time', () => {
    const big = polygonFromRings(rect(0, 0, 20, 20));
    const s = settings('stipple', { stippleSpacing: 2.5, stitchLength: 2 });
    const a = stippleFill(big, s);
    expect(a).toEqual(stippleFill(big, s));
    expect(a.length).toBeGreaterThan(100);
    expect(inside(a, big)).toBe(true);
    for (let i = 1; i < a.length; i++) expect(distance(a[i - 1]!, a[i]!)).toBeLessThanOrEqual(2 + 1e-6);
  });

  it('smooths with Chaikin corner cutting and uses mulberry32 seed 7', () => {
    expect(chaikin([[0, 0], [4, 0], [4, 4]])).toEqual([[0, 0], [1, 0], [3, 0], [4, 1], [4, 3], [4, 4]]);
    expect(chaikin([[0, 0], [4, 0], [4, 4]], 3)).toHaveLength(24); // n points -> 2 + 2 (n - 1) per pass: 3, 6, 12, 24
    const rnd = mulberry32Stream(7);
    expect(rnd()).toBe(mulberry32(7));
    expect(rnd()).not.toBe(mulberry32(7));
  });
});

describe('cross stitch', () => {
  it('fills whole squares of a shared grid: / going right, \\ coming back', () => {
    const pts = crossStitchFill(square, settings('cross_stitch', { crossSize: 2.5 }));
    // 4 x 4 squares; first row: / strokes left to right, then \ strokes back.
    expect(round(pts.slice(0, 16))).toEqual([
      [0, 2.5], [2.5, 0], [2.5, 2.5], [5, 0], [5, 2.5], [7.5, 0], [7.5, 2.5], [10, 0],
      [10, 2.5], [7.5, 0], [7.5, 2.5], [5, 0], [5, 2.5], [2.5, 0], [2.5, 2.5], [0, 0],
    ]);
    expect(pts.filter((p) => p[1] === 10)).toHaveLength(8); // 4 rows reached the bottom
  });

  it('counts a square only when its corners and centre are inside the shape grown by 0.15 x size', () => {
    const almost = polygonFromRings(rect(0.3, 0, 10, 10)); // left column 0.3 mm short: still counts (grown 0.375)
    expect(crossStitchFill(almost, settings('cross_stitch', { crossSize: 2.5 }))[0]).toEqual([0, 2.5]);
    const short = polygonFromRings(rect(0.5, 0, 10, 10)); // 0.5 mm short: does not
    expect(crossStitchFill(short, settings('cross_stitch', { crossSize: 2.5 }))[0]).toEqual([2.5, 2.5]);
  });

  it('sews each stroke twice with crossDouble', () => {
    const pts = crossStitchFill(polygonFromRings(rect(0, 0, 2.5, 2.5)), settings('cross_stitch', { crossSize: 2.5, crossDouble: true }));
    expect(round(pts)).toEqual([[0, 2.5], [2.5, 0], [0, 2.5], [2.5, 0], [2.5, 2.5], [0, 0], [2.5, 2.5], [0, 0]]);
  });

  it('jumps between separate runs', () => {
    const two = [...polygonFromRings(rect(0, 0, 2.5, 2.5)), ...polygonFromRings(rect(10, 0, 12.5, 2.5))];
    const pts = crossStitchFill(two, settings('cross_stitch', { crossSize: 2.5 }));
    const landing = pts.findIndex((p) => p[0] >= 10);
    expect(pts.slice(landing, landing + JUMP_MARK).every((p) => p[0] === pts[landing]![0] && p[1] === pts[landing]![1])).toBe(true);
  });
});

describe('motifs', () => {
  it('has the built-in motifs, each in the unit box from (0,0) to (1,0)', () => {
    expect(BUILTIN_MOTIFS.map((m) => m.name)).toEqual(['wave', 'scallop', 'rickrack', 'diamond', 'leaf', 'cross', 'loop', 'triple']);
    for (const m of BUILTIN_MOTIFS) {
      expect(m.points[0]).toEqual([0, 0]);
      expect(m.points[m.points.length - 1]).toEqual([1, 0]);
      for (const [x, y] of m.points) {
        expect(x >= -1e-9 && x <= 1 + 1e-9).toBe(true);
        expect(y >= -0.5 - 1e-9 && y <= 0.5 + 1e-9).toBe(true);
      }
    }
  });

  it('prefers the project motif of the same name', () => {
    const own = { name: 'wave', points: [[0, 0], [1, 0]] as Point[] };
    expect(findMotif('wave', [own])).toBe(own);
    expect(findMotif('scallop', [own])!.name).toBe('scallop');
    expect(findMotif('nope')).toBeNull();
  });

  it('repeats a motif along a line, stretched so a whole number fits', () => {
    const s = settings('motif_line', { motifName: 'rickrack', motifLength: 4, motifWidth: 3, motifGap: 0, stitchLength: 10 });
    const pts = motifLine([[0, 0], [21, 0]], s);
    // round(21 / 4) = 5 motifs of 4.2 mm: corners at 0.25 and 0.75 of each.
    expect(round(pts.slice(0, 4))).toEqual([[0, 0], [1.05, -1.5], [3.15, 1.5], [4.2, 0]]);
    expect(pts[pts.length - 1]).toEqual([21, 0]);
  });

  it('runs the gap between motifs', () => {
    const s = settings('motif_line', { motifName: 'rickrack', motifLength: 4, motifGap: 1, stitchLength: 10 });
    const pts = motifLine([[0, 0], [21, 0]], s);
    // round(22 / 5) = 4 motifs: (21 + 1) / 4 - 1 = 4.5 mm each, then 1 mm of running stitch.
    expect(round(pts.slice(3, 5))).toEqual([[4.5, 0], [5.5, 0]]);
  });

  it('fills an area with motifs wholly inside, rows alternating, every other motif raised or swapped', () => {
    const big = polygonFromRings(rect(0, 0, 30, 30));
    const s = settings('motif_fill', { motifName: 'scallop', motifLength: 4, motifWidth: 3, motifRowSpacing: 4, stitchLength: 3 });
    const pts = motifFill(big, s);
    expect(pts.length).toBeGreaterThan(100);
    expect(inside(pts, big)).toBe(true);
    const raised = motifFill(big, { ...s, motifColumnOffset: 0.5 });
    expect(raised).not.toEqual(pts);
    expect(inside(raised, big)).toBe(true);
    const swapped = motifFill(big, { ...s, motif2Name: 'rickrack', motif2Scale: 0.5 });
    expect(swapped).not.toEqual(pts);
    expect(inside(swapped, big)).toBe(true);
  });
});

describe('laydown', () => {
  it('sews unstaggered tatami, then a second layer across starting where the first ended', () => {
    const s = settings('laydown', { laydownLayers: 2, laydownAngle2: 90 });
    const one = laydown(square, { ...s, laydownLayers: 1 });
    const two = laydown(square, s);
    expect(two.slice(0, one.length)).toEqual(one);
    const rest = two.slice(one.length);
    expect(rest.length).toBeGreaterThan(50);
    // The second layer's rows are vertical.
    const xs = new Set(rest.map((p) => p[0].toFixed(3)));
    expect(xs.size).toBeGreaterThan(40);
  });
});

describe('every stitch type sews through computeStitches', () => {
  it('produces finite stitches inside the shape', () => {
    for (const t of ['satin_fill', 'outline', 'contour', 'stipple', 'cross_stitch', 'motif_fill', 'laydown'] as const) {
      const pts = computeStitches(objectOf(t, rect(0, 0, 20, 20)));
      expect(pts.length, t).toBeGreaterThan(10);
      expect(inside(pts, polygonFromRings(rect(0, 0, 20, 20)), 0.6), t).toBe(true);
    }
  });

  it('sews motif lines and manual stitches', () => {
    const doc = createDocument();
    const line = createObject(doc, { stitchType: 'motif_line', points: [pathNode(0, 0), pathNode(20, 0)] });
    expect(computeStitches(line).length).toBeGreaterThan(20);
    const manual = createObject(doc, { stitchType: 'manual', points: [pathNode(0, 0), pathNode(3, 4)] });
    expect(computeStitches(manual)).toEqual([[0, 0], [3, 4]]);
  });
});
