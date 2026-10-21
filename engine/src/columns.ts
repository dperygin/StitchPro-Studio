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
  roundHalfEven,
  valueAt,
  vertexAngleDeg,
} from './path';
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
}

const EPS = 1e-9;
const PHI = 0.6180339887498949;

/** mulberry32: a seeded 32-bit pseudo-random generator; returns the first value in [0, 1). */
export function mulberry32(seed: number): number {
  let a = (seed | 0) + 0x6d2b79f5;
  a |= 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
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

  if (closed) line = moveSeam(line, s, legCorners(line, s, true));
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

  const ragged = (d: number, side: 0 | 1, w: number): number => {
    if (s.raggedMode === 'none') return 0;
    const amount =
      s.raggedMode === 'periodic'
        ? s.raggedAmount * (0.5 - 0.5 * Math.cos(2 * Math.PI * (d / s.raggedPeriod + side / 2)))
        : s.raggedAmount * mulberry32(roundHalfEven(d * 1000) * 2 + side);
    return Math.min(amount, 0.9 * (w / 2));
  };
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

/** Satin and zigzag: one needle point per rung, alternating edges. */
function alternate(rungs: Rung[], s: StitchSettings, satin: boolean, opts: ColumnOptions): Point[] {
  const firstSide = opts.firstSide ?? 0;
  const pts: Point[] = [];
  const sides: (0 | 1)[] = [];
  const shortened: boolean[] = [];
  rungs.forEach((r, i) => {
    const side = ((i + firstSide) % 2) as 0 | 1;
    let p = rungEnd(r, side);
    let short = false;
    if (satin && s.stitchShortening && i >= 2 && !shortened[i - 2]) {
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
  return satin && s.autoSplit ? autoSplit(pts, s.splitLength) : pts;
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
  return alternate(rungs, s, kind === 'satin', opts);
}
