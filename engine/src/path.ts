// Curve math and polyline helpers. ALL curve math lives here.
//
// Conventions: points are [x, y] in mm, y down. A closed polyline repeats its first point
// at the end (ring[0] equals ring[ring.length - 1]).

import type { PathNode, Point } from './types';

const EPS = 1e-9;

// ---- Python-compatible number helpers ----

/** Python's round(x): round half to even. */
export function roundHalfEven(x: number): number {
  const f = Math.floor(x);
  const diff = x - f;
  if (diff > 0.5) return f + 1;
  if (diff < 0.5) return f;
  return f % 2 === 0 ? f : f + 1;
}

/** Python's a % b: the result takes the sign of the divisor. */
export function floorMod(a: number, b: number): number {
  const r = a % b;
  return r !== 0 && r < 0 !== b < 0 ? r + b : r;
}

// ---- small vector helpers ----

export function distance(a: Point, b: Point): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

const lerp = (a: Point, b: Point, t: number): Point => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const samePoint = (a: Point, b: Point): boolean => Math.abs(a[0] - b[0]) <= EPS && Math.abs(a[1] - b[1]) <= EPS;

function unit(dx: number, dy: number): Point | null {
  const len = Math.hypot(dx, dy);
  return len > EPS ? [dx / len, dy / len] : null;
}

/** Closest point to p on segment a-b, with its parameter t in [0, 1]. */
export function closestOnSegment(p: Point, a: Point, b: Point): { point: Point; t: number } {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.min(1, Math.max(0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2)) : 0;
  return { point: [a[0] + dx * t, a[1] + dy * t], t };
}

export function distanceToSegment(p: Point, a: Point, b: Point): number {
  return distance(p, closestOnSegment(p, a, b).point);
}

/** Distance from p to the nearest point of a polyline. */
export function distanceToPolyline(p: Point, line: readonly Point[]): number {
  if (line.length === 0) return Infinity;
  if (line.length === 1) return distance(p, line[0]!);
  let best = Infinity;
  for (let i = 1; i < line.length; i++) best = Math.min(best, distanceToSegment(p, line[i - 1]!, line[i]!));
  return best;
}

// ---- lengths and positions ----

/** Running length at each vertex, starting at 0. */
export function cumulativeLengths(points: readonly Point[]): number[] {
  const out = new Array<number>(points.length);
  let total = 0;
  for (let i = 0; i < points.length; i++) {
    if (i > 0) total += distance(points[i - 1]!, points[i]!);
    out[i] = total;
  }
  return out;
}

export function polylineLength(points: readonly Point[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += distance(points[i - 1]!, points[i]!);
  return total;
}

/** Index i such that cum[i] <= d <= cum[i + 1] (binary search). */
function segmentIndexAt(cum: readonly number[], d: number): number {
  let lo = 0;
  let hi = cum.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid]! <= d) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** The point at arc length d along the path (clamped to its ends). */
export function pointAt(path: readonly Point[], d: number, cum: readonly number[] = cumulativeLengths(path)): Point {
  if (path.length === 0) throw new Error('pointAt: empty path');
  if (path.length === 1 || d <= 0) return [path[0]![0], path[0]![1]];
  const total = cum[cum.length - 1]!;
  if (d >= total) return [path[path.length - 1]![0], path[path.length - 1]![1]];
  const i = segmentIndexAt(cum, d);
  const segLen = cum[i + 1]! - cum[i]!;
  return lerp(path[i]!, path[i + 1]!, segLen > 0 ? (d - cum[i]!) / segLen : 0);
}

/** A per-vertex value at arc length d, linearly interpolated (clamped to the ends). */
export function valueAt(values: readonly number[], cum: readonly number[], d: number): number {
  if (values.length === 1 || d <= 0) return values[0]!;
  const total = cum[cum.length - 1]!;
  if (d >= total) return values[values.length - 1]!;
  const i = segmentIndexAt(cum, d);
  const segLen = cum[i + 1]! - cum[i]!;
  const t = segLen > 0 ? (d - cum[i]!) / segLen : 0;
  return values[i]! + (values[i + 1]! - values[i]!) * t;
}

export type Spacing = number | ((d: number) => number);

/** Arc-length positions: 0, then every spacing (or spacing(d)) mm, then always the end. */
export function arcPositions(total: number, spacing: Spacing): number[] {
  const out = [0];
  if (total <= EPS) return out;
  const step = typeof spacing === 'number' ? () => spacing : spacing;
  let d = 0;
  for (;;) {
    const s = step(d);
    if (!(s > 1e-6)) throw new Error(`resample: spacing must be positive (got ${s})`);
    d += s;
    if (d >= total - 1e-6) break; // float sums like 50 x 0.2 land just short of the end
    out.push(d);
  }
  out.push(total);
  return out;
}

/** Points every `spacing` mm from the start (fixed, or a function of position); the end is always kept. */
export function resamplePolyline(points: readonly Point[], spacing: Spacing): Point[] {
  if (points.length < 2) return points.map((p) => [p[0], p[1]]);
  const cum = cumulativeLengths(points);
  return arcPositions(cum[cum.length - 1]!, spacing).map((d) => pointAt(points, d, cum));
}

/**
 * Each point replaced by the mean of the `window` points around it (closed paths wrap round;
 * open paths average what exists at their ends). Pass a closed ring without the repeated end.
 */
export function movingAverage(pts: readonly Point[], closed: boolean, window = 5): Point[] {
  const half = Math.floor(window / 2);
  const n = pts.length;
  return pts.map((_, i) => {
    let sx = 0;
    let sy = 0;
    let c = 0;
    for (let k = -half; k <= half; k++) {
      let j = i + k;
      if (closed) j = ((j % n) + n) % n;
      else if (j < 0 || j >= n) continue;
      sx += pts[j]![0];
      sy += pts[j]![1];
      c++;
    }
    return [sx / c, sy / c];
  });
}

/** Like resamplePolyline, carrying one value per point (e.g. column width) by linear interpolation. */
export function resampleWithValues(
  points: readonly Point[],
  values: readonly number[],
  spacing: Spacing,
): { points: Point[]; values: number[] } {
  if (values.length !== points.length) throw new Error('resampleWithValues: one value per point');
  if (points.length < 2) return { points: points.map((p) => [p[0], p[1]]), values: [...values] };
  const cum = cumulativeLengths(points);
  const ds = arcPositions(cum[cum.length - 1]!, spacing);
  return { points: ds.map((d) => pointAt(points, d, cum)), values: ds.map((d) => valueAt(values, cum, d)) };
}

// ---- corners ----

/** Nearest vertex index from i (stepping by dir) that is not on top of point i, or -1. */
function distinctNeighbour(points: readonly Point[], i: number, dir: 1 | -1, closed: boolean): number {
  const n = closed ? points.length - 1 : points.length;
  let j = i;
  for (let k = 0; k < n; k++) {
    j += dir;
    if (closed) j = floorMod(j, n);
    else if (j < 0 || j >= n) return -1;
    if (!samePoint(points[j]!, points[i]!)) return j;
  }
  return -1;
}

/** Interior angle a-p-c in degrees (180 = straight on). */
export function vertexAngleDeg(a: Point, p: Point, c: Point): number {
  const ux = a[0] - p[0];
  const uy = a[1] - p[1];
  const vx = c[0] - p[0];
  const vy = c[1] - p[1];
  return (Math.abs(Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy)) * 180) / Math.PI;
}

export interface CornerOptions {
  closed?: boolean;
  /** A vertex is a corner when the angle between its two sides is below this (degrees). */
  angleBelowDeg?: number;
  /**
   * Only these vertex indices may be corners (e.g. where corner nodes landed after
   * materializing), so turns inside flattened curves never count.
   */
  candidates?: readonly number[];
}

/**
 * Vertices where the line turns sharply, measured with the nearest distinct neighbours.
 * Open ends are never corners. For a closed ring, index 0 stands for the seam.
 */
export function findCorners(points: readonly Point[], opts: CornerOptions = {}): number[] {
  const { closed = false, angleBelowDeg = 150, candidates } = opts;
  const n = closed ? points.length - 1 : points.length;
  const indices = candidates ?? Array.from({ length: n }, (_, i) => i);
  const out: number[] = [];
  for (const i of indices) {
    if (i < 0 || i >= n) continue;
    const prev = closed ? floorMod(i - 1, n) : i - 1;
    if (prev >= 0 && prev !== i && samePoint(points[prev]!, points[i]!)) continue; // a repeat, not a new corner
    const a = distinctNeighbour(points, i, -1, closed);
    const c = distinctNeighbour(points, i, 1, closed);
    if (a < 0 || c < 0 || a === c) continue;
    if (vertexAngleDeg(points[a]!, points[i]!, points[c]!) < angleBelowDeg) out.push(i);
  }
  return [...new Set(out)].sort((x, y) => x - y);
}

/**
 * Resamples so a needle point lands on every sharp corner: the line is split at its corners
 * and each piece is divided evenly into stitches of at most `spacing` mm.
 */
export function resampleKeepingCorners(
  points: readonly Point[],
  spacing: number,
  opts: CornerOptions & { corners?: readonly number[] } = {},
): Point[] {
  if (points.length < 2) return points.map((p) => [p[0], p[1]]);
  if (!(spacing > 1e-6)) throw new Error(`resampleKeepingCorners: spacing must be positive (got ${spacing})`);
  const corners = opts.corners ?? findCorners(points, opts);
  const cuts = [...new Set([0, ...corners.filter((c) => c > 0 && c < points.length - 1), points.length - 1])].sort(
    (a, b) => a - b,
  );
  const out: Point[] = [[points[0]![0], points[0]![1]]];
  for (let k = 1; k < cuts.length; k++) {
    const piece = points.slice(cuts[k - 1], cuts[k]! + 1);
    const cum = cumulativeLengths(piece);
    const len = cum[cum.length - 1]!;
    if (len <= EPS) continue;
    const n = Math.max(1, Math.ceil(len / spacing - 1e-9));
    for (let i = 1; i <= n; i++) out.push(i === n ? [piece[piece.length - 1]![0], piece[piece.length - 1]![1]] : pointAt(piece, (len * i) / n, cum));
  }
  return out;
}

// ---- rings and ends ----

/**
 * Rotates a closed ring (first point repeated at the end) so it starts and ends at the
 * point of the ring nearest p. That point is inserted when it falls between vertices.
 */
export function restartRing(ring: readonly Point[], p: Point): Point[] {
  if (ring.length < 3) return ring.map((q) => [q[0], q[1]]);
  let best = Infinity;
  let seg = 0;
  let at: Point = ring[0]!;
  let t = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const c = closestOnSegment(p, ring[i]!, ring[i + 1]!);
    const d = distance(p, c.point);
    if (d < best - EPS) {
      best = d;
      seg = i;
      at = c.point;
      t = c.t;
    }
  }
  const body = ring.slice(0, -1);
  const n = body.length;
  let start: Point[];
  if (samePoint(at, ring[seg]!) || t <= EPS) start = [...body.slice(seg), ...body.slice(0, seg)];
  else if (samePoint(at, ring[seg + 1]!) || t >= 1 - EPS) {
    const k = (seg + 1) % n;
    start = [...body.slice(k), ...body.slice(0, k)];
  } else start = [at, ...body.slice(seg + 1), ...body.slice(0, seg + 1)];
  const out = start.map((q): Point => [q[0], q[1]]);
  out.push([out[0]![0], out[0]![1]]);
  return out;
}

/**
 * Shortens (positive mm) or extends (negative mm, straight on along the end direction)
 * each end of an open polyline. Over-shortening leaves a single point.
 */
export function trimEnds(points: readonly Point[], startMm: number, endMm: number): Point[] {
  if (points.length < 2) return points.map((p) => [p[0], p[1]]);
  let cum = cumulativeLengths(points);
  const total = cum[cum.length - 1]!;
  let line: Point[] = points.map((p) => [p[0], p[1]]);

  const cutStart = Math.max(0, startMm);
  const cutEnd = Math.max(0, endMm);
  if (cutStart + cutEnd >= total) {
    const d = cutStart + cutEnd > 0 ? (total * cutStart) / (cutStart + cutEnd) : 0;
    return [pointAt(points, d, cum)];
  }
  if (cutStart > 0 || cutEnd > 0) {
    const from = cutStart;
    const to = total - cutEnd;
    const i0 = segmentIndexAt(cum, from);
    const i1 = segmentIndexAt(cum, to);
    const mid = points.slice(i0 + 1, i1 + 1).filter((_, k) => cum[i0 + 1 + k]! > from && cum[i0 + 1 + k]! < to);
    line = [pointAt(points, from, cum), ...mid.map((p): Point => [p[0], p[1]]), pointAt(points, to, cum)];
    cum = cumulativeLengths(line);
  }
  if (startMm < 0) {
    const j = distinctNeighbour(line, 0, 1, false);
    const u = j >= 0 ? unit(line[0]![0] - line[j]![0], line[0]![1] - line[j]![1]) : null;
    if (u) line.unshift([line[0]![0] - u[0] * startMm, line[0]![1] - u[1] * startMm]);
  }
  if (endMm < 0) {
    const last = line.length - 1;
    const j = distinctNeighbour(line, last, -1, false);
    const u = j >= 0 ? unit(line[last]![0] - line[j]![0], line[last]![1] - line[j]![1]) : null;
    if (u) line.push([line[last]![0] - u[0] * endMm, line[last]![1] - u[1] * endMm]);
  }
  return line;
}

// ---- simplification ----

/** Ramer-Douglas-Peucker: keeps the ends and every point needed to stay within tolerance. */
export function douglasPeucker(points: readonly Point[], tolerance: number): Point[] {
  return douglasPeuckerIndices(points, tolerance).map((i) => [points[i]![0], points[i]![1]]);
}

/** Indices of the points Ramer-Douglas-Peucker keeps. */
export function douglasPeuckerIndices(points: readonly Point[], tolerance: number): number[] {
  const n = points.length;
  if (n <= 2) return Array.from({ length: n }, (_, i) => i);
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack: [number, number][] = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let worst = -1;
    let at = -1;
    for (let i = a + 1; i < b; i++) {
      const d = distanceToSegment(points[i]!, points[a]!, points[b]!);
      if (d > worst) {
        worst = d;
        at = i;
      }
    }
    if (at >= 0 && worst > tolerance) {
      keep[at] = 1;
      stack.push([a, at], [at, b]);
    }
  }
  const out: number[] = [];
  keep.forEach((k, i) => k && out.push(i));
  return out;
}

// ---- curve flattening ----

/**
 * Samples a parametric curve f(t), t in [0, 1], at points about `resolution` mm apart by
 * arc length (never further). The ends are exact.
 */
function flattenByArcLength(f: (t: number) => Point, roughLength: number, resolution: number): Point[] {
  const steps = Math.min(4096, Math.max(16, Math.ceil(roughLength / 0.05)));
  const ts: number[] = [];
  const cum: number[] = [];
  let prev = f(0);
  let total = 0;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const p = f(t);
    if (i > 0) total += distance(prev, p);
    ts.push(t);
    cum.push(total);
    prev = p;
  }
  const start = f(0);
  const end = f(1);
  if (total <= EPS) return [start];
  const n = Math.max(1, Math.ceil(total / resolution - 1e-9));
  const out: Point[] = [start];
  for (let k = 1; k < n; k++) {
    const d = (total * k) / n;
    const i = segmentIndexAt(cum, d);
    const span = cum[i + 1]! - cum[i]!;
    const t = ts[i]! + (span > 0 ? (d - cum[i]!) / span : 0) * (ts[i + 1]! - ts[i]!);
    out.push(f(t));
  }
  out.push(end);
  return out;
}

/** Flattens a quadratic ([p0, c, p1]) or cubic ([p0, c1, c2, p1]) Bezier curve by arc length. */
export function flattenBezier(ctrl: readonly Point[], resolution = 0.4): Point[] {
  if (ctrl.length === 3) {
    const [p0, c, p1] = ctrl as [Point, Point, Point];
    const f = (t: number): Point => {
      const u = 1 - t;
      return [u * u * p0[0] + 2 * u * t * c[0] + t * t * p1[0], u * u * p0[1] + 2 * u * t * c[1] + t * t * p1[1]];
    };
    return flattenByArcLength(f, polylineLength(ctrl), resolution);
  }
  if (ctrl.length === 4) {
    const [p0, c1, c2, p1] = ctrl as [Point, Point, Point, Point];
    const f = (t: number): Point => {
      const u = 1 - t;
      const a = u * u * u;
      const b = 3 * u * u * t;
      const c = 3 * u * t * t;
      const d = t * t * t;
      return [a * p0[0] + b * c1[0] + c * c2[0] + d * p1[0], a * p0[1] + b * c1[1] + c * c2[1] + d * p1[1]];
    };
    return flattenByArcLength(f, polylineLength(ctrl), resolution);
  }
  throw new Error('flattenBezier: expected 3 (quadratic) or 4 (cubic) control points');
}

/**
 * Flattens an SVG elliptical arc from `from` to `to` (SVG 1.1 implementation notes F.6.5
 * endpoint-to-centre conversion and F.6.6 out-of-range radius correction).
 */
export function flattenArc(
  from: Point,
  rx: number,
  ry: number,
  xAxisRotationDeg: number,
  largeArc: boolean,
  sweep: boolean,
  to: Point,
  resolution = 0.4,
): Point[] {
  if (samePoint(from, to)) return [[from[0], from[1]]];
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  if (rx <= EPS || ry <= EPS) return [[from[0], from[1]], [to[0], to[1]]];

  const phi = (xAxisRotationDeg * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  // F.6.5.1: (x1', y1')
  const dx = (from[0] - to[0]) / 2;
  const dy = (from[1] - to[1]) / 2;
  const x1p = cos * dx + sin * dy;
  const y1p = -sin * dx + cos * dy;
  // F.6.6.2: scale radii up if the arc cannot reach.
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    const s = Math.sqrt(lambda);
    rx *= s;
    ry *= s;
  }
  // F.6.5.2: (cx', cy')
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const coef = (largeArc !== sweep ? 1 : -1) * Math.sqrt(Math.max(0, num / den));
  const cxp = (coef * rx * y1p) / ry;
  const cyp = (-coef * ry * x1p) / rx;
  // F.6.5.3: (cx, cy)
  const cx = cos * cxp - sin * cyp + (from[0] + to[0]) / 2;
  const cy = sin * cxp + cos * cyp + (from[1] + to[1]) / 2;
  // F.6.5.5 / F.6.5.6: start angle and sweep.
  const angle = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const theta1 = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dTheta = angle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && dTheta > 0) dTheta -= 2 * Math.PI;
  else if (sweep && dTheta < 0) dTheta += 2 * Math.PI;

  const f = (t: number): Point => {
    if (t === 0) return [from[0], from[1]];
    if (t === 1) return [to[0], to[1]];
    const th = theta1 + dTheta * t;
    const ex = rx * Math.cos(th);
    const ey = ry * Math.sin(th);
    return [cos * ex - sin * ey + cx, sin * ex + cos * ey + cy];
  };
  return flattenByArcLength(f, Math.max(rx, ry) * Math.abs(dTheta), resolution);
}

// ---- node paths ----

/** Unit tangent at node j for a segment whose chord direction is `chord`. */
function nodeTangent(nodes: readonly PathNode[], j: number, closed: boolean, chord: Point): Point {
  const node = nodes[j]!;
  if (node.type === 'corner') return chord; // corners stay sharp
  const n = nodes.length;
  if (!closed && (j === 0 || j === n - 1)) return chord;
  const prev = nodes[(j - 1 + n) % n]!;
  const next = nodes[(j + 1) % n]!;
  return unit(next.x - prev.x, next.y - prev.y) ?? chord; // Catmull-Rom direction
}

/** One dense piece per node-to-node segment, each with both of its end points. */
export function materializeSegments(nodes: readonly PathNode[], closed: boolean, resolution = 0.4): Point[][] {
  const n = nodes.length;
  const count = n < 2 ? 0 : closed ? n : n - 1;
  const out: Point[][] = [];
  for (let i = 0; i < count; i++) {
    const a = nodes[i]!;
    const b = nodes[(i + 1) % n]!;
    const A: Point = [a.x, a.y];
    const B: Point = [b.x, b.y];
    const len = distance(A, B);
    const chord = unit(B[0] - A[0], B[1] - A[1]);
    if (!chord) {
      out.push([A, B]);
      continue;
    }
    if (a.type === 'corner' && b.type === 'corner') {
      out.push([A, B]);
      continue;
    }
    const tA = nodeTangent(nodes, i, closed, chord);
    const tB = nodeTangent(nodes, (i + 1) % n, closed, chord);
    const c1: Point = [A[0] + (tA[0] * len) / 3, A[1] + (tA[1] * len) / 3];
    const c2: Point = [B[0] - (tB[0] * len) / 3, B[1] - (tB[1] * len) / 3];
    out.push(flattenBezier([A, c1, c2, B], resolution));
  }
  return out;
}

export interface MaterializedPath {
  points: Point[];
  /** Column width at each point. */
  widths: number[];
  /** Index into `points` where each node lands (closed: node 0 is index 0). */
  nodeIndex: number[];
}

/**
 * The full materialization: dense points (closed paths repeat the start at the end), the
 * per-point column width (node width or `defaultWidth`, linear by arc length along each
 * segment) and where each node landed. Repeated points at zero-length segments are merged.
 */
export function materializeDetailed(
  nodes: readonly PathNode[],
  closed: boolean,
  defaultWidth = 0,
  resolution = 0.4,
): MaterializedPath {
  if (nodes.length === 0) return { points: [], widths: [], nodeIndex: [] };
  const w = (node: PathNode) => node.width ?? defaultWidth;
  const first = nodes[0]!;
  const points: Point[] = [[first.x, first.y]];
  const widths: number[] = [w(first)];
  const nodeIndex: number[] = [0];
  const pieces = materializeSegments(nodes, closed, resolution);
  pieces.forEach((piece, i) => {
    const wa = w(nodes[i]!);
    const wb = w(nodes[(i + 1) % nodes.length]!);
    const cum = cumulativeLengths(piece);
    const len = cum[cum.length - 1]!;
    for (let k = 1; k < piece.length; k++) {
      if (samePoint(piece[k]!, points[points.length - 1]!)) continue;
      points.push(piece[k]!);
      widths.push(len > 0 ? wa + ((wb - wa) * cum[k]!) / len : wb);
    }
    if (i + 1 < nodes.length) nodeIndex.push(points.length - 1);
  });
  return { points, widths, nodeIndex };
}

/** Dense polyline through the nodes (closed paths repeat the start at the end). */
export function materializePath(nodes: readonly PathNode[], closed: boolean, resolution = 0.4): Point[] {
  return materializeDetailed(nodes, closed, 0, resolution).points;
}

/** Column width at each point of materializePath, linearly interpolated by arc length. */
export function materializeWidths(
  nodes: readonly PathNode[],
  closed: boolean,
  defaultWidth: number,
  resolution = 0.4,
): number[] {
  return materializeDetailed(nodes, closed, defaultWidth, resolution).widths;
}

// ---- smoothing ----

/** Largest distance between two polylines, measured both ways (a discrete Hausdorff distance). */
function deviation(a: readonly Point[], b: readonly Point[]): number {
  let worst = 0;
  for (const p of a) worst = Math.max(worst, distanceToPolyline(p, b));
  for (const p of b) worst = Math.max(worst, distanceToPolyline(p, a));
  return worst;
}

/** Width for a new node at arc length d of a stretch, from the original nodes around it. */
function widthAt(d: number, nodeDs: readonly number[], nodeWidths: readonly (number | null)[]): number | null {
  let i = 0;
  while (i < nodeDs.length - 2 && nodeDs[i + 1]! < d) i++;
  const wa = nodeWidths[i]!;
  const wb = nodeWidths[i + 1]!;
  const da = nodeDs[i]!;
  const db = nodeDs[i + 1]!;
  if (wa !== null && wb !== null) return db > da ? wa + ((wb - wa) * (d - da)) / (db - da) : wa;
  return d - da <= db - d ? wa : wb;
}

const SMOOTH_RESOLUTION = 0.1;

/**
 * The fewest nodes that keep the line within `precision` mm of the original. Corner nodes
 * (and the ends of an open path) are kept; between them, curve nodes are picked by
 * Ramer-Douglas-Peucker with a tolerance tightened from loose until the rebuilt curve stays
 * within precision. Per-node widths carry over. Returns the input unchanged when nothing is saved.
 */
export function smoothPath(nodes: readonly PathNode[], closed: boolean, precision: number): PathNode[] {
  const n = nodes.length;
  if (n < 3 || !(precision > 0)) return nodes as PathNode[];
  const full = materializeDetailed(nodes, closed, 0, SMOOTH_RESOLUTION);

  // Anchors: corner nodes, plus the ends of an open path. A closed path with no corners
  // is handled as one loop anchored at node 0.
  let anchors = nodes.map((_, i) => i).filter((i) => nodes[i]!.type === 'corner' || (!closed && (i === 0 || i === n - 1)));
  const loop = closed && anchors.length === 0;
  if (loop) anchors = [0];

  const out: PathNode[] = [];
  const stretches = closed ? anchors.length : anchors.length - 1;
  for (let s = 0; s < stretches; s++) {
    const ia = anchors[s]!;
    const ib = closed ? anchors[(s + 1) % anchors.length]! : anchors[s + 1]!;
    // Original node indices from ia to ib (wrapping), and their dense stretch.
    const idx: number[] = [ia];
    for (let j = (ia + 1) % n; idx.length < n + 1; j = (j + 1) % n) {
      idx.push(j);
      if (j === ib) break;
    }
    const startP = full.nodeIndex[ia]!;
    const endP = ib === 0 && closed ? full.points.length - 1 : full.nodeIndex[ib]!;
    const dense =
      endP > startP ? full.points.slice(startP, endP + 1) : [...full.points.slice(startP, -1), ...full.points.slice(0, endP + 1)];
    const cum = cumulativeLengths(dense);
    const pos = (p: number) => (p >= startP ? p - startP : full.points.length - 1 - startP + p);
    const nodeDs = idx.map((j, k) => (k === idx.length - 1 ? cum[cum.length - 1]! : cum[pos(full.nodeIndex[j]!)]!));
    const nodeWidths = idx.map((j) => nodes[j]!.width);
    const original = idx.slice(0, -1).map((j) => nodes[j]!);

    let best: PathNode[] = original;
    if (idx.length > 2 || loop) {
      // Start loose (the farthest any point lies from the chord: no interior nodes) and tighten.
      // RDP measures against straight chords while the rebuilt line is a spline, so the first
      // tolerance that fits usually lies well above `precision`.
      const a = dense[0]!;
      const b = dense[dense.length - 1]!;
      const spread = Math.max(...dense.map((p) => (loop ? distance(p, a) : distanceToSegment(p, a, b))));
      for (let tol = spread; tol > 1e-4; tol *= 0.8) {
        const keep = douglasPeuckerIndices(dense, tol);
        const curve = keep.slice(1, -1).map(
          (k): PathNode => ({ x: dense[k]![0], y: dense[k]![1], type: 'curve', width: widthAt(cum[k]!, nodeDs, nodeWidths) }),
        );
        const candidate = [nodes[ia]!, ...curve];
        if (candidate.length >= original.length) break;
        const rebuilt = loop
          ? materializePath(candidate, true, SMOOTH_RESOLUTION)
          : materializePath([...candidate, nodes[ib]!], false, SMOOTH_RESOLUTION);
        if (deviation(rebuilt, dense) <= precision) {
          best = candidate;
          break;
        }
      }
    }
    out.push(...best);
  }
  if (!closed) out.push(nodes[anchors[anchors.length - 1]!]!);
  return out.length < n ? out : (nodes as PathNode[]);
}

/**
 * Intersection of the infinite lines a1-a2 and b1-b2, with the parameters along each
 * (point = a1 + t (a2 - a1) = b1 + u (b2 - b1)); null when parallel.
 */
export function lineIntersection(a1: Point, a2: Point, b1: Point, b2: Point): { point: Point; t: number; u: number } | null {
  const dx = a2[0] - a1[0];
  const dy = a2[1] - a1[1];
  const ex = b2[0] - b1[0];
  const ey = b2[1] - b1[1];
  const den = dx * ey - dy * ex;
  if (Math.abs(den) <= EPS) return null;
  const t = ((b1[0] - a1[0]) * ey - (b1[1] - a1[1]) * ex) / den;
  const u = ((b1[0] - a1[0]) * dy - (b1[1] - a1[1]) * dx) / den;
  return { point: [a1[0] + dx * t, a1[1] + dy * t], t, u };
}

/** Nearest point of a polyline to p, with its arc length along the line. */
export function projectOntoPolyline(line: readonly Point[], p: Point): { d: number; point: Point; dist: number } {
  let best = { d: 0, point: line[0] ? ([line[0][0], line[0][1]] as Point) : ([p[0], p[1]] as Point), dist: Infinity };
  let run = 0;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]!;
    const b = line[i]!;
    const c = closestOnSegment(p, a, b);
    const len = distance(a, b);
    const dd = distance(p, c.point);
    if (dd < best.dist) best = { d: run + c.t * len, point: c.point, dist: dd };
    run += len;
  }
  return best;
}

/** The part of a polyline between arc lengths d0 and d1 (reversed when d1 < d0), ends included. */
export function subPolyline(line: readonly Point[], d0: number, d1: number): Point[] {
  if (line.length === 0) return [];
  const cum = cumulativeLengths(line);
  const lo = Math.min(d0, d1);
  const hi = Math.max(d0, d1);
  const out: Point[] = [pointAt(line, lo, cum)];
  for (let i = 0; i < line.length; i++) if (cum[i]! > lo + EPS && cum[i]! < hi - EPS) out.push([line[i]![0], line[i]![1]]);
  out.push(pointAt(line, hi, cum));
  return d1 < d0 ? out.reverse() : out;
}
