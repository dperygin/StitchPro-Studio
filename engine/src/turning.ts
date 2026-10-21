// Turning fills (stitch angle lines).
//
// Two or more stitch angle lines bend the rows of a tatami or satin fill. The lines are
// chained, and row s is the straight line interpolated between neighbouring angle lines.
// toLocal maps a point to (x along its row, y = s x spacing): in that straightened frame the
// ordinary fill runs with angle 0, and its stitches are mapped back.

import { tatamiLayer, type TatamiParams } from './fill';
import { polygonFromRings, ringArea, type Region } from './geometry';
import { distance, resampleKeepingCorners } from './path';
import type { Point } from './types';

const EPS = 1e-9;
export type AngleLine = [Point, Point];

const sub = (a: Point, b: Point): Point => [a[0] - b[0], a[1] - b[1]];
const add = (a: Point, b: Point, k = 1): Point => [a[0] + b[0] * k, a[1] + b[1] * k];
const dot = (a: Point, b: Point) => a[0] * b[0] + a[1] * b[1];
const cross = (a: Point, b: Point) => a[0] * b[1] - a[1] * b[0];
const lerp = (a: Point, b: Point, t: number): Point => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const mid = (l: AngleLine): Point => lerp(l[0], l[1], 0.5);
function unit(v: Point): Point | null {
  const n = Math.hypot(v[0], v[1]);
  return n > EPS ? [v[0] / n, v[1] / n] : null;
}

/** The fill angle a single stitch angle line sets, degrees. */
export function angleOfLine(line: AngleLine): number {
  return (Math.atan2(line[1][1] - line[0][1], line[1][0] - line[0][0]) * 180) / Math.PI;
}

/**
 * Orders lines into a chain: start with the line whose middle is farthest from the others,
 * then nearest neighbour; lines are flipped so consecutive ones point the same way.
 */
export function chainLines(lines: readonly AngleLine[]): AngleLine[] {
  const ls = lines.filter((l) => distance(l[0], l[1]) > EPS).map((l): AngleLine => [l[0], l[1]]);
  if (ls.length < 2) return ls;
  const mids = ls.map(mid);
  const spread = mids.map((m) => mids.reduce((sum, o) => sum + distance(m, o), 0));
  let cur = spread.indexOf(Math.max(...spread));
  const left = new Set(ls.map((_, i) => i));
  const out: AngleLine[] = [];
  while (left.size) {
    left.delete(cur);
    let line = ls[cur]!;
    const prev = out[out.length - 1];
    if (prev && dot(sub(line[1], line[0]), sub(prev[1], prev[0])) < 0) line = [line[1], line[0]];
    out.push(line);
    let next = -1;
    for (const j of left) if (next < 0 || distance(mids[cur]!, mids[j]!) < distance(mids[cur]!, mids[next]!)) next = j;
    cur = next;
  }
  return out;
}

/** A straightened frame built from chained angle lines. */
export interface TurningFrame {
  lines: AngleLine[];
  /** Row number of each line. */
  rows: number[];
  spacing: number;
  /** +1 if the frame keeps the orientation of shapes, -1 if it mirrors them. */
  orientation: 1 | -1;
}

/**
 * Builds the frame: between neighbouring lines max(1, round(largest end-to-end distance /
 * spacing)) rows. Null with fewer than two usable lines.
 */
export function turningFrame(lines: readonly AngleLine[], spacing: number): TurningFrame | null {
  const chain = chainLines(lines);
  if (chain.length < 2 || !(spacing > 0)) return null;
  const rows = [0];
  for (let i = 1; i < chain.length; i++) {
    const a = chain[i - 1]!;
    const b = chain[i]!;
    const gap = Math.max(distance(a[0], b[0]), distance(a[1], b[1]));
    rows.push(rows[i - 1]! + Math.max(1, Math.round(gap / spacing)));
  }
  const ex = unit(sub(chain[0]![1], chain[0]![0]))!;
  const ey = sub(mid(chain[1]!), mid(chain[0]!));
  return { lines: chain, rows, spacing, orientation: cross(ex, ey) >= 0 ? 1 : -1 };
}

/** The row line at row number s (interpolated; parallel lines stepping away beyond the ends). */
export function rowLine(f: TurningFrame, s: number): AngleLine {
  const n = f.lines.length;
  const lastRow = f.rows[n - 1]!;
  const away = (line: AngleLine, toward: AngleLine, steps: number): AngleLine => {
    const dir = unit(sub(line[1], line[0]))!;
    let normal: Point = [-dir[1], dir[0]];
    if (dot(normal, sub(mid(line), mid(toward))) < 0) normal = [-normal[0], -normal[1]];
    const shift = steps * f.spacing;
    return [add(line[0], normal, shift), add(line[1], normal, shift)];
  };
  if (s <= 0) return s === 0 ? f.lines[0]! : away(f.lines[0]!, f.lines[1]!, -s);
  if (s >= lastRow) return s === lastRow ? f.lines[n - 1]! : away(f.lines[n - 1]!, f.lines[n - 2]!, s - lastRow);
  let i = 1;
  while (f.rows[i]! < s) i++;
  const t = (s - f.rows[i - 1]!) / (f.rows[i]! - f.rows[i - 1]!);
  const a = f.lines[i - 1]!;
  const b = f.lines[i]!;
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t)];
}

/**
 * Maps p into the frame: the row s whose line passes through p (bisection on the sign of the
 * cross product, 60 iterations or 1e-7), x = projection on the row direction, y = s x spacing.
 * Null when there is no sign change within [sMin, sMax] (the lines cross).
 */
export function toLocal(f: TurningFrame, p: Point, sMin: number, sMax: number): Point | null {
  const side = (s: number) => {
    const [a, b] = rowLine(f, s);
    return cross(sub(b, a), sub(p, a));
  };
  let lo = sMin;
  let hi = sMax;
  let flo = side(lo);
  const fhi = side(hi);
  if (flo === 0) hi = lo;
  else if (fhi === 0) lo = hi;
  else if (flo * fhi > 0) return null;
  for (let k = 0; k < 60 && hi - lo > 1e-7; k++) {
    const m = (lo + hi) / 2;
    const fm = side(m);
    if (fm === 0) {
      lo = hi = m;
      break;
    }
    if (fm * flo < 0) hi = m;
    else {
      lo = m;
      flo = fm;
    }
  }
  const s = (lo + hi) / 2;
  const [a, b] = rowLine(f, s);
  const dir = unit(sub(b, a))!;
  return [dot(sub(p, a), dir), s * f.spacing];
}

/** Maps a frame point back: the point x along row line y / spacing. */
export function fromLocal(f: TurningFrame, q: Point): Point {
  const [a, b] = rowLine(f, q[1] / f.spacing);
  const dir = unit(sub(b, a))!;
  return add(a, dir, q[0]);
}

/**
 * A tatami layer whose rows turn with the stitch angle lines; null when the warp cannot be
 * used (the lines cross, or the mapped shape folds over).
 */
export function turningTatami(region: Region, lines: readonly AngleLine[], p: TatamiParams): Point[] | null {
  const f = turningFrame(lines, p.rowSpacing);
  if (!f || !region.length) return null;
  const all = region.flatMap((poly) => [poly.outer, ...poly.holes]).flat();
  const xs = all.map((q) => q[0]);
  const ys = all.map((q) => q[1]);
  const diag = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  const reach = Math.ceil(diag / p.rowSpacing) + 2;
  const sMin = -reach;
  const sMax = f.rows[f.rows.length - 1]! + reach;

  const mapRing = (ring: Point[]): Point[] | null => {
    const dense = resampleKeepingCorners(ring, 0.5, { closed: true });
    const out: Point[] = [];
    for (const q of dense) {
      const local = toLocal(f, q, sMin, sMax);
      if (!local) return null;
      out.push(local);
    }
    // A flipped orientation means the warp folds this ring over.
    if (Math.sign(ringArea(out)) !== Math.sign(ringArea(ring)) * f.orientation) return null;
    return out;
  };
  const local: Region = [];
  for (const poly of region) {
    const outer = mapRing(poly.outer);
    if (!outer) return null;
    const holes: Point[][] = [];
    for (const h of poly.holes) {
      const m = mapRing(h);
      if (!m) return null;
      holes.push(m);
    }
    local.push(...polygonFromRings(outer, holes));
  }
  const entry = p.entry ? toLocal(f, p.entry, sMin, sMax) : null;
  const exit = p.exit ? toLocal(f, p.exit, sMin, sMax) : null;
  const pts = tatamiLayer(local, { ...p, angle: 0, entry, exit });
  return pts.map((q) => fromLocal(f, q));
}

/**
 * A fill sewn with its stitch angle lines: none = the fill angle; one = that line's angle;
 * two or more turn the rows (falling back to the fill angle when the warp can't be used).
 */
export function fillWithAngles(region: Region, lines: readonly AngleLine[], p: TatamiParams): Point[] {
  const usable = lines.filter((l) => distance(l[0], l[1]) > EPS);
  if (usable.length === 1) return tatamiLayer(region, { ...p, angle: angleOfLine(usable[0]!) });
  if (usable.length >= 2) {
    const turned = turningTatami(region, usable, p);
    if (turned) return turned;
  }
  return tatamiLayer(region, p);
}
