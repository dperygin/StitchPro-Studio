// Run styles, raised satin, contour, stipple, cross stitch.

import { mulberry32Stream } from './columns';
import { bufferRegion, closeRing, covers, pointInRegion, type Region } from './geometry';
import { cumulativeLengths, distance, pointAt, resampleKeepingCorners, resamplePolyline } from './path';
import { JUMP_MARK, type Point, type RunStyle, type StitchSettings } from './types';

export interface RunOptions {
  stitchLength: number;
  runStyle: RunStyle;
  /** Rope width for stemstitch, mm. */
  stemWidth: number;
}

/** Running stitch along a path: resampled every stitchLength, then sewn in the chosen style. */
export function runningStitch(path: readonly Point[], opts: RunOptions): Point[] {
  if (path.length < 2) return path.map((p) => [p[0], p[1]]);
  if (opts.runStyle === 'stemstitch') return stemStitch(path, opts.stitchLength, opts.stemWidth);
  const pts = resamplePolyline(path, opts.stitchLength);
  switch (opts.runStyle) {
    case 'triple':
      return tripleRun(pts, () => true);
    case 'sculpture':
      return tripleRun(pts, (stitch) => stitch % 2 === 1);
    case 'backstitch':
      return backstitch(pts);
    default:
      return pts;
  }
}

/** Start point, then each stitch (1-based) sewn forward, back, forward when `triple(stitch)`, else once. */
function tripleRun(pts: Point[], triple: (stitch: number) => boolean): Point[] {
  const out: Point[] = [pts[0]!];
  for (let i = 1; i < pts.length; i++) {
    if (triple(i)) out.push(pts[i]!, pts[i - 1]!, pts[i]!);
    else out.push(pts[i]!);
  }
  return out;
}

/** First point, then for i >= 2: point i, point i - 1; then the last point. */
function backstitch(pts: Point[]): Point[] {
  const out: Point[] = [pts[0]!];
  for (let i = 2; i < pts.length; i++) out.push(pts[i]!, pts[i - 1]!);
  out.push(pts[pts.length - 1]!);
  return out;
}

/**
 * Stem stitch (a rope): for d = 0, len/2, len, ... while d + len <= total, the point at d
 * offset half a width to the left, then the point at d + len offset to the right. Normals
 * come from the points 0.1 mm either side. Left/right as seen on screen (y down).
 * A path shorter than one stitch is sewn as a plain run.
 */
function stemStitch(path: readonly Point[], stitchLength: number, stemWidth: number): Point[] {
  const len = Math.max(0.5, stitchLength);
  const half = Math.max(0.1, stemWidth / 2);
  const cum = cumulativeLengths(path);
  const total = cum[cum.length - 1]!;
  const offset = (d: number, side: 1 | -1): Point => {
    const a = pointAt(path, d - 0.1, cum);
    const b = pointAt(path, d + 0.1, cum);
    const p = pointAt(path, d, cum);
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const n = Math.hypot(dx, dy) || 1;
    // Screen-left of (dx, dy) with y down is (dy, -dx).
    return [p[0] + ((side * dy) / n) * half, p[1] + ((-side * dx) / n) * half];
  };
  const out: Point[] = [];
  for (let k = 0; ; k++) {
    const d = (k * len) / 2;
    if (d + len > total + 1e-9) break;
    out.push(offset(d, 1), offset(d + len, -1));
  }
  return out.length ? out : resamplePolyline(path, stitchLength);
}

/**
 * Raised satin: for layer l = layers - 1 down to 1, a satin at width x (1 - 0.15 l) and
 * spacing x 2; then the normal satin. `satin(widthScale, spacingScale)` sews one layer.
 */
export function raisedSatin(layers: number, satin: (widthScale: number, spacingScale: number) => Point[]): Point[] {
  const out: Point[] = [];
  for (let l = Math.floor(layers) - 1; l >= 1; l--) out.push(...satin(1 - 0.15 * l, 2));
  out.push(...satin(1, 1));
  return out;
}

// ---- shared helpers for area stitches ----

const sameP = (a: Point, b: Point) => a[0] === b[0] && a[1] === b[1];

/** Appends points, dropping a point equal to the one before it. */
function appendDistinct(out: Point[], pts: readonly Point[]): void {
  for (const p of pts) if (!out.length || !sameP(out[out.length - 1]!, p)) out.push(p);
}

/** Joins a new piece of stitching: straight on if the move is covered, else a jump (landing point repeated). */
function joinPiece(out: Point[], pts: readonly Point[], region: Region): void {
  if (!pts.length) return;
  if (out.length && !covers(region, [out[out.length - 1]!, pts[0]!])) {
    for (let k = 1; k < JUMP_MARK; k++) out.push([pts[0]![0], pts[0]![1]]);
    out.push(...pts);
    return;
  }
  appendDistinct(out, pts);
}

// ---- contour ----

/**
 * Contour fill: the two extreme points of the outline along the fill angle (on flat ends the
 * one nearest the middle) split it into two sides; each is resampled to 201 points; rows =
 * ceil(widest gap / row spacing); row k interpolates the sides at k / rows; rows alternate
 * direction and are resampled by the stitch length.
 */
export function contourFill(region: Region, s: StitchSettings): Point[] {
  const out: Point[] = [];
  for (const poly of region) joinPiece(out, contourPiece(poly.outer, s), region);
  return out;
}

function contourPiece(outer: readonly Point[], s: StitchSettings): Point[] {
  const ring = resampleKeepingCorners(closeRing(outer), 0.5, { closed: true });
  const body = ring.slice(0, -1);
  if (body.length < 3) return [];
  const a = (s.fillAngle * Math.PI) / 180;
  const proj = body.map((p) => p[0] * Math.cos(a) + p[1] * Math.sin(a));
  const extreme = (target: number) => {
    const tied = body.map((_, i) => i).filter((i) => Math.abs(proj[i]! - target) <= 1e-6);
    const mx = tied.reduce((sum, i) => sum + body[i]![0], 0) / tied.length;
    const my = tied.reduce((sum, i) => sum + body[i]![1], 0) / tied.length;
    return tied.reduce((b, i) => (distance(body[i]!, [mx, my]) < distance(body[b]!, [mx, my]) ? i : b));
  };
  const iMin = extreme(Math.min(...proj));
  const iMax = extreme(Math.max(...proj));
  const n = body.length;
  const walk = (dir: 1 | -1): Point[] => {
    const pts: Point[] = [];
    for (let i = iMin; ; i = (i + dir + n) % n) {
      pts.push(body[i]!);
      if (i === iMax) break;
    }
    return pts;
  };
  const resample201 = (line: Point[]) => {
    const cum = cumulativeLengths(line);
    const total = cum[cum.length - 1]!;
    return Array.from({ length: 201 }, (_, j) => pointAt(line, (total * j) / 200, cum));
  };
  const A = resample201(walk(1));
  const B = resample201(walk(-1));
  const widest = Math.max(...A.map((p, j) => distance(p, B[j]!)));
  const rows = Math.max(1, Math.ceil(widest / s.fillRowSpacing - 1e-9));
  const out: Point[] = [];
  for (let k = 0; k <= rows; k++) {
    const t = k / rows;
    let line = A.map((p, j): Point => [p[0] + (B[j]![0] - p[0]) * t, p[1] + (B[j]![1] - p[1]) * t]);
    if (k % 2 === 1) line = line.reverse();
    appendDistinct(out, resamplePolyline(line, s.fillStitchLength));
  }
  return out;
}

// ---- stipple ----

/** Chaikin's corner cutting: each segment replaced by points at 1/4 and 3/4 (ends kept). */
export function chaikin(pts: readonly Point[], passes = 1): Point[] {
  let line = pts.map((p): Point => [p[0], p[1]]);
  for (let k = 0; k < passes && line.length > 2; k++) {
    const next: Point[] = [line[0]!];
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1]!;
      const b = line[i]!;
      next.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]], [0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]);
    }
    next.push(line[line.length - 1]!);
    line = next;
  }
  return line;
}

/**
 * Stipple: a grid of cells (spacing c = max(0.8, stippleSpacing)) inside the shape shrunk by
 * c / 2; a maze by randomized depth-first search (a random spanning tree, mulberry32 seed 7);
 * the tour round the tree, offset a quarter cell to the right of each step; three passes of
 * Chaikin smoothing; resampled by the stitch length.
 */
export function stippleFill(region: Region, s: StitchSettings): Point[] {
  const c = Math.max(0.8, s.stippleSpacing);
  const inner = bufferRegion(region, -c / 2);
  const all = inner.flatMap((p) => p.outer);
  if (!all.length) return [];
  const xs = all.map((p) => p[0]);
  const ys = all.map((p) => p[1]);
  const i0 = Math.floor(Math.min(...xs) / c);
  const i1 = Math.ceil(Math.max(...xs) / c);
  const j0 = Math.floor(Math.min(...ys) / c);
  const j1 = Math.ceil(Math.max(...ys) / c);
  const key = (i: number, j: number) => `${i},${j}`;
  const cells = new Map<string, [number, number]>();
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (pointInRegion(inner, [i * c, j * c]) !== 'outside') cells.set(key(i, j), [i, j]);

  const rnd = mulberry32Stream(7);
  const visited = new Set<string>();
  const out: Point[] = [];
  for (const [startKey, start] of cells) {
    if (visited.has(startKey)) continue;
    // Random spanning tree by depth-first search.
    const children = new Map<string, [number, number][]>();
    visited.add(startKey);
    const stack: [number, number][] = [start];
    while (stack.length) {
      const [i, j] = stack[stack.length - 1]!;
      const options = (
        [
          [i + 1, j],
          [i, j + 1],
          [i - 1, j],
          [i, j - 1],
        ] as [number, number][]
      ).filter(([a, b]) => cells.has(key(a, b)) && !visited.has(key(a, b)));
      if (!options.length) {
        stack.pop();
        continue;
      }
      const next = options[Math.floor(rnd() * options.length)]!;
      visited.add(key(next[0], next[1]));
      const list = children.get(key(i, j)) ?? [];
      list.push(next);
      children.set(key(i, j), list);
      stack.push(next);
    }
    // Tour round the tree (down each branch and back).
    const tour: [number, number][] = [start];
    const walk: { cell: [number, number]; next: number }[] = [{ cell: start, next: 0 }];
    while (walk.length) {
      const top = walk[walk.length - 1]!;
      const kids = children.get(key(top.cell[0], top.cell[1])) ?? [];
      if (top.next < kids.length) {
        const child = kids[top.next++]!;
        tour.push(child);
        walk.push({ cell: child, next: 0 });
      } else {
        walk.pop();
        if (walk.length) tour.push(walk[walk.length - 1]!.cell);
      }
    }
    let path: Point[];
    if (tour.length === 1) path = [[start[0] * c, start[1] * c]];
    else {
      path = [];
      for (let k = 1; k < tour.length; k++) {
        const a: Point = [tour[k - 1]![0] * c, tour[k - 1]![1] * c];
        const b: Point = [tour[k]![0] * c, tour[k]![1] * c];
        const len = distance(a, b);
        // Screen-right of the step (y down) is (-dy, dx).
        const r: Point = [(-(b[1] - a[1]) / len) * (c / 4), ((b[0] - a[0]) / len) * (c / 4)];
        path.push([a[0] + r[0], a[1] + r[1]], [b[0] + r[0], b[1] + r[1]]);
      }
    }
    joinPiece(out, resamplePolyline(chaikin(path, 3), s.stitchLength), region);
  }
  return out;
}

// ---- cross stitch ----

/**
 * Cross stitch: a grid of crossSize squares from 0 mm (shared by the whole design). A square
 * counts when its 4 corners and centre lie inside the shape grown by 0.15 x size. Each row's
 * runs of squares: "/" strokes going right, then "\" strokes coming back; crossDouble sews
 * each stroke twice.
 */
export function crossStitchFill(region: Region, s: StitchSettings): Point[] {
  const S = s.crossSize;
  if (!(S > 0)) return [];
  const grown = bufferRegion(region, 0.15 * S);
  const all = region.flatMap((p) => p.outer);
  if (!all.length) return [];
  const xs = all.map((p) => p[0]);
  const ys = all.map((p) => p[1]);
  const inside = (p: Point) => pointInRegion(grown, p) !== 'outside';
  const counts = (i: number, j: number) =>
    inside([i * S, j * S]) &&
    inside([(i + 1) * S, j * S]) &&
    inside([i * S, (j + 1) * S]) &&
    inside([(i + 1) * S, (j + 1) * S]) &&
    inside([(i + 0.5) * S, (j + 0.5) * S]);
  const stroke = (a: Point, b: Point): Point[] => (s.crossDouble ? [a, b, a, b] : [a, b]);
  const out: Point[] = [];
  for (let j = Math.floor(Math.min(...ys) / S) - 1; j <= Math.ceil(Math.max(...ys) / S); j++) {
    const y0 = j * S;
    const y1 = (j + 1) * S;
    let run: number[] = [];
    const flush = () => {
      if (!run.length) return;
      const pts: Point[] = [];
      for (const i of run) appendDistinct(pts, stroke([i * S, y1], [(i + 1) * S, y0])); // "/" going right
      for (const i of [...run].reverse()) appendDistinct(pts, stroke([(i + 1) * S, y1], [i * S, y0])); // "\" coming back
      joinPiece(out, pts, grown);
      run = [];
    };
    for (let i = Math.floor(Math.min(...xs) / S) - 1; i <= Math.ceil(Math.max(...xs) / S); i++) {
      if (counts(i, j)) run.push(i);
      else flush();
    }
    flush();
  }
  return out;
}
