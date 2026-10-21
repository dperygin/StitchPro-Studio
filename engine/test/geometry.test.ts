import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  bandRegion,
  bufferRegion,
  clipLine,
  closeRing,
  contains,
  covers,
  difference,
  distanceToRegion,
  fastAreaCovers,
  fastBandCovers,
  intersection,
  lineOutside,
  moveCovered,
  nearestOnBoundary,
  nearestPoint,
  nestRings,
  offsetLine,
  offsetOutlines,
  pointInRegion,
  polygonFromRings,
  regionArea,
  regionPerimeter,
  regionPieces,
  regionRings,
  regionWidth,
  ringArea,
  ringOrientation,
  splitRegion,
  uncoveredLength,
  unionAll,
  type Point,
  type Region,
} from '../src/index';

const rect = (x0: number, y0: number, x1: number, y1: number): Point[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const square = polygonFromRings(rect(0, 0, 10, 10));
const donut = polygonFromRings(rect(0, 0, 10, 10), [rect(3, 3, 7, 7)]);

describe('JSTS stays in geometry.ts', () => {
  it('is imported by no other engine source file', () => {
    const dir = join(__dirname, '..', 'src');
    const users = readdirSync(dir).filter((f) => f.endsWith('.ts') && readFileSync(join(dir, f), 'utf8').includes("from 'jsts"));
    expect(users).toEqual(['geometry.ts']);
  });
});

describe('regions from rings', () => {
  it('builds polygons with holes', () => {
    expect(regionArea(square)).toBe(100);
    expect(regionArea(donut)).toBe(84);
    expect(donut).toHaveLength(1);
    expect(donut[0]!.holes).toHaveLength(1);
  });

  it('closes rings and drops repeated points', () => {
    expect(closeRing([[0, 0], [1, 0], [1, 0], [1, 1], [0, 0]])).toEqual([[0, 0], [1, 0], [1, 1], [0, 0]]);
  });

  it('repairs a self-intersecting outline', () => {
    const bowtie = polygonFromRings([[0, 0], [10, 10], [10, 0], [0, 10]]);
    expect(regionArea(bowtie)).toBeCloseTo(50, 9); // both lobes kept (a zero-width buffer keeps one)
    expect(bowtie).toHaveLength(2);
  });

  it('lists pieces and rings', () => {
    const two = unionAll([square, polygonFromRings(rect(20, 0, 30, 10))]);
    expect(regionPieces(two)).toHaveLength(2);
    expect(regionRings(donut)).toHaveLength(2);
    expect(polygonFromRings([[0, 0], [1, 1]])).toEqual([]);
  });
});

describe('shoelace area and orientation', () => {
  it('signs the area by direction (clockwise on screen is positive, y down)', () => {
    const cw: Point[] = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]];
    expect(ringArea(cw)).toBe(100);
    expect(ringArea([...cw].reverse())).toBe(-100);
    expect(ringOrientation(cw)).toBe('cw');
    expect(ringOrientation([...cw].reverse())).toBe('ccw');
    expect(ringArea([[0, 0], [4, 0], [0, 3]])).toBe(6); // unclosed works too
  });
});

describe('buffer and offsets', () => {
  it('grows with mitre joins exactly and round joins approximately', () => {
    expect(regionArea(bufferRegion(square, 1, { join: 'mitre' }))).toBeCloseTo(144, 9);
    const round = regionArea(bufferRegion(square, 1));
    expect(round).toBeGreaterThan(140 + Math.PI - 0.05);
    expect(round).toBeLessThan(140 + Math.PI);
  });

  it('shrinks with a negative distance and can vanish', () => {
    expect(regionArea(bufferRegion(square, -1))).toBeCloseTo(64, 9);
    expect(bufferRegion(square, -6)).toEqual([]);
  });

  it('gives offset outlines of a closed shape as rings', () => {
    const rings = offsetOutlines(donut, -1, 'mitre');
    expect(rings).toHaveLength(2);
    const areas = rings.map((r) => Math.abs(ringArea(r))).sort((a, b) => a - b);
    expect(areas[0]).toBeCloseTo(36, 9); // hole grows to 6 x 6
    expect(areas[1]).toBeCloseTo(64, 9); // outline shrinks to 8 x 8
  });

  it('offsets an open line to the screen-left with mitre joins', () => {
    // Walking right along y = 0, screen-left is up (negative y).
    expect(offsetLine([[0, 0], [10, 0]], 1)).toEqual([[0, -1], [10, -1]]);
    expect(offsetLine([[0, 0], [10, 0]], -1)).toEqual([[0, 1], [10, 1]]);
    // An L turning down: the outside (left) corner is mitred to a point.
    const l = offsetLine([[0, 0], [10, 0], [10, 10]], 1);
    expect(l).toEqual([[0, -1], [11, -1], [11, 10]]);
  });

  it('simplifies offset lines to 0.05 mm', () => {
    const wobble: Point[] = Array.from({ length: 21 }, (_, i) => [i, i % 2 ? 0.01 : 0]);
    expect(offsetLine(wobble, 1).length).toBeLessThanOrEqual(3);
  });

  it('builds a band around a line', () => {
    expect(regionArea(bandRegion([[0, 0], [10, 0]], 1, { cap: 'flat' }))).toBeCloseTo(20, 9);
    const round = regionArea(bandRegion([[0, 0], [10, 0]], 1));
    expect(round).toBeGreaterThan(20 + Math.PI - 0.05);
    expect(bandRegion([[0, 0], [1, 0]], 0)).toEqual([]);
  });
});

describe('covers and contains', () => {
  it('treats the boundary as covered but not contained', () => {
    expect(covers(square, [0, 5])).toBe(true);
    expect(contains(square, [0, 5])).toBe(false);
    expect(contains(square, [5, 5])).toBe(true);
    expect(covers(square, [11, 5])).toBe(false);
  });

  it('tests lines and regions, respecting holes', () => {
    expect(covers(square, [[1, 1], [9, 9]])).toBe(true);
    expect(covers(donut, [[1, 1], [9, 9]])).toBe(false);
    expect(covers(donut, [[1, 1], [9, 1]])).toBe(true);
    expect(covers(square, polygonFromRings(rect(2, 2, 4, 4)))).toBe(true);
    expect(covers(polygonFromRings(rect(2, 2, 4, 4)), square)).toBe(false);
    expect(covers([], [1, 1])).toBe(false);
  });

  it('classifies points exactly', () => {
    expect(pointInRegion(donut, [1, 1])).toBe('inside');
    expect(pointInRegion(donut, [5, 5])).toBe('outside');
    expect(pointInRegion(donut, [3, 5])).toBe('boundary');
  });
});

describe('lines against regions', () => {
  it('clips a line to a region, in order and direction', () => {
    expect(clipLine([[-5, 5], [15, 5]], donut)).toEqual([
      [[0, 5], [3, 5]],
      [[7, 5], [10, 5]],
    ]);
    expect(clipLine([[15, 5], [-5, 5]], square)).toEqual([[[10, 5], [0, 5]]]);
  });

  it('keeps bends inside a clipped piece', () => {
    expect(clipLine([[-1, 2], [5, 2], [5, 12]], square)).toEqual([[[0, 2], [5, 2], [5, 10]]]);
  });

  it('gives the parts of a line outside a region', () => {
    expect(lineOutside([[-5, 5], [15, 5]], donut)).toEqual([
      [[-5, 5], [0, 5]],
      [[3, 5], [7, 5]],
      [[10, 5], [15, 5]],
    ]);
    expect(lineOutside([[1, 1], [2, 2]], [])).toEqual([[[1, 1], [2, 2]]]);
  });

  it('counts a line running along the edge as inside', () => {
    expect(clipLine([[0, -2], [0, 12]], square)).toEqual([[[0, 0], [0, 10]]]);
  });
});

describe('nearest point and distance', () => {
  it('finds the nearest point (itself when inside)', () => {
    expect(nearestPoint(square, [15, 5])).toEqual({ point: [10, 5], distance: 5 });
    expect(nearestPoint(square, [5, 5])).toEqual({ point: [5, 5], distance: 0 });
    expect(nearestPoint(donut, [5, 4])).toEqual({ point: [5, 3], distance: 1 });
    expect(distanceToRegion(square, [13, 14])).toBe(5);
  });

  it('finds the nearest boundary point from inside', () => {
    expect(nearestOnBoundary(square, [5, 1])).toEqual({ point: [5, 0], distance: 1 });
  });
});

describe('ring nesting', () => {
  it('sorts rings into shells and holes by even-odd containment', () => {
    const region = nestRings([rect(3, 3, 7, 7), rect(0, 0, 10, 10), rect(4, 4, 6, 6), rect(20, 0, 25, 5)]);
    expect(region).toHaveLength(3);
    const big = region.find((p) => Math.abs(ringArea(p.outer)) === 100)!;
    expect(big.holes.map((h) => Math.abs(ringArea(h)))).toEqual([16]);
    expect(region.some((p) => Math.abs(ringArea(p.outer)) === 4 && p.holes.length === 0)).toBe(true); // island in the hole
    expect(region.some((p) => Math.abs(ringArea(p.outer)) === 25)).toBe(true);
  });
});

describe('union, difference, intersection', () => {
  it('unions many areas', () => {
    const r = unionAll([square, polygonFromRings(rect(5, 0, 15, 10)), polygonFromRings(rect(30, 0, 31, 1))]);
    expect(regionArea(r)).toBeCloseTo(151, 9);
    expect(r).toHaveLength(2);
    expect(unionAll([])).toEqual([]);
  });

  it('repairs invalid inputs when the union fails', () => {
    const bowtie: Region = [{ outer: closeRing([[0, 0], [10, 10], [10, 0], [0, 10]]), holes: [] }];
    expect(regionArea(unionAll([bowtie, square]))).toBeCloseTo(100, 9);
  });

  it('subtracts and intersects', () => {
    const half = polygonFromRings(rect(5, -1, 15, 11));
    expect(regionArea(difference(square, half))).toBeCloseTo(50, 9);
    expect(regionArea(intersection(square, half))).toBeCloseTo(50, 9);
    expect(difference(square, [])).toBe(square);
    expect(intersection(square, [])).toEqual([]);
  });
});

describe('split a region by a line', () => {
  it('cuts a square in two', () => {
    const parts = splitRegion(square, [[5, -1], [5, 11]]);
    expect(parts.map(regionArea).sort()).toEqual([50, 50]);
  });

  it('keeps only faces inside the region (holes stay holes)', () => {
    const parts = splitRegion(donut, [[5, -1], [5, 11]]);
    expect(parts).toHaveLength(2);
    expect(parts.map(regionArea).map((a) => Math.round(a))).toEqual([42, 42]);
  });

  it('leaves the region whole when the line misses it', () => {
    const parts = splitRegion(square, [[20, -1], [20, 11]]);
    expect(parts).toHaveLength(1);
    expect(regionArea(parts[0]!)).toBe(100);
  });
});

describe('region width', () => {
  it('is 2 x area / perimeter', () => {
    const strip = polygonFromRings(rect(0, 0, 100, 2));
    expect(regionPerimeter(strip)).toBe(204);
    expect(regionWidth(strip)).toBeCloseTo((2 * 200) / 204, 12);
    expect(regionWidth([])).toBe(0);
  });
});

describe('fast rasterized covers', () => {
  it('answers area cover tests by sampling', () => {
    const r = fastAreaCovers(donut);
    expect(r.cell).toBe(0.2);
    expect(moveCovered(r, [1, 1], [9, 1])).toBe(true);
    expect(moveCovered(r, [1, 1], [9, 9])).toBe(false); // crosses the hole
    expect(moveCovered(r, [1, 1], [12, 1])).toBe(false);
    expect(uncoveredLength(r, [1, 5], [9, 5])).toBeCloseTo(4, 1); // the hole is 4 mm wide
    expect(uncoveredLength(r, [1, 1], [9, 1])).toBe(0);
  });

  it('answers band cover tests', () => {
    const r = fastBandCovers([[0, 0], [10, 0], [10, 10]], 1);
    expect(moveCovered(r, [0, 0.5], [9.5, 0.5])).toBe(true);
    expect(moveCovered(r, [10.5, 1], [10.5, 9])).toBe(true);
    expect(moveCovered(r, [0, 0], [10, 10])).toBe(false);
    expect(uncoveredLength(r, [0, 3], [10, 3])).toBeCloseTo(9, 0); // only x 9..10 lies within 1 mm of the vertical leg
  });

  it('combines several rasters', () => {
    const a = fastAreaCovers(polygonFromRings(rect(0, 0, 5, 5)));
    const b = fastAreaCovers(polygonFromRings(rect(5, 0, 10, 5)));
    expect(moveCovered([a, b], [1, 2], [9, 2])).toBe(true);
    expect(moveCovered(a, [1, 2], [9, 2])).toBe(false);
    expect(uncoveredLength([], [0, 0], [3, 4])).toBe(5);
  });

  it('agrees with exact covers for random moves', () => {
    const r = fastAreaCovers(donut);
    let seed = 1;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 12 - 1;
    let disagree = 0;
    for (let k = 0; k < 300; k++) {
      const a: Point = [rnd(), rnd()];
      const b: Point = [rnd(), rnd()];
      if (moveCovered(r, a, b) !== covers(donut, [a, b])) disagree++;
    }
    expect(disagree).toBeLessThan(15); // only near-edge moves may differ
  });
});
