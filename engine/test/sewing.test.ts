import { describe, expect, it } from 'vitest';
import {
  computeStitches,
  createDocument,
  createObject,
  distance,
  generateTopStitching,
  generateUnderlay,
  objectArea,
  pathNode,
  pointInRegion,
  polygonFromRings,
  regionArea,
  sewObject,
  underlayPlan,
  type NewObject,
  type PathNode,
  type Point,
  type Region,
  type StitchSettings,
  type StitchType,
} from '../src/index';

const rect = (x0: number, y0: number, x1: number, y1: number): Point[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const nodes = (pts: Point[]): PathNode[] => pts.map(([x, y]) => pathNode(x, y));
const make = (stitchType: StitchType, init: NewObject, s: Partial<StitchSettings> = {}) => {
  const o = createObject(createDocument(), { stitchType, ...init });
  Object.assign(o.settings, s);
  return o;
};
const satin = (width: number, s: Partial<StitchSettings> = {}, init: NewObject = {}) =>
  make('satin', { points: nodes([[0, 0], [20, 0]]), ...init }, { satinWidth: width, ...s });
const fill = (pts: Point[], s: Partial<StitchSettings> = {}, init: NewObject = {}) =>
  make('fill', { closed: true, points: nodes(pts), ...init }, s);
const kinds = (o: ReturnType<typeof make>) => underlayPlan(o).map((p) => `${p.kind}:${p.layer}`);
const staysInside = (pts: Point[], region: Region, tol: number) => {
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const n = Math.max(1, Math.ceil(distance(a, b) / 0.1));
    for (let k = 0; k <= n; k++) {
      if (pointInRegion(region, [a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n], tol) === 'outside') return false;
    }
  }
  return true;
};

describe('which underlay an object gets', () => {
  it('only tatami, satin fill, satin and two-rail objects', () => {
    expect(kinds(make('running', { points: nodes([[0, 0], [20, 0]]) }))).toEqual([]);
    expect(kinds(make('laydown', { closed: true, points: nodes(rect(0, 0, 20, 20)) }))).toEqual([]);
    expect(kinds(make('satin_fill', { closed: true, points: nodes(rect(0, 0, 20, 20)) }))).toEqual(['edge:1', 'tatami:1']);
  });

  it('automatic: columns under 4 mm get an edge run, wider ones an edge run and zigzag', () => {
    expect(kinds(satin(3))).toEqual(['edge:1']);
    expect(kinds(satin(5))).toEqual(['edge:1', 'zigzag:1']);
  });

  it('automatic: fills under 100 mm2 get an edge run, larger ones an edge run and tatami', () => {
    expect(kinds(fill(rect(0, 0, 8, 8)))).toEqual(['edge:1']);
    expect(kinds(fill(rect(0, 0, 20, 20)))).toEqual(['edge:1', 'tatami:1']);
  });

  it('never under 2 mm wide', () => {
    expect(kinds(satin(1.5))).toEqual([]);
    expect(kinds(fill(rect(0, 0, 40, 1.8)))).toEqual([]); // 2 x area / perimeter = 1.72
  });

  it('honours the settings, legacy combinations and the second layer', () => {
    expect(kinds(satin(5, { underlayEnabled: false }))).toEqual([]);
    expect(kinds(satin(5, { underlayType: 'center' }))).toEqual(['center:1']);
    expect(kinds(satin(5, { underlayType: 'edge', underlay2Type: 'double-zigzag' }))).toEqual(['edge:1', 'double-zigzag:2']);
    expect(kinds(fill(rect(0, 0, 20, 20), { underlayType: 'edge+tatami' }))).toEqual(['edge:1', 'tatami:1']);
    expect(kinds(fill(rect(0, 0, 20, 20), { underlayType: 'center+zigzag' }))).toEqual(['edge:1', 'zigzag:1']); // fills have no centre
    expect(kinds(satin(5, { underlayType: 'tatami' }))).toEqual(['zigzag:1']); // columns have no tatami
  });

  it('skips lettering under 5 mm capital height', () => {
    expect(kinds(satin(5, {}, { textMeta: { capHeight: 4 } }))).toEqual([]);
    expect(kinds(satin(5, {}, { textMeta: { capHeight: 6 } }))).toEqual(['edge:1', 'zigzag:1']);
  });
});

describe('sewing one object', () => {
  it('sews the underlay layers, then the top stitching', () => {
    const o = satin(5);
    const under = generateUnderlay(o);
    const top = generateTopStitching(o, []);
    const all = sewObject(o);
    expect(all.slice(0, under.length)).toEqual(under);
    expect(all.slice(-top.length + 1)).toEqual(top.slice(1));
    expect(computeStitches(o)).toEqual(all);
  });

  it('column underlay: an edge run inset down one edge and back the other, then the zigzag', () => {
    const under = generateUnderlay(satin(5));
    expect(under[0]![0]).toBeCloseTo(0.3, 6); // start margin
    expect(under[0]![1]).toBeCloseTo(-2.2, 6); // left edge inset 0.3
    expect(under.some((p) => Math.abs(p[1] - 2.2) < 1e-6)).toBe(true);
    for (const p of under) expect(Math.abs(p[1])).toBeLessThanOrEqual(2.2 + 1e-6);
  });

  it('keeps every layer and join of a fill inside it', () => {
    const o = fill(rect(0, 0, 20, 20));
    const pts = computeStitches(o);
    expect(pts.length).toBeGreaterThan(generateTopStitching(o, []).length);
    expect(staysInside(pts, polygonFromRings(rect(0, 0, 20, 20)), 0.25)).toBe(true);
  });

  it('keeps joins inside a U-shaped fill with travel on edge on or off', () => {
    const U: Point[] = [[0, 0], [6, 0], [6, 14], [14, 14], [14, 0], [20, 0], [20, 20], [0, 20]];
    for (const travelOnEdge of [true, false]) {
      const pts = computeStitches(fill(U, { travelOnEdge, underlayType: 'edge+tatami' }));
      expect(staysInside(pts, polygonFromRings(U), 0.25)).toBe(true);
    }
  });

  it('starts a fill at its entry and finishes at its exit', () => {
    const o = fill(rect(0, 0, 20, 20), {}, { fillStart: [19, 19], fillEnd: [1, 1] });
    const pts = computeStitches(o);
    expect(distance(pts[0]!, [19, 19])).toBeLessThan(1);
    expect(distance(pts[pts.length - 1]!, [1, 1])).toBeLessThanOrEqual(0.3 + 1e-9);
  });
});

describe('entry points of lines and columns', () => {
  it('sews open lines from the end nearer their entry', () => {
    const o = make('running', { points: nodes([[0, 0], [9, 0]]), fillStart: [9.5, 0] });
    expect(computeStitches(o)).toEqual([[9, 0], [6, 0], [3, 0], [0, 0]]);
  });

  it('starts closed outlines at their entry point', () => {
    const o = make('running', { closed: true, points: nodes(rect(0, 0, 10, 10)), fillStart: [5, -1] });
    const pts = computeStitches(o);
    expect(pts[0]).toEqual([5, 0]);
    expect(pts[pts.length - 1]).toEqual([5, 0]);
  });

  it('starts closed satins at their entry instead of moving the seam', () => {
    const ring = nodes(rect(0, 0, 20, 20));
    const o = make('satin', { closed: true, points: ring, fillStart: [10, 0] }, { underlayEnabled: false });
    const first = computeStitches(o)[0]!;
    expect(distance(first, [10, 0])).toBeLessThan(2.5);
  });

  it('reverses open columns and two-rail satins whose entry is nearer the end', () => {
    const fwd = generateTopStitching(satin(4, { underlayEnabled: false }), []);
    const back = generateTopStitching(satin(4, { underlayEnabled: false }, { fillStart: [21, 0] }), []);
    expect(fwd[0]![0]).toBeCloseTo(0, 6);
    expect(back[0]![0]).toBeCloseTo(20, 6);
    const rails = { points: nodes([[0, 0], [20, 0]]), rail2: nodes([[0, 4], [20, 4]]) };
    const two = generateTopStitching(make('radial_satin', { ...rails, fillStart: [21, 2] }), []);
    expect(two[0]![0]).toBeCloseTo(20, 6);
  });
});

describe('what an object covers', () => {
  it('is the outline and holes of an area', () => {
    const o = fill(rect(0, 0, 10, 10), {}, { holes: [nodes(rect(3, 3, 7, 7))] });
    expect(regionArea(objectArea(o))).toBeCloseTo(84, 9);
  });

  it('is the band of a column', () => {
    expect(regionArea(objectArea(satin(4)))).toBeCloseTo(80, 6);
    const rails = { points: nodes([[0, 0], [20, 0]]), rail2: nodes([[0, 4], [20, 4]]) };
    expect(regionArea(objectArea(make('radial_satin', rails)))).toBeCloseTo(80, 6);
  });

  it('nests the edge rings of a closed column (the outer edge is the shell)', () => {
    const ring = nodes(rect(0, 0, 20, 20));
    const area = objectArea(make('satin', { closed: true, points: ring }, { satinWidth: 2 }));
    expect(area).toHaveLength(1);
    expect(area[0]!.holes).toHaveLength(1);
    expect(regionArea(area)).toBeCloseTo(22 * 22 - 18 * 18, 6); // 1 mm either side of the outline
  });

  it('is nothing for open lines and manual stitches', () => {
    expect(objectArea(make('running', { points: nodes([[0, 0], [5, 5]]) }))).toEqual([]);
    expect(objectArea(make('manual', { points: nodes([[0, 0], [5, 5]]) }))).toEqual([]);
  });
});
