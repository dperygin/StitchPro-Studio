import { describe, expect, it } from 'vitest';
import { autodigitize, distanceTransform, skeletonize, type Point } from '../src';

const rect = (x0: number, y0: number, x1: number, y1: number): Point[] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
  [x0, y0],
];
const circle = (cx: number, cy: number, r: number, n = 64, reverse = false): Point[] => {
  const pts: Point[] = [];
  for (let i = 0; i <= n; i++) {
    const a = ((reverse ? -1 : 1) * 2 * Math.PI * i) / n;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return pts;
};

describe('distance transform', () => {
  it('matches brute force', () => {
    const w = 9;
    const h = 7;
    const inside = new Uint8Array(w * h);
    for (let y = 1; y < 6; y++) for (let x = 1; x < 8; x++) if (!(x === 4 && y === 3)) inside[y * w + x] = 1;
    const d = distanceTransform(inside, w, h);
    for (let i = 0; i < w * h; i++) {
      let best = Infinity;
      for (let j = 0; j < w * h; j++) if (!inside[j]) best = Math.min(best, Math.hypot((i % w) - (j % w), Math.floor(i / w) - Math.floor(j / w)));
      expect(d[i]).toBeCloseTo(inside[i] ? best : 0, 9);
    }
  });
});

describe('skeleton', () => {
  it('thins a bar to a one-pixel line', () => {
    const w = 30;
    const h = 11;
    const inside = new Uint8Array(w * h);
    for (let y = 2; y < 9; y++) for (let x = 2; x < 28; x++) inside[y * w + x] = 1;
    const s = skeletonize(inside, w, h);
    for (let x = 6; x < 24; x++) {
      let n = 0;
      for (let y = 0; y < h; y++) n += s[y * w + x]!;
      expect(n).toBe(1);
    }
  });
});

describe('autodigitize', () => {
  // Font units: capital height 1000, baseline 0, y down.
  it('turns an I into one vertical column reaching the ends', () => {
    const objs = autodigitize([rect(0, -1000, 120, 0)], 1000);
    expect(objs).toHaveLength(1);
    const o = objs[0]!;
    expect(o.stitchType).toBe('radial_satin');
    expect(o.settings?.pairedRails).toBe(true);
    const ys = [...o.points!, ...o.rail2!].map((p) => p.y);
    expect(Math.min(...ys)).toBeLessThan(-950);
    expect(Math.max(...ys)).toBeGreaterThan(-50);
    // Rails about the stroke's width apart.
    const mid = Math.floor(o.points!.length / 2);
    const gap = Math.abs(o.points![mid]!.x - o.rail2![mid]!.x);
    expect(gap).toBeGreaterThan(90);
    expect(gap).toBeLessThan(140);
  });

  it('makes an O a closed satin', () => {
    const objs = autodigitize([circle(400, -500, 450), circle(400, -500, 330, 64, true)], 1000);
    expect(objs).toHaveLength(1);
    expect(objs[0]!.stitchType).toBe('satin');
    expect(objs[0]!.closed).toBe(true);
    for (const n of objs[0]!.points!) {
      expect(Math.hypot(n.x - 400, n.y + 500)).toBeCloseTo(390, -1.5);
      expect(n.width!).toBeGreaterThan(90);
    }
  });

  it('splits an L at its corner', () => {
    const L: Point[] = [
      [0, -1000],
      [120, -1000],
      [120, -120],
      [600, -120],
      [600, 0],
      [0, 0],
      [0, -1000],
    ];
    const objs = autodigitize([L], 1000);
    expect(objs).toHaveLength(2);
    expect(objs.every((o) => o.stitchType === 'radial_satin')).toBe(true);
  });

  it('turns a dot into one short column and a dot with a hole into tatami', () => {
    const dot = autodigitize([circle(60, -60, 60)], 1000);
    expect(dot).toHaveLength(1);
    expect(dot[0]!.name).toBe('Dot');
    const ring = autodigitize([circle(60, -60, 60), circle(60, -60, 10, 32, true)], 1000);
    expect(ring).toHaveLength(1);
    expect(ring[0]!.stitchType).toBe('fill');
    expect(ring[0]!.holes).toHaveLength(1);
  });

  it('sews nearest-first, each from its nearer end', () => {
    const objs = autodigitize([rect(0, -1000, 120, 0), rect(500, -1000, 620, 0)], 1000);
    expect(objs).toHaveLength(2);
    // The first starts near the origin (bottom of the left bar).
    expect(objs[0]!.points![0]!.x).toBeLessThan(200);
    expect(objs[0]!.points![0]!.y).toBeGreaterThan(-200);
  });
});
