// Satin, zigzag, E stitch, two-rail satin, column.
//
// A column is built in two stages. First the centreline becomes a list of RUNGS: lines
// across the column, square to it, each with its centre, unit "left" normal (left as seen
// on screen, y down) and its extents to the left and right edge. Then the rungs become
// needle points (alternating edges for satin and zigzag; base-tip-base for E stitch).
// Settings arrive with sewn spacing already applied (see sewnSpacing).

import {
  arcPositions,
  cumulativeLengths,
  distance,
  findCorners,
  floorMod,
  lineIntersection,
  materializeDetailed,
  pointAt,
  restartRing,
  roundHalfEven,
  valueAt,
  vertexAngleDeg,
} from './path';
import { ringArea } from './geometry';
import type { PathNode, Point, StitchSettings } from './types';

export interface Rung {
  /** Centre on the centreline. */
  c: Point;
  /** Unit normal pointing to the left edge (side 0). */
  n: Point;
  /** Extent from c to the left edge (side 0) along n; may be negative after clipping. */
  left: number;
  /** Extent from c to the right edge (side 1) along -n. */
  right: number;
  /** Arc length along the whole column, for ragged edges and grading. */
  d: number;
  /** Local sewn spacing at this rung. */
  sp: number;
  /** Part of a corner (clipped, mitre extension or cap fan). */
  corner: boolean;
}

export type ColumnKind = 'satin' | 'zigzag' | 'e_stitch';

export interface ColumnOptions {
  /** Edge of the first needle point: 0 = left, 1 = right. */
  firstSide?: 0 | 1;
  /** Edge the column must end on; one stitch back across is added if needed. */
  lastSide?: 0 | 1;
  /** Raised satin layers: multiplies every width. */
  widthScale?: number;
  /** Raised satin layers: multiplies the spacing. */
  spacingScale?: number;
  /** Closed columns: start at the vertex nearest this point instead of moving the seam. */
  startAt?: Point | null;
}

const EPS = 1e-9;
const PHI = 0.6180339887498949;

/** mulberry32: a seeded 32-bit pseudo-random generator; each call returns the next value in [0, 1). */
export function mulberry32Stream(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The first mulberry32 value for a seed (a repeatable hash of an integer). */
export function mulberry32(seed: number): number {
  return mulberry32Stream(seed)();
}

/**
 * How far a ragged edge pulls the edge point at arc length d in (never more than 0.9 x the
 * half width w / 2): periodic amount x (0.5 - 0.5 cos(2 pi (d / period + side / 2))), or
 * random amount x mulberry32(round(d x 1000) x 2 + side).
 */
export function raggedPull(s: StitchSettings, d: number, side: 0 | 1, w: number): number {
  if (s.raggedMode === 'none') return 0;
  const amount =
    s.raggedMode === 'periodic'
      ? s.raggedAmount * (0.5 - 0.5 * Math.cos(2 * Math.PI * (d / s.raggedPeriod + side / 2)))
      : s.raggedAmount * mulberry32(roundHalfEven(d * 1000) * 2 + side);
  return Math.min(amount, 0.9 * (w / 2));
}

// ---- small vector helpers ----

const sub = (a: Point, b: Point): Point => [a[0] - b[0], a[1] - b[1]];
const add = (a: Point, b: Point, k = 1): Point => [a[0] + b[0] * k, a[1] + b[1] * k];
const dot = (a: Point, b: Point) => a[0] * b[0] + a[1] * b[1];
const cross = (a: Point, b: Point) => a[0] * b[1] - a[1] * b[0];
const lerp = (a: Point, b: Point, t: number): Point => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
function norm(v: Point): Point | null {
  const l = Math.hypot(v[0], v[1]);
  return l > EPS ? [v[0] / l, v[1] / l] : null;
}
/** Screen-left normal of a direction (y down). */
const leftOf = (d: Point): Point => [d[1], -d[0]];
const rotate = (v: Point, a: number): Point => [v[0] * Math.cos(a) - v[1] * Math.sin(a), v[0] * Math.sin(a) + v[1] * Math.cos(a)];

export const rungEnd = (r: Rung, side: 0 | 1): Point => (side === 0 ? add(r.c, r.n, r.left) : add(r.c, r.n, -r.right));

// ---- centreline preparation ----

export interface ColumnLine {
  pts: Point[];
  widths: number[];
  /** Vertices that came from corner nodes (or sharpened bends). */
  corner: boolean[];
}

function cornerThreshold(s: StitchSettings): number {
  return Math.max(s.mitreBelowDeg, s.capBelowDeg);
}

interface Bend {
  i: number;
  d: number;
  angle: number;
  reach: number;
}

/**
 * Finds sharp bends hidden by curve nodes: the angle a-p-c, with a and c `reach` either side,
 * is below the corner threshold and at least 55 % of that turn happens within reach / 3.
 * Keeps the sharpest point of each run and skips points near existing corners.
 */
function findBends(line: ColumnLine, closed: boolean, threshold: number): Bend[] {
  const { pts, widths, corner } = line;
  const cum = cumulativeLengths(pts);
  const total = cum[cum.length - 1]!;
  const at = (d: number) => pointAt(pts, closed ? floorMod(d, total) : d, cum);
  const cornerDs = cum.filter((_, i) => corner[i]);
  const candidates: (Bend | null)[] = pts.map((p, i) => {
    if (closed && i === pts.length - 1) return null;
    const d = cum[i]!;
    const reach = Math.min(4, Math.max(0.8, 0.75 * widths[i]!));
    if (!closed && (d - reach < 0 || d + reach > total)) return null;
    if (corner[i]) return null;
    const angle = vertexAngleDeg(at(d - reach), p, at(d + reach));
    if (angle >= threshold) return null;
    const inner = 180 - vertexAngleDeg(at(d - reach / 3), p, at(d + reach / 3));
    if (inner < 0.55 * (180 - angle)) return null;
    const ringDist = (x: number) => (closed ? Math.min(Math.abs(x - d), total - Math.abs(x - d)) : Math.abs(x - d));
    if (cornerDs.some((cd) => ringDist(cd) < reach)) return null;
    return { i, d, angle, reach };
  });
  const out: Bend[] = [];
  let run: Bend[] = [];
  const flush = () => {
    if (run.length) out.push(run.reduce((a, b) => (b.angle < a.angle ? b : a)));
    run = [];
  };
  candidates.forEach((c) => {
    if (c) run.push(c);
    else flush();
  });
  flush();
  return out;
}

/**
 * Sharpens bends hidden by curve nodes: the rounded stretch (0.6 x reach either side) is
 * replaced by the intersection of the two sides, which becomes a corner vertex. The
 * intersection must lie ahead of both sides and within 2 x reach of the bend.
 */
export function sharpenBends(line: ColumnLine, threshold: number): ColumnLine {
  const { pts, widths, corner } = line;
  const cum = cumulativeLengths(pts);
  const at = (d: number) => pointAt(pts, d, cum);
  const cuts: { d0: number; d1: number; x: Point; w: number }[] = [];
  for (const b of findBends(line, false, threshold)) {
    const d0 = b.d - 0.6 * b.reach;
    const d1 = b.d + 0.6 * b.reach;
    if (cuts.length && d0 <= cuts[cuts.length - 1]!.d1) continue;
    const hit = lineIntersection(at(b.d - b.reach), at(d0), at(d1), at(b.d + b.reach));
    // Ahead of the incoming side (t > 1) and before the outgoing side (u < 0).
    if (!hit || hit.t <= 1 || hit.u >= 0 || distance(hit.point, pts[b.i]!) > 2 * b.reach) continue;
    cuts.push({ d0, d1, x: hit.point, w: widths[b.i]! });
  }
  if (!cuts.length) return line;
  const out: ColumnLine = { pts: [], widths: [], corner: [] };
  const push = (p: Point, w: number, c: boolean) => {
    out.pts.push(p);
    out.widths.push(w);
    out.corner.push(c);
  };
  let k = 0;
  for (let i = 0; i < pts.length; i++) {
    const cut = cuts[k];
    if (cut && cum[i]! >= cut.d0) {
      push(at(cut.d0), valueAt(widths, cum, cut.d0), false);
      push(cut.x, cut.w, true);
      push(at(cut.d1), valueAt(widths, cum, cut.d1), false);
      while (i < pts.length && cum[i]! <= cut.d1) i++;
      i--;
      k++;
      continue;
    }
    push(pts[i]!, widths[i]!, corner[i]!);
  }
  return out;
}

/** Rotates a closed line (first point repeated last) to start at vertex v. */
function rotateRing(line: ColumnLine, v: number): ColumnLine {
  if (v <= 0) return line;
  const rot = <T>(a: T[]): T[] => {
    const body = a.slice(0, -1);
    const r = [...body.slice(v), ...body.slice(0, v)];
    r.push(r[0]!);
    return r;
  };
  return { pts: rot(line.pts), widths: rot(line.widths), corner: rot(line.corner) };
}

/** Rotates a closed line to start at its point nearest p (inserted between vertices if needed). */
function startRingAt(line: ColumnLine, p: Point): ColumnLine {
  const { pts, widths, corner } = line;
  let best = { i: 0, t: 0, d: Infinity, q: pts[0]! };
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const v = sub(b, a);
    const len2 = dot(v, v);
    const t = len2 > 0 ? Math.min(1, Math.max(0, dot(sub(p, a), v) / len2)) : 0;
    const q = add(a, v, t);
    const d = distance(p, q);
    if (d < best.d - EPS) best = { i: i - 1, t, d, q };
  }
  if (best.t <= EPS) return rotateRing(line, best.i);
  if (best.t >= 1 - EPS) return rotateRing(line, (best.i + 1) % (pts.length - 1));
  // Insert the point after vertex best.i, then rotate to it.
  const w = widths[best.i]! + (widths[best.i + 1]! - widths[best.i]!) * best.t;
  const k = best.i + 1;
  const inserted: ColumnLine = {
    pts: [...pts.slice(0, k), best.q, ...pts.slice(k)],
    widths: [...widths.slice(0, k), w, ...widths.slice(k)],
    corner: [...corner.slice(0, k), false, ...corner.slice(k)],
  };
  return rotateRing(inserted, k);
}

/** Moves the seam of a closed line as far as possible from its corners (and hidden bends). */
function moveSeam(line: ColumnLine, s: StitchSettings, cornerIdx: number[]): ColumnLine {
  const cum = cumulativeLengths(line.pts);
  const total = cum[cum.length - 1]!;
  const marks = [...cornerIdx.map((i) => cum[i]!), ...findBends(line, true, cornerThreshold(s)).map((b) => b.d)];
  if (!marks.length || total <= EPS) return line;
  let best = 0;
  let bestGap = -1;
  for (let v = 0; v < line.pts.length - 1; v++) {
    const gap = Math.min(...marks.map((m) => Math.min(Math.abs(cum[v]! - m), total - Math.abs(cum[v]! - m))));
    if (gap > bestGap + EPS) {
      bestGap = gap;
      best = v;
    }
  }
  return rotateRing(line, best);
}

/**
 * Corner vertices that split the centreline into legs, per corner mode (auto: only corners
 * sharper than max(mitreBelowDeg, capBelowDeg)). With `ring`, the line is treated as a closed
 * ring, so its seam can be a corner too.
 */
function legCorners(line: ColumnLine, s: StitchSettings, ring = false): number[] {
  if (s.cornerMode === 'none') return [];
  const last = line.pts.length - 1;
  const candidates = line.corner.map((c, i) => (c ? i : -1)).filter((i) => (ring ? i >= 0 : i > 0) && i < last);
  return findCorners(line.pts, {
    closed: ring,
    candidates,
    angleBelowDeg: s.cornerMode === 'auto' ? cornerThreshold(s) : 179.5,
  });
}

// ---- spacing ----

/** Turn per unit length at each vertex, averaged over a 1 mm window. */
function curvatureProfile(pts: readonly Point[], cum: readonly number[]): number[] {
  const n = pts.length;
  const raw = pts.map((p, i) => {
    if (i === 0 || i === n - 1) return 0;
    const turn = ((180 - vertexAngleDeg(pts[i - 1]!, p, pts[i + 1]!)) * Math.PI) / 180;
    const len = (cum[i + 1]! - cum[i - 1]!) / 2;
    return len > EPS ? turn / len : 0;
  });
  const out = new Array<number>(n);
  let lo = 0;
  let hi = 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    while (hi < n && cum[hi]! <= cum[i]! + 0.5) sum += raw[hi++]!;
    while (cum[lo]! < cum[i]! - 0.5) sum -= raw[lo++]!;
    out[i] = sum / (hi - lo);
  }
  return out;
}

// ---- rungs ----

interface Leg {
  pts: Point[];
  widths: number[];
  cum: number[];
  /** Arc length of the leg start along the whole column. */
  d0: number;
}

interface CornerInfo {
  p: Point;
  w: number;
  dIn: Point;
  dOut: Point;
  /** Mitre line normal; the incoming side keeps (x - p).m <= 0. */
  m: Point;
  mitre: boolean;
  ext: number;
  clipRadius: number;
  d: number;
  sp: number;
}

function legDirection(leg: Leg, atEnd: boolean): Point {
  const len = leg.cum[leg.cum.length - 1]!;
  const reach = Math.min(0.5, len);
  const v = atEnd ? sub(leg.pts[leg.pts.length - 1]!, pointAt(leg.pts, len - reach, leg.cum)) : sub(pointAt(leg.pts, reach, leg.cum), leg.pts[0]!);
  return norm(v) ?? [1, 0];
}

/** Clips a rung to one side of a corner's mitre line; null if nothing is left. */
function clipRung(r: Rung, k: CornerInfo, keepSign: 1 | -1): Rung | null {
  if (distance(r.c, k.p) > k.clipRadius) return r;
  const L = rungEnd(r, 0);
  const R = rungEnd(r, 1);
  const sL = keepSign * dot(sub(L, k.p), k.m);
  const sR = keepSign * dot(sub(R, k.p), k.m);
  if (sL <= EPS && sR <= EPS) return r;
  if (sL > EPS && sR > EPS) return null;
  const x = lerp(L, R, sL / (sL - sR));
  const out = { ...r, corner: true };
  if (sL > EPS) out.left = dot(sub(x, r.c), r.n);
  else out.right = -dot(sub(x, r.c), r.n);
  return out;
}

/**
 * Builds the rungs of a column along a node path.
 */
export function columnRungs(
  nodes: readonly PathNode[],
  closed: boolean,
  s: StitchSettings,
  kind: ColumnKind,
  opts: ColumnOptions = {},
): Rung[] {
  const widthScale = opts.widthScale ?? 1;
  const spacingScale = opts.spacingScale ?? 1;
  const m = materializeDetailed(nodes, closed, s.satinWidth, 0.4);
  if (m.points.length < 2) return [];
  const cornerFlags = m.points.map(() => false);
  nodes.forEach((nd, j) => {
    if (nd.type === 'corner') cornerFlags[m.nodeIndex[j]!] = true;
  });
  if (closed) cornerFlags[m.points.length - 1] = cornerFlags[0]!;
  let line: ColumnLine = { pts: m.points, widths: m.widths.map((w) => w * widthScale), corner: cornerFlags };

  if (closed && opts.startAt) line = startRingAt(line, opts.startAt);
  else if (closed) line = moveSeam(line, s, legCorners(line, s, true));
  if (s.cornerMode !== 'none') line = sharpenBends(line, cornerThreshold(s));

  const cum = cumulativeLengths(line.pts);
  const total = cum[cum.length - 1]!;
  if (total <= EPS) return [];

  // Base spacing (graded for satin) and step function.
  const base =
    kind === 'zigzag' ? s.zigzagSpacing / 2 : kind === 'e_stitch' ? s.eSpacing : s.satinDensity;
  const spacingAt = (D: number) => {
    const g = kind === 'satin' && s.gradedDensity ? s.satinDensity + ((s.gradedEndDensity - s.satinDensity) * D) / total : base;
    return Math.max(0.05, g * spacingScale);
  };

  // Split into legs at corners.
  const cuts = [0, ...legCorners(line, s), line.pts.length - 1];
  const legs: Leg[] = [];
  for (let k = 1; k < cuts.length; k++) {
    const a = cuts[k - 1]!;
    const b = cuts[k]!;
    const pts = line.pts.slice(a, b + 1);
    legs.push({ pts, widths: line.widths.slice(a, b + 1), cum: cumulativeLengths(pts), d0: cum[a]! });
  }

  // Corner geometry between consecutive legs.
  const corners: CornerInfo[] = [];
  for (let k = 1; k < legs.length; k++) {
    const legIn = legs[k - 1]!;
    const legOut = legs[k]!;
    const p = legOut.pts[0]!;
    const w = legOut.widths[0]!;
    const dIn = legDirection(legIn, true);
    const dOut = legDirection(legOut, false);
    const cosT = Math.min(1, Math.max(-1, dot(dIn, dOut)));
    const turn = (Math.acos(cosT) * 180) / Math.PI;
    const angle = 180 - turn;
    const mitre = (s.cornerMode === 'mitre' && turn <= 120) || (s.cornerMode === 'auto' && angle >= s.capBelowDeg);
    const half = w / 2 + s.pullCompensation;
    const D = legOut.d0;
    corners.push({
      p,
      w,
      dIn,
      dOut,
      m: norm(add(dIn, dOut)) ?? leftOf(dIn),
      mitre,
      ext: (half * Math.abs(cross(dIn, dOut))) / (1 + cosT),
      clipRadius: half * 4 + spacingAt(D),
      d: D,
      sp: spacingAt(D),
    });
  }

  const ragged = (d: number, side: 0 | 1, w: number) => raggedPull(s, d, side, w);
  const makeRung = (c: Point, n: Point, w: number, d: number, sp: number, corner = false): Rung => ({
    c,
    n,
    left: w / 2 + s.pullCompensation - ragged(d, 0, w),
    right: w / 2 + s.pullCompensation - ragged(d, 1, w),
    d,
    sp,
    corner,
  });

  const autoSpacing = kind === 'satin' && s.autoSpacing;
  const rungs: Rung[] = [];
  const singleLoop = closed && legs.length === 1;

  legs.forEach((leg, k) => {
    const len = leg.cum[leg.cum.length - 1]!;
    const curv = autoSpacing ? curvatureProfile(leg.pts, leg.cum) : null;
    const step = (d: number) => {
      const sp = spacingAt(leg.d0 + d);
      if (!curv) return sp;
      const w = valueAt(leg.widths, leg.cum, d);
      const outer = Math.min(2.5, 1 + valueAt(curv, leg.cum, d) * (w / 2));
      const narrow = w >= 3 ? 1 : 1 + ((3 - Math.max(w, 1)) / 2) * 0.2;
      return (sp * narrow) / outer;
    };
    let ds = len > EPS ? arcPositions(len, step) : [0];
    if (singleLoop || (closed && k === legs.length - 1)) {
      // The seam is sewn once: drop the closing sample, and a last one crowding it.
      ds = ds.slice(0, -1);
      if (ds.length > 1 && len - ds[ds.length - 1]! < 0.5 * step(len)) ds.pop();
    }
    const centres = ds.map((d) => pointAt(leg.pts, d, leg.cum));
    // Wrap-around neighbours for a closed path with no corners.
    const prevOf = (i: number) => (i > 0 ? centres[i - 1]! : singleLoop ? centres[centres.length - 1]! : null);
    const nextOf = (i: number) => (i < centres.length - 1 ? centres[i + 1]! : singleLoop ? centres[0]! : null);
    const fallback = legDirection(leg, false);

    const kIn = k > 0 ? corners[k - 1]! : null; // corner at the start of this leg
    const kOut = k < corners.length ? corners[k]! : null; // corner at the end

    // Outgoing mitre extension before the leg start.
    if (kIn && kIn.mitre) {
      const n = leftOf(kIn.dOut);
      const ext: number[] = [];
      for (let j = 1; j * kIn.sp <= kIn.ext + 1e-6; j++) ext.push(j * kIn.sp);
      for (const e of ext.reverse()) {
        const r = clipRung(makeRung(add(kIn.p, kIn.dOut, -e), n, kIn.w, kIn.d, kIn.sp, true), kIn, -1);
        if (r) rungs.push(r);
      }
    }

    centres.forEach((c, i) => {
      const a = prevOf(i);
      const b = nextOf(i);
      const dir = norm(sub(b ?? c, a ?? c)) ?? fallback;
      const d = ds[i]!;
      let r: Rung | null = makeRung(c, leftOf(dir), valueAt(leg.widths, leg.cum, d), leg.d0 + d, step(d));
      if (r && kIn) r = clipRung(r, kIn, -1);
      if (r && kOut) r = clipRung(r, kOut, 1);
      if (r) rungs.push(r);
    });

    if (!kOut) return;
    if (kOut.mitre) {
      // Incoming mitre extension past the corner.
      const n = leftOf(kOut.dIn);
      for (let j = 1; j * kOut.sp <= kOut.ext + 1e-6; j++) {
        const r = clipRung(makeRung(add(kOut.p, kOut.dIn, j * kOut.sp), n, kOut.w, kOut.d, kOut.sp, true), kOut, 1);
        if (r) rungs.push(r);
      }
    } else {
      // Cap: a fan of rungs round the outside of the turn.
      const turnsRight = cross(kOut.dIn, kOut.dOut) > 0; // clockwise on screen
      const oIn = turnsRight ? leftOf(kOut.dIn) : add([0, 0], leftOf(kOut.dIn), -1);
      const oOut = turnsRight ? leftOf(kOut.dOut) : add([0, 0], leftOf(kOut.dOut), -1);
      const sweep = Math.atan2(cross(oIn, oOut), dot(oIn, oOut));
      const outerR = kOut.w / 2 + s.pullCompensation;
      const innerR = Math.min(0.5, kOut.w / 4);
      const steps = Math.ceil((outerR * Math.abs(sweep)) / kOut.sp);
      for (let j = 1; j < steps; j++) {
        const o = rotate(oIn, (sweep * j) / steps);
        // Keep side 0 on the left: on a right turn the outer edge is the left one.
        // The inner end sits on a small arc on the inside of the turn.
        const r: Rung = {
          c: kOut.p,
          n: turnsRight ? o : add([0, 0], o, -1),
          left: turnsRight ? outerR : innerR,
          right: turnsRight ? innerR : outerR,
          d: kOut.d,
          sp: kOut.sp,
          corner: true,
        };
        rungs.push(r);
      }
    }
  });

  return s.cornerMode === 'auto' ? rungs.filter((r) => !r.corner || r.left + r.right >= 0.5) : rungs;
}

// ---- needle points ----

interface EdgeRules {
  /** Stitch shortening: crowded ends stop 35 % of the way across from the other end. */
  shorten: boolean;
  /** Auto split long stitches at splitLength. */
  split: boolean;
}

/** One needle point per rung, alternating edges (satin, zigzag, two-rail satin). */
function alternate(rungs: Rung[], s: StitchSettings, rules: EdgeRules, opts: ColumnOptions): Point[] {
  const firstSide = opts.firstSide ?? 0;
  const pts: Point[] = [];
  const sides: (0 | 1)[] = [];
  const shortened: boolean[] = [];
  rungs.forEach((r, i) => {
    const side = ((i + firstSide) % 2) as 0 | 1;
    let p = rungEnd(r, side);
    let short = false;
    if (rules.shorten && i >= 2 && !shortened[i - 2]) {
      if (distance(p, pts[i - 2]!) < 0.6 * (2 * r.sp)) {
        p = lerp(rungEnd(r, (1 - side) as 0 | 1), p, 0.35);
        short = true;
      }
    }
    pts.push(p);
    sides.push(side);
    shortened.push(short);
  });
  if (opts.lastSide !== undefined && rungs.length && sides[sides.length - 1] !== opts.lastSide) {
    pts.push(rungEnd(rungs[rungs.length - 1]!, opts.lastSide));
  }
  return rules.split ? autoSplit(pts, s.splitLength) : pts;
}

/**
 * Auto split: a stitch longer than splitLength gets n - 1 extra points, n = ceil(len /
 * (0.8 x splitLength)), shifted by ((i x 0.618...) mod 1 - 0.5) x 0.5 / n for stitch i
 * (a golden-ratio low-discrepancy sequence, so splits never line up).
 */
export function autoSplit(pts: readonly Point[], splitLength: number): Point[] {
  if (!pts.length) return [];
  const out: Point[] = [pts[0]!];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const len = distance(a, b);
    if (splitLength > 0 && len > splitLength) {
      const n = Math.ceil(len / (0.8 * splitLength));
      const shift = (((i * PHI) % 1) - 0.5) * (0.5 / n);
      for (let k = 1; k < n; k++) out.push(lerp(a, b, k / n + shift));
    }
    out.push(b);
  }
  return out;
}

/** E stitch: per rung base, tip, base (base on the left edge; eFlip swaps). */
function eStitch(rungs: Rung[], s: StitchSettings): Point[] {
  const base: 0 | 1 = s.eFlip ? 1 : 0;
  const tip: 0 | 1 = s.eFlip ? 0 : 1;
  return rungs.flatMap((r) => [rungEnd(r, base), rungEnd(r, tip), rungEnd(r, base)]);
}

/** Needle points of a satin, zigzag or E stitch column along a node path. */
export function columnStitches(
  nodes: readonly PathNode[],
  closed: boolean,
  s: StitchSettings,
  kind: ColumnKind,
  opts: ColumnOptions = {},
): Point[] {
  const rungs = columnRungs(nodes, closed, s, kind, opts);
  if (kind === 'e_stitch') return eStitch(rungs, s);
  const satin = kind === 'satin';
  return alternate(rungs, s, { shorten: satin && s.stitchShortening, split: satin && s.autoSplit }, opts);
}

// ---- two-rail satin and the column tool ----

/** A stretch of the column between two rungs: arc ranges on each rail. */
interface RailPiece {
  a0: number;
  a1: number;
  b0: number;
  b1: number;
  /** The longer rail's length over this piece. */
  len: number;
  /** Column position where the piece starts. */
  u0: number;
}

/** Spacing of the rungs that hold an angle line's direction past the first and last lines, mm. */
const HOLD_STEP = 0.5;

/** Two rails walked together: a column position u maps to one point on each rail. */
export interface RailColumn {
  r1: Point[];
  r2: Point[];
  cum1: number[];
  cum2: number[];
  pieces: RailPiece[];
  /** Column length: the sum of each piece's longer rail. */
  length: number;
  /** Sewn piece by piece between rungs (column tool, stitch angle lines). */
  piecewise: boolean;
}

export interface RailRung {
  /** Point on rail 1. */
  a: Point;
  /** Point on rail 2. */
  b: Point;
  /** Column position. */
  u: number;
}

export function railRungAt(col: RailColumn, u: number): RailRung {
  const { pieces } = col;
  let k = 0;
  while (k < pieces.length - 1 && u > pieces[k]!.u0 + pieces[k]!.len) k++;
  const p = pieces[k]!;
  const t = p.len > EPS ? Math.min(1, Math.max(0, (u - p.u0) / p.len)) : 0;
  return {
    a: pointAt(col.r1, p.a0 + t * (p.a1 - p.a0), col.cum1),
    b: pointAt(col.r2, p.b0 + t * (p.b1 - p.b0), col.cum2),
    u,
  };
}

const lastOf = <T>(a: readonly T[]): T => a[a.length - 1]!;

/** Where the infinite line through p-q crosses a polyline, as arc length; nearest the line's middle. */
function crossingOnRail(p: Point, q: Point, rail: readonly Point[], cum: readonly number[]): number | null {
  const mid = lerp(p, q, 0.5);
  let best: number | null = null;
  let bestDist = Infinity;
  for (let i = 1; i < rail.length; i++) {
    const hit = lineIntersection(p, q, rail[i - 1]!, rail[i]!);
    if (!hit || hit.u < -EPS || hit.u > 1 + EPS) continue;
    const d = distance(hit.point, mid);
    if (d < bestDist) {
      bestDist = d;
      best = cum[i - 1]! + Math.min(1, Math.max(0, hit.u)) * (cum[i]! - cum[i - 1]!);
    }
  }
  return best;
}

export interface RailInput {
  rail1: readonly PathNode[];
  rail2: readonly PathNode[];
  closed: boolean;
  /** Column tool: node i of rail 1 pairs with node i of rail 2. */
  paired: boolean;
  stitchAngles?: readonly [Point, Point][];
}

/**
 * Prepares two rails for sewing. Rail 2 is aligned so its ends are nearest rail 1's ends
 * (closed rails: run the same way round, started nearest rail 1's start). Plain two-rail
 * satin is one piece walked by the same fraction of each rail; Column objects and stitch
 * angle lines cut the rails at rungs into pieces.
 */
export function railColumn(input: RailInput): RailColumn | null {
  let nodes2 = [...input.rail2];
  if (input.rail1.length < 2 || nodes2.length < 2) return null;
  const r1 = materializeDetailed(input.rail1, input.closed);
  let r2 = materializeDetailed(nodes2, input.closed);
  const s1 = r1.points[0]!;
  const e1 = lastOf(r1.points);
  if (input.closed) {
    if (Math.sign(ringArea(r1.points)) !== Math.sign(ringArea(r2.points))) {
      nodes2 = nodes2.reverse();
      r2 = materializeDetailed(nodes2, true);
    }
  } else {
    const straight = distance(s1, r2.points[0]!) + distance(e1, lastOf(r2.points));
    const crossed = distance(s1, lastOf(r2.points)) + distance(e1, r2.points[0]!);
    if (crossed < straight) {
      nodes2 = nodes2.reverse();
      r2 = materializeDetailed(nodes2, false);
    }
  }
  const pts2 = input.closed && !input.paired ? restartRing(r2.points, s1) : r2.points;
  const cum1 = cumulativeLengths(r1.points);
  const cum2 = cumulativeLengths(pts2);
  const L1 = lastOf(cum1);
  const L2 = lastOf(cum2);

  // Rungs as (arc on rail 1, arc on rail 2). Own rungs first: they win any conflict.
  const own: [number, number][] = [];
  if (input.paired) {
    const n = Math.min(input.rail1.length, nodes2.length);
    for (let i = 0; i < n; i++) own.push([cum1[r1.nodeIndex[i]!]!, cum2[r2.nodeIndex[i]!]!]);
    if (input.closed) own.push([L1, L2]);
  } else {
    own.push([0, 0], [L1, L2]);
  }
  const accepted = [...own];
  const at1 = (d: number) => pointAt(r1.points, d, cum1);
  const at2 = (d: number) => pointAt(pts2, d, cum2);
  const tryAdd = (x: number, y: number) => {
    const conflict = accepted.some(
      ([ox, oy]) => distance(at1(x), at1(ox)) < 0.05 || distance(at2(y), at2(oy)) < 0.05 || (x - ox) * (y - oy) < 0,
    );
    if (!conflict) accepted.push([x, y]);
    return !conflict;
  };
  const angleRungs: [number, number][] = [];
  for (const [p, q] of input.stitchAngles ?? []) {
    const x = crossingOnRail(p, q, r1.points, cum1);
    const y = crossingOnRail(p, q, pts2, cum2);
    if (x !== null && y !== null && tryAdd(x, y)) angleRungs.push([x, y]);
  }
  // Past the first and last angle lines the stitches keep that line's angle (an incline holds
  // until the next one), fanning only where the column's end edge forces it.
  if (angleRungs.length && !input.closed && !input.paired) {
    angleRungs.sort((p, q) => p[0] - q[0]);
    const hold = (rung: [number, number], toEnd: boolean) => {
      const dir = sub(at2(rung[1]), at1(rung[0]));
      const [lo1, hi1] = toEnd ? [rung[0], L1] : [0, rung[0]];
      const [lo2, hi2] = toEnd ? [rung[1], L2] : [0, rung[1]];
      for (const d of arcPositions(hi1 - lo1, HOLD_STEP).slice(1, -1)) {
        const p = at1(lo1 + d);
        const y = crossingOnRail(p, add(p, dir), pts2, cum2);
        if (y !== null && y > lo2 && y < hi2) tryAdd(lo1 + d, y);
      }
      for (const e of arcPositions(hi2 - lo2, HOLD_STEP).slice(1, -1)) {
        const p = at2(lo2 + e);
        const x = crossingOnRail(add(p, dir, -1), p, r1.points, cum1);
        if (x !== null && x > lo1 && x < hi1) tryAdd(x, lo2 + e);
      }
    };
    hold(angleRungs[0]!, false);
    hold(angleRungs[angleRungs.length - 1]!, true);
  }
  accepted.sort((p, q) => p[0] - q[0] || p[1] - q[1]);

  const pieces: RailPiece[] = [];
  let u = 0;
  for (let k = 1; k < accepted.length; k++) {
    const [a0, b0] = accepted[k - 1]!;
    const [a1, b1] = accepted[k]!;
    const len = Math.max(a1 - a0, b1 - b0);
    if (len <= EPS) continue;
    pieces.push({ a0, a1, b0, b1, len, u0: u });
    u += len;
  }
  if (!pieces.length) return null;
  return { r1: r1.points, r2: pts2, cum1, cum2, pieces, length: u, piecewise: input.paired || accepted.length > own.length };
}

/** Column positions of the top-stitching rungs. */
function railPositions(col: RailColumn, spacingAt: (u: number) => number): number[] {
  if (!col.piecewise) return arcPositions(col.length, spacingAt);
  // Column method: each piece divided into max(1, round(longer length / spacing)) steps,
  // so the stitch angle turns smoothly from rung to rung.
  const out: number[] = [];
  for (const p of col.pieces) {
    const steps = Math.max(1, roundHalfEven(p.len / spacingAt(p.u0)));
    for (let k = 0; k < steps; k++) out.push(p.u0 + (p.len * k) / steps);
  }
  out.push(col.length);
  return out;
}

/** A rail rung as a column Rung (side 0 on rail 1) with pull compensation and ragged edge. */
function toRung(rr: RailRung, s: StitchSettings, sp: number): Rung {
  const v = sub(rr.a, rr.b);
  const w = Math.hypot(v[0], v[1]);
  const n: Point = w > EPS ? [v[0] / w, v[1] / w] : [1, 0];
  const half = w > EPS ? w / 2 + s.pullCompensation : 0;
  return {
    c: lerp(rr.a, rr.b, 0.5),
    n,
    left: half - raggedPull(s, rr.u, 0, w),
    right: half - raggedPull(s, rr.u, 1, w),
    d: rr.u,
    sp,
    corner: false,
  };
}

/** Rungs of a two-rail satin or Column. */
export function railRungs(col: RailColumn, s: StitchSettings, opts: ColumnOptions = {}): Rung[] {
  const scale = opts.spacingScale ?? 1;
  const spacingAt = (u: number) => {
    const g = s.gradedDensity ? s.satinDensity + ((s.gradedEndDensity - s.satinDensity) * u) / col.length : s.satinDensity;
    return Math.max(0.05, g * scale);
  };
  return railPositions(col, spacingAt).map((u) => toRung(railRungAt(col, u), s, spacingAt(u)));
}

/** Needle points of a two-rail satin (or Column object): stitches alternate rails. */
export function twoRailStitches(input: RailInput, s: StitchSettings, opts: ColumnOptions = {}): Point[] {
  const col = railColumn(input);
  if (!col) return [];
  return alternate(railRungs(col, s, opts), s, { shorten: s.columnShortening, split: s.autoSplit }, opts);
}

// ---- underlay for rails ----

export type RailUnderlayKind = 'center' | 'edge' | 'zigzag' | 'double-zigzag';

interface UnderlayParams {
  spacing: number;
  inset: number;
  stitchLength: number;
  startMargin: number;
  endMargin: number;
  zigzagAngle: number;
}

export function underlayParams(s: StitchSettings, layer: 1 | 2): UnderlayParams {
  return layer === 1
    ? {
        spacing: s.underlaySpacing,
        inset: s.underlayInset,
        stitchLength: s.underlayStitchLength,
        startMargin: s.underlayStartMargin,
        endMargin: s.underlayEndMargin,
        zigzagAngle: s.underlayZigzagAngle,
      }
    : {
        spacing: s.underlay2Spacing,
        inset: s.underlay2Inset,
        stitchLength: s.underlay2StitchLength,
        startMargin: s.underlay2StartMargin,
        endMargin: s.underlay2EndMargin,
        zigzagAngle: s.underlay2ZigzagAngle,
      };
}

/** Shortens a rung by `inset` at both ends, never leaving it under 0.2 mm. */
function insetRung(rr: RailRung, inset: number): RailRung {
  const v = sub(rr.b, rr.a);
  const w = Math.hypot(v[0], v[1]);
  if (w <= 0.2) return rr;
  const i = Math.min(inset, (w - 0.2) / 2);
  return { a: add(rr.a, v, i / w), b: add(rr.b, v, -i / w), u: rr.u };
}

/**
 * Underlay under a two-rail satin or Column: rungs every step along the longer rail, inset
 * at both ends, between the start and end margins.
 * - center: a run down the middle;
 * - edge: down one side (rail 1), back up the other;
 * - zigzag: across the rungs, then a centre run back;
 * - double-zigzag: across the rungs, then a second zigzag back crossing the first.
 * Zigzags slant by the underlay zigzag angle (90 = straight across).
 */
export function railUnderlay(col: RailColumn, s: StitchSettings, kind: RailUnderlayKind, layer: 1 | 2 = 1): Point[] {
  const p = underlayParams(s, layer);
  const u0 = Math.min(p.startMargin, col.length / 2);
  const u1 = Math.max(col.length - p.endMargin, u0);
  const span = u1 - u0;
  const positions = (step: number) => (span > EPS ? arcPositions(span, Math.max(0.05, step)).map((u) => u0 + u) : [u0]);
  const rung = (u: number) => insetRung(railRungAt(col, u), p.inset);
  const middle = (u: number): Point => {
    const r = rung(u);
    return lerp(r.a, r.b, 0.5);
  };
  const runs = positions(p.stitchLength);
  const back = [...runs].reverse();

  if (kind === 'center') return runs.map(middle);
  if (kind === 'edge') return [...runs.map((u) => rung(u).a), ...back.map((u) => rung(u).b)];

  // Slant: the rail-2 end of each zigzag stitch moves along by width / tan(angle).
  const rad = (p.zigzagAngle * Math.PI) / 180;
  const cot = Math.abs(Math.sin(rad)) > EPS ? Math.cos(rad) / Math.sin(rad) : 0;
  const zigzag = (us: number[], startSide: number, dir: 1 | -1): Point[] =>
    us.map((u, k) => {
      const r = rung(u);
      if ((k + startSide) % 2 === 0) return r.a;
      const shifted = Math.min(u1, Math.max(u0, u + dir * distance(r.a, r.b) * cot));
      return rung(shifted).b;
    });
  const zz = positions(p.spacing);
  const forward = zigzag(zz, 0, 1);
  if (kind === 'zigzag') return [...forward, ...back.map(middle)];
  return [...forward, ...zigzag([...zz].reverse(), zz.length % 2, -1)];
}

/**
 * A satin centreline as two rails (its left and right edges, without pull compensation), for
 * underlay and for what the column covers.
 */
export function columnFromCentreline(nodes: readonly PathNode[], closed: boolean, s: StitchSettings): RailColumn | null {
  const m = materializeDetailed(nodes, closed, s.satinWidth, 0.4);
  const n = m.points.length;
  if (n < 2) return null;
  const left: Point[] = [];
  const right: Point[] = [];
  // Edge points are mitred: along the bisector of the neighbouring segments' normals,
  // scaled so both edges stay half a width from each segment (capped at 4x on sharp turns).
  m.points.forEach((c, i) => {
    const prev = i > 0 ? m.points[i - 1]! : closed ? m.points[n - 2]! : null;
    const next = i < n - 1 ? m.points[i + 1]! : closed ? m.points[1]! : null;
    const nIn = prev ? norm(sub(c, prev)) : null;
    const nOut = next ? norm(sub(next, c)) : null;
    const n1 = leftOf(nIn ?? nOut ?? [1, 0]);
    const n2 = leftOf(nOut ?? nIn ?? [1, 0]);
    const bis = norm(add(n1, n2)) ?? n1;
    const scale = Math.min(4, 1 / Math.max(0.25, dot(bis, n1)));
    const h = (m.widths[i]! / 2) * scale;
    left.push(add(c, bis, h));
    right.push(add(c, bis, -h));
  });
  const cum1 = cumulativeLengths(left);
  const cum2 = cumulativeLengths(right);
  const L1 = cum1[n - 1]!;
  const L2 = cum2[n - 1]!;
  const len = Math.max(L1, L2);
  if (len <= EPS) return null;
  return { r1: left, r2: right, cum1, cum2, pieces: [{ a0: 0, a1: L1, b0: 0, b1: L2, len, u0: 0 }], length: len, piecewise: false };
}

/** Average width of a rail column (sampled every 1 mm along it). */
export function averageColumnWidth(col: RailColumn): number {
  const us = arcPositions(col.length, 1);
  return us.reduce((sum, u) => {
    const r = railRungAt(col, u);
    return sum + distance(r.a, r.b);
  }, 0) / us.length;
}
