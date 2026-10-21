// Tatami fill, radial fill, fill underlay, travel.
//
// Tatami works in a frame rotated by -fillAngle so rows are horizontal. Rows lie on a global
// grid y = r x spacing (row number r counted from y = 0, so neighbouring objects line up),
// scanlines split the shape into sections, each section is sewn back and forth, and moves
// between sections travel inside the shape (or along its edge) or jump.
// A jump is marked by the landing point repeated: it appears JUMP_MARK times in a row.

import { mulberry32 } from './columns';
import { offsetOutlines, pointInRegion, regionRings, type Polygon, type Region, type Ring } from './geometry';
import { closestOnSegment, cumulativeLengths, distance, floorMod, pointAt, resampleKeepingCorners } from './path';
import { runningStitch } from './stitchlib';
import type { FillPattern, Point, StitchSettings } from './types';

const EPS = 1e-9;
/** How many times a jump's landing point is written in a row. */
export const JUMP_MARK = 3;
/** Travel stitch length, mm. */
export const TRAVEL_STITCH = 2.5;

export interface TatamiParams {
  /** Row direction, degrees. */
  angle: number;
  /** Distance between neighbouring (sewn) rows, mm. */
  rowSpacing: number;
  stitchLength: number;
  stagger: boolean;
  pattern: FillPattern;
  embossWidth: number;
  embossHeight: number;
  /** Extends (or, negative, shortens) every row end, mm. */
  pull: number;
  /** Travel along the edge avoiding sewn rows (top layer). */
  travelOnEdge: boolean;
  entry: Point | null;
  exit: Point | null;
}

/** Tatami parameters for the top layer of an object (settings already have sewn spacing). */
export function tatamiParams(s: StitchSettings, entry: Point | null = null, exit: Point | null = null): TatamiParams {
  return {
    angle: s.fillAngle,
    rowSpacing: s.fillRowSpacing,
    stitchLength: s.fillStitchLength,
    stagger: s.fillStagger,
    pattern: s.fillPattern,
    embossWidth: s.embossWidth,
    embossHeight: s.embossHeight,
    pull: s.pullCompensation,
    travelOnEdge: s.travelOnEdge,
    entry,
    exit,
  };
}

// ---- rotation ----

function rotator(deg: number): (p: Point) => Point {
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return (p) => [p[0] * c - p[1] * s, p[0] * s + p[1] * c];
}

const rotateRegion = (region: Region, f: (p: Point) => Point): Region =>
  region.map((poly) => ({ outer: poly.outer.map(f), holes: poly.holes.map((h) => h.map(f)) }));

// ---- scanline sections ----

export interface Row {
  /** Row number: y = r x spacing (before any nudge). */
  r: number;
  y: number;
  x0: number;
  x1: number;
}

export type Section = Row[];

function polyRings(poly: Polygon): Ring[] {
  return [poly.outer, ...poly.holes];
}

/** Even-odd spans of a horizontal line through the rings. */
function spansAt(rings: readonly Ring[], y: number): [number, number][] {
  const xs: number[] = [];
  for (const ring of rings) {
    for (let i = 1; i < ring.length; i++) {
      const a = ring[i - 1]!;
      const b = ring[i]!;
      if (a[1] > y !== b[1] > y) xs.push(a[0] + ((y - a[1]) * (b[0] - a[0])) / (b[1] - a[1]));
    }
  }
  xs.sort((p, q) => p - q);
  const out: [number, number][] = [];
  for (let k = 0; k + 1 < xs.length; k += 2) if (xs[k + 1]! - xs[k]! > EPS) out.push([xs[k]!, xs[k + 1]!]);
  return out;
}

/**
 * Splits a polygon (already rotated so rows are horizontal) into sections. A row's span joins
 * the section above only when the two overlap one-to-one; otherwise a new section starts.
 */
export function scanSections(poly: Polygon, spacing: number): Section[] {
  const rings = polyRings(poly).filter((r) => r.length >= 4);
  if (!rings.length || !(spacing > 0)) return [];
  const ys = rings.flat().map((p) => p[1]);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const flatYs: number[] = [];
  for (const ring of rings) for (let i = 1; i < ring.length; i++) if (Math.abs(ring[i]![1] - ring[i - 1]![1]) <= EPS) flatYs.push(ring[i]![1]);

  const sections: Section[] = [];
  let open: { section: number; span: [number, number] }[] = [];
  for (let r = Math.ceil(minY / spacing - EPS) + 0; r * spacing <= maxY + EPS; r++) {
    let y = r * spacing;
    if (flatYs.some((fy) => Math.abs(fy - y) <= 1e-7)) y += 1e-6; // nudge off horizontal edges
    const spans = spansAt(rings, y);
    const overlaps = (a: [number, number], b: [number, number]) => a[0] < b[1] && b[0] < a[1];
    const next: typeof open = [];
    for (const span of spans) {
      const above = open.filter((o) => overlaps(o.span, span));
      const one = above.length === 1 && spans.filter((sp) => overlaps(above[0]!.span, sp)).length === 1;
      const section = one ? above[0]!.section : sections.push([]) - 1;
      sections[section]!.push({ r, y, x0: span[0], x1: span[1] });
      next.push({ section, span });
    }
    open = next;
  }
  return sections.filter((s) => s.length);
}

// ---- needles along a row ----

/** Row phase (fraction of a stitch) per pattern. */
export function rowPhase(pattern: FillPattern, r: number): number {
  const frac = (x: number) => x - Math.floor(x);
  const eighths = (seq: number[]) => seq[floorMod(r, 8)]! / 8;
  const diag = (a: number, b: number) => frac(Math.floor(r / 2) * (a + b) + (floorMod(r, 2) === 1 ? a : 0));
  switch (pattern) {
    case 'quarters':
      return floorMod(r, 4) / 4;
    case 'fifths':
      return floorMod(floorMod(r, 5) * 2, 5) / 5;
    case 'brick':
      return floorMod(r, 2) / 2;
    case 'random':
      return mulberry32(r);
    case 'diagonal':
      return diag(0.3, 0.6);
    case 'diagonal-left':
      return diag(0.7, 0.4);
    case 'chevron':
      return eighths([0, 1, 2, 3, 4, 3, 2, 1]);
    case 'herringbone':
      return eighths([0, 2, 4, 6, 0, 6, 4, 2]);
    case 'basket':
      return eighths([0, 0, 0, 0, 4, 4, 4, 4]);
    default:
      return floorMod(r, 3) / 3; // thirds, and the embossed patterns
  }
}

const EMBOSSED: readonly FillPattern[] = ['diamonds', 'waves', 'zigzag', 'stripes', 'scales'];

/** Where a row at height y crosses the carved shape of an embossed pattern, within (a, b). */
export function carvedCrossings(pattern: FillPattern, y: number, a: number, b: number, W: number, H: number): number[] {
  if (!EMBOSSED.includes(pattern) || !(W > 0) || !(H > 0)) return [];
  const v = floorMod(y, H) / H;
  const out: number[] = [];
  for (let k = Math.floor(a / W) - 1; k <= Math.ceil(b / W) + 1; k++) {
    const x0 = k * W;
    switch (pattern) {
      case 'diamonds':
        out.push(x0 + W * v, x0 + W * (1 - v));
        break;
      case 'waves':
        out.push(x0 + W / 2 + (W / 4) * Math.sin(2 * Math.PI * v));
        break;
      case 'zigzag':
        out.push(x0 + W / 2 + (W / 4) * (1 - 4 * Math.abs(v - 0.5)));
        break;
      case 'stripes':
        out.push(x0);
        break;
      case 'scales': {
        const h = H / 2;
        const band = Math.floor(y / h);
        const vb = (y - band * h) / h;
        const cx = x0 + W / 2 + (floorMod(band, 2) === 1 ? W / 2 : 0);
        const dx = (W / 2) * Math.sqrt(Math.max(0, 1 - vb * vb));
        out.push(cx - dx, cx + dx);
        break;
      }
    }
  }
  return [...new Set(out.filter((x) => x > a && x < b))].sort((p, q) => p - q);
}

/** Needle points of one row from its start to its end (dir 1 = left to right). */
export function rowNeedles(row: Row, dir: 1 | -1, p: TatamiParams): Point[] {
  let a = row.x0 - p.pull;
  let b = row.x1 + p.pull;
  if (b - a < EPS) a = b = (row.x0 + row.x1) / 2;
  const L = p.stitchLength;
  let xs: number[] = [];
  if (b - a > EPS) {
    if (!p.stagger) {
      const n = Math.max(1, Math.ceil((b - a) / L - 1e-9));
      for (let k = 1; k < n; k++) xs.push(a + ((b - a) * k) / n);
    } else {
      const phase = rowPhase(p.pattern, row.r);
      for (let k = Math.ceil(a / L - phase); (k + phase) * L < b; k++) {
        const x = (k + phase) * L;
        if (x - a > L / 4 && b - x > L / 4) xs.push(x);
      }
      for (const cx of carvedCrossings(p.pattern, row.y, a, b, p.embossWidth, p.embossHeight)) {
        if (cx - a <= L / 4 || b - cx <= L / 4) continue;
        // A carved point replaces the grid point beside it.
        let nearest = -1;
        xs.forEach((x, i) => {
          if (Math.abs(x - cx) < L / 2 && (nearest < 0 || Math.abs(x - cx) < Math.abs(xs[nearest]! - cx))) nearest = i;
        });
        if (nearest >= 0) xs.splice(nearest, 1);
        xs.push(cx);
      }
      xs.sort((u, w) => u - w);
    }
  }
  const pts: Point[] = [[a, row.y], ...xs.map((x): Point => [x, row.y])];
  if (b - a > EPS) pts.push([b, row.y]);
  return dir === 1 ? pts : pts.reverse();
}

// ---- rings and travel ----

interface RingPath {
  pts: Ring;
  cum: number[];
  total: number;
}

const ringPath = (pts: Ring): RingPath => {
  const cum = cumulativeLengths(pts);
  return { pts, cum, total: cum[cum.length - 1]! };
};

/** Nearest point of a ring to p, with its arc position. */
function projectOnRing(rp: RingPath, p: Point): { pos: number; point: Point; dist: number } {
  let best = { pos: 0, point: rp.pts[0]!, dist: Infinity };
  for (let i = 1; i < rp.pts.length; i++) {
    const c = closestOnSegment(p, rp.pts[i - 1]!, rp.pts[i]!);
    const d = distance(p, c.point);
    if (d < best.dist) best = { pos: rp.cum[i - 1]! + c.t * (rp.cum[i]! - rp.cum[i - 1]!), point: c.point, dist: d };
  }
  return best;
}

const walkLength = (rp: RingPath, s1: number, s2: number, dir: 1 | -1) =>
  dir === 1 ? floorMod(s2 - s1, rp.total) : floorMod(s1 - s2, rp.total);

/** Points along a ring from arc position s1 to s2 in a direction (both ends included). */
function walkRing(rp: RingPath, s1: number, s2: number, dir: 1 | -1): Point[] {
  const at = (s: number) => pointAt(rp.pts, floorMod(s, rp.total), rp.cum);
  const len = walkLength(rp, s1, s2, dir);
  const out: Point[] = [at(s1)];
  const n = rp.pts.length - 1;
  // Vertices strictly between, in walking order.
  const between: { d: number; p: Point }[] = [];
  for (let i = 0; i < n; i++) {
    const d = dir === 1 ? floorMod(rp.cum[i]! - s1, rp.total) : floorMod(s1 - rp.cum[i]!, rp.total);
    if (d > EPS && d < len - EPS) between.push({ d, p: rp.pts[i]! });
  }
  between.sort((u, w) => u.d - w.d);
  for (const b of between) out.push(b.p);
  out.push(at(s2));
  return out;
}

function shortWalk(rp: RingPath, s1: number, s2: number): Point[] {
  return walkRing(rp, s1, s2, walkLength(rp, s1, s2, 1) <= walkLength(rp, s1, s2, -1) ? 1 : -1);
}

interface Crossing {
  t: number;
  ring: number;
  pos: number;
}

/** Where segment a-b crosses the rings, in order along the segment. */
function segmentCrossings(a: Point, b: Point, rings: readonly RingPath[]): Crossing[] {
  const out: Crossing[] = [];
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  rings.forEach((rp, ri) => {
    for (let i = 1; i < rp.pts.length; i++) {
      const c = rp.pts[i - 1]!;
      const d = rp.pts[i]!;
      const ex = d[0] - c[0];
      const ey = d[1] - c[1];
      const den = dx * ey - dy * ex;
      if (Math.abs(den) <= EPS) continue;
      const t = ((c[0] - a[0]) * ey - (c[1] - a[1]) * ex) / den;
      const u = ((c[0] - a[0]) * dy - (c[1] - a[1]) * dx) / den;
      if (t > EPS && t < 1 - EPS && u >= 0 && u <= 1) out.push({ t, ring: ri, pos: rp.cum[i - 1]! + u * (rp.cum[i]! - rp.cum[i - 1]!) });
    }
  });
  return out.sort((p, q) => p.t - q.t);
}

interface TravelContext {
  piece: Region;
  rings: RingPath[];
  /** Points this close to the outline count as on it (row ends pushed out by pull). */
  tol: number;
  /** Rings inset 0.3 mm, for travel on edge. */
  inset: RingPath[];
  /** Outlines of the sections sewn so far (rotated frame). */
  sewn: SewnOutline[];
  limit: number;
}

const lerp = (a: Point, b: Point, t: number): Point => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

/**
 * Travel from a to b staying inside: straight when the segment is covered, otherwise detour
 * along the edge it hits, the shorter way round (recursive, depth 16). When both ends lie on
 * the same ring and walking it is at most twice as long, the edge is walked.
 */
export function travelInside(
  a: Point,
  b: Point,
  piece: Region,
  rings: RingPath[] = regionRings(piece).map(ringPath),
  tol = 1e-6,
  depth = 0,
): Point[] {
  if (depth === 0) {
    const pa = rings.map((rp) => projectOnRing(rp, a));
    const pb = rings.map((rp) => projectOnRing(rp, b));
    for (let i = 0; i < rings.length; i++) {
      if (pa[i]!.dist <= tol && pb[i]!.dist <= tol) {
        const rp = rings[i]!;
        const s1 = pa[i]!.pos;
        const s2 = pb[i]!.pos;
        if (Math.min(walkLength(rp, s1, s2, 1), walkLength(rp, s1, s2, -1)) <= 2 * distance(a, b) + EPS) {
          return [a, ...shortWalk(rp, s1, s2), b];
        }
      }
    }
  }
  if (depth >= 16) return [a, b];
  const xs = segmentCrossings(a, b, rings);
  const ts = [0, ...xs.map((x) => x.t), 1];
  for (let k = 1; k < ts.length; k++) {
    const mid = lerp(a, b, (ts[k - 1]! + ts[k]!) / 2);
    if (pointInRegion(piece, mid, tol) !== 'outside') continue;
    // The interval (ts[k-1], ts[k]) is outside.
    if (k === 1 || k === ts.length - 1) return [a, b]; // an end lies outside: nothing to follow
    const out = xs[k - 2]!;
    const back = xs[k - 1]!;
    if (out.ring !== back.ring) return [a, b];
    const walk = shortWalk(rings[out.ring]!, out.pos, back.pos);
    const rest = travelInside(walk[walk.length - 1]!, b, piece, rings, tol, depth + 1);
    return [a, ...walk, ...rest.slice(1)];
  }
  return [a, b];
}

function pointInRing(ring: readonly Point[], p: Point): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!;
    const b = ring[j]!;
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

/** A sewn section's outline with its bounding box (checked first: most samples miss it). */
interface SewnOutline {
  ring: Ring;
  box: [number, number, number, number];
}

function sewnOutline(ring: Ring): SewnOutline {
  const xs = ring.map((p) => p[0]);
  const ys = ring.map((p) => p[1]);
  return { ring, box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] };
}

const onSewn = (sewn: readonly SewnOutline[], p: Point) =>
  sewn.some(({ ring, box }) => p[0] >= box[0] && p[0] <= box[2] && p[1] >= box[1] && p[1] <= box[3] && pointInRing(ring, p));

/** Length of a path lying on top of sewn rows, sampled every 0.25 mm. */
function onSewnLength(path: readonly Point[], sewn: readonly SewnOutline[]): number {
  if (!sewn.length) return 0;
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!;
    const b = path[i]!;
    const n = Math.max(1, Math.ceil(distance(a, b) / 0.25));
    const step = distance(a, b) / n;
    for (let k = 0; k < n; k++) {
      const p = lerp(a, b, (k + 0.5) / n);
      if (onSewn(sewn, p)) total += step;
    }
  }
  return total;
}

function covered(a: Point, b: Point, ctx: TravelContext): boolean {
  const inside = (q: Point) => pointInRegion(ctx.piece, q, ctx.tol) !== 'outside';
  if (!inside(a) || !inside(b)) return false;
  const xs = segmentCrossings(a, b, ctx.rings);
  const ts = [0, ...xs.map((x) => x.t), 1];
  for (let k = 1; k < ts.length; k++) if (!inside(lerp(a, b, (ts[k - 1]! + ts[k]!) / 2))) return false;
  return true;
}

/**
 * Travel on edge: walk the edge inset 0.3 mm the short way, the long way, then straight if
 * covered; the first whose length on sewn rows is within the limit wins, otherwise null (a
 * jump). Between different rings: walk to the closest point, hop across, walk on.
 */
function travelOnEdge(a: Point, b: Point, ctx: TravelContext): Point[] | null {
  const candidates: Point[][] = [];
  if (ctx.inset.length) {
    const nearest = (p: Point) =>
      ctx.inset.map((rp, i) => ({ i, ...projectOnRing(rp, p) })).reduce((x, y) => (y.dist < x.dist ? y : x));
    const pa = nearest(a);
    const pb = nearest(b);
    if (pa.i === pb.i) {
      const rp = ctx.inset[pa.i]!;
      const short = walkLength(rp, pa.pos, pb.pos, 1) <= walkLength(rp, pa.pos, pb.pos, -1) ? 1 : -1;
      candidates.push([a, ...walkRing(rp, pa.pos, pb.pos, short), b], [a, ...walkRing(rp, pa.pos, pb.pos, short === 1 ? -1 : 1), b]);
    } else {
      const ra = ctx.inset[pa.i]!;
      const rb = ctx.inset[pb.i]!;
      let hop = { from: 0, to: 0, dist: Infinity };
      for (let k = 0; k < ra.pts.length - 1; k++) {
        const q = projectOnRing(rb, ra.pts[k]!);
        if (q.dist < hop.dist) hop = { from: ra.cum[k]!, to: q.pos, dist: q.dist };
      }
      candidates.push([a, ...shortWalk(ra, pa.pos, hop.from), ...shortWalk(rb, hop.to, pb.pos), b]);
    }
  }
  if (covered(a, b, ctx)) candidates.push([a, b]);
  return candidates.find((path) => onSewnLength(path, ctx.sewn) <= ctx.limit) ?? null;
}

/** Stitches along a travel path (excluding its first point). */
function travelStitches(path: readonly Point[]): Point[] {
  return resampleKeepingCorners(path, TRAVEL_STITCH, { angleBelowDeg: 170 }).slice(1);
}

const jumpTo = (p: Point): Point[] => Array.from({ length: JUMP_MARK }, () => [p[0], p[1]] as Point);

// ---- sewing sections ----

/** The 4 ways to sew a section: [top-down, first row left to right]. Forward first. */
const VARIANTS: readonly [boolean, boolean][] = [
  [true, true],
  [true, false],
  [false, true],
  [false, false],
];

function variantRows(section: Section, v: number): { rows: Row[]; firstDir: 1 | -1 } {
  const [down, ltr] = VARIANTS[v]!;
  return { rows: down ? section : [...section].reverse(), firstDir: ltr ? 1 : -1 };
}

/** Where a variant starts and ends (row ends with pull compensation). */
function variantEnds(section: Section, v: number, pull: number): { start: Point; end: Point } {
  const { rows, firstDir } = variantRows(section, v);
  const first = rows[0]!;
  const last = rows[rows.length - 1]!;
  const lastDir = rows.length % 2 === 1 ? firstDir : -firstDir;
  const start: Point = firstDir === 1 ? [first.x0 - pull, first.y] : [first.x1 + pull, first.y];
  const end: Point = lastDir === 1 ? [last.x1 + pull, last.y] : [last.x0 - pull, last.y];
  return { start, end };
}

/** Section outline (row ends), for "is this on sewn rows" tests. */
function sectionOutline(section: Section, pull: number): SewnOutline {
  const left = section.map((r): Point => [r.x0 - pull, r.y]);
  const right = [...section].reverse().map((r): Point => [r.x1 + pull, r.y]);
  const ring = [...left, ...right];
  ring.push(ring[0]!);
  return sewnOutline(ring);
}

/** Sews a section; a row-to-row move longer than 2 row spacings that is longer than 2 stitches or leaves the shape travels instead. */
function sewSection(section: Section, v: number, p: TatamiParams, ctx: TravelContext): Point[] {
  const { rows, firstDir } = variantRows(section, v);
  const out: Point[] = [];
  rows.forEach((row, i) => {
    const dir = (i % 2 === 0 ? firstDir : -firstDir) as 1 | -1;
    const needles = rowNeedles(row, dir, p);
    if (out.length) {
      const from = out[out.length - 1]!;
      const to = needles[0]!;
      const d = distance(from, to);
      if (d > 2 * p.rowSpacing && (d > 2 * p.stitchLength || !covered(from, to, ctx))) {
        out.push(...travelStitches(travelInside(from, to, ctx.piece, ctx.rings, ctx.tol)).slice(0, -1));
      }
    }
    out.push(...needles);
  });
  return out;
}

interface Choice {
  section: number;
  variant: number;
}

/** Nearest-start variant of a section from p (forward wins ties). */
function nearestVariant(section: Section, p: Point, pull: number): { variant: number; dist: number } {
  let best = { variant: 0, dist: Infinity };
  for (let v = 0; v < 4; v++) {
    const d = distance(p, variantEnds(section, v, pull).start);
    if (d < best.dist - EPS) best = { variant: v, dist: d };
  }
  return best;
}

function sectionNearest(sections: readonly Section[], q: Point): number {
  let best = 0;
  let bestD = Infinity;
  sections.forEach((s, i) => {
    for (const row of [s[0]!, s[s.length - 1]!]) {
      const d = Math.min(distance(q, [row.x0, row.y]), distance(q, [row.x1, row.y]));
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
  });
  return best;
}

/**
 * For up to 10 sections: a depth-first search with backtracking (400 steps, 6 candidates per
 * step, nearest first) for an order where every move can travel off sewn rows, with the
 * section nearest the exit last.
 */
function searchOrder(sections: Section[], start: Point | null, last: number | null, p: TatamiParams, ctx: TravelContext): Choice[] | null {
  let budget = 400;
  const used = new Set<number>();
  const order: Choice[] = [];
  const sewn: SewnOutline[] = [];
  const dfs = (cur: Point | null): boolean => {
    if (order.length === sections.length) return true;
    if (--budget < 0) return false;
    const remaining = sections.map((_, i) => i).filter((i) => !used.has(i) && (i !== last || used.size === sections.length - 1));
    const options = remaining
      .map((i) => ({ i, ...(cur ? nearestVariant(sections[i]!, cur, p.pull) : { variant: 0, dist: 0 }) }))
      .sort((x, y) => x.dist - y.dist)
      .slice(0, 6);
    for (const o of options) {
      const ends = variantEnds(sections[o.i]!, o.variant, p.pull);
      if (cur && !travelOnEdge(cur, ends.start, { ...ctx, sewn })) continue;
      used.add(o.i);
      order.push({ section: o.i, variant: o.variant });
      sewn.push(sectionOutline(sections[o.i]!, p.pull));
      if (dfs(ends.end)) return true;
      used.delete(o.i);
      order.pop();
      sewn.pop();
    }
    return false;
  };
  return dfs(start) ? order : null;
}

/**
 * Greedy nearest section: cost = distance + 1000 if the move lands on sewn rows + distance
 * to the next section + 500 if that next move would cross sewn rows.
 */
function greedyOrder(sections: Section[], start: Point | null, last: number | null, p: TatamiParams, ctx: TravelContext): Choice[] {
  const used = new Set<number>();
  const sewn: SewnOutline[] = [];
  const order: Choice[] = [];
  let cur = start;
  while (order.length < sections.length) {
    const remaining = sections.map((_, i) => i).filter((i) => !used.has(i) && (i !== last || used.size === sections.length - 1));
    let best = { cost: Infinity, section: remaining[0]!, variant: 0 };
    for (const i of remaining) {
      const outline = sectionOutline(sections[i]!, p.pull);
      for (let v = 0; v < 4; v++) {
        const ends = variantEnds(sections[i]!, v, p.pull);
        let cost = 0;
        if (cur) {
          cost += distance(cur, ends.start);
          if (onSewnLength([cur, ends.start], sewn) > ctx.limit) cost += 1000;
        }
        const others = remaining.filter((j) => j !== i);
        if (others.length) {
          let next = { dist: Infinity, to: ends.end };
          for (const j of others) {
            for (let w = 0; w < 4; w++) {
              const to = variantEnds(sections[j]!, w, p.pull).start;
              const d = distance(ends.end, to);
              if (d < next.dist) next = { dist: d, to };
            }
          }
          cost += next.dist;
          if (onSewnLength([ends.end, next.to], [...sewn, outline]) > ctx.limit) cost += 500;
        } else if (p.exit) {
          cost += distance(ends.end, p.exit);
        }
        if (cost < best.cost - EPS) best = { cost, section: i, variant: v };
      }
    }
    used.add(best.section);
    order.push({ section: best.section, variant: best.variant });
    sewn.push(sectionOutline(sections[best.section]!, p.pull));
    cur = variantEnds(sections[best.section]!, best.variant, p.pull).end;
  }
  return order;
}

/**
 * Sews one piece of a fill (rotated frame). Sections are ordered from `orderFrom`; the first
 * section is travelled to from `travelFrom` (the entry) when given.
 */
function sewPiece(poly: Polygon, p: TatamiParams, orderFrom: Point | null, travelFrom: Point | null, exit: Point | null): Point[] {
  const piece: Region = [poly];
  const sections = scanSections(poly, p.rowSpacing);
  if (!sections.length) return [];
  const rings = regionRings(piece).map(ringPath);
  const inset = p.travelOnEdge ? offsetOutlines(piece, -0.3).map(ringPath) : [];
  const ctx: TravelContext = { piece, rings, tol: Math.abs(p.pull) + 0.05, inset, sewn: [], limit: Math.max(1, 2 * p.rowSpacing) };
  const last = exit ? sectionNearest(sections, exit) : null;
  const order =
    (p.travelOnEdge && sections.length > 1 && sections.length <= 10 ? searchOrder(sections, orderFrom, last, p, ctx) : null) ??
    greedyOrder(sections, orderFrom, last, p, ctx);

  const out: Point[] = [];
  for (const { section, variant } of order) {
    const ends = variantEnds(sections[section]!, variant, p.pull);
    const from = out.length ? out[out.length - 1]! : travelFrom;
    if (from && distance(from, ends.start) > EPS) {
      const path = p.travelOnEdge ? travelOnEdge(from, ends.start, ctx) : travelInside(from, ends.start, piece, rings, ctx.tol);
      if (path) out.push(...travelStitches(path).slice(0, -1));
      else out.push(...jumpTo(ends.start).slice(1));
    }
    out.push(...sewSection(sections[section]!, variant, p, ctx));
    ctx.sewn.push(sectionOutline(sections[section]!, p.pull));
  }
  return out;
}

/** Distance from a point to a polygon's outline. */
function distanceToPoly(poly: Polygon, q: Point): number {
  if (pointInRegion([poly], q) !== 'outside') return 0;
  return Math.min(...polyRings(poly).map((r) => projectOnRing(ringPath(r), q).dist));
}

/**
 * One tatami layer. Starts at the entry, finishes at the exit (travelling there if more than
 * 0.3 mm away). Separate pieces are each sewn whole, nearest next, the one with the exit last;
 * a jump between pieces is marked by repeating the landing point.
 */
export function tatamiLayer(region: Region, p: TatamiParams): Point[] {
  const toFrame = rotator(-p.angle);
  const fromFrame = rotator(p.angle);
  const pieces = rotateRegion(region, toFrame).filter((poly) => poly.outer.length >= 4);
  if (!pieces.length) return [];
  const entry = p.entry ? toFrame(p.entry) : null;
  const exit = p.exit ? toFrame(p.exit) : null;
  const fp = { ...p, entry, exit };

  const remaining = pieces.map((_, i) => i);
  const exitPiece = exit ? remaining.reduce((a, b) => (distanceToPoly(pieces[b]!, exit) < distanceToPoly(pieces[a]!, exit) ? b : a)) : null;
  const out: Point[] = entry ? [entry] : [];
  let cur: Point | null = entry;
  while (remaining.length) {
    const candidates = remaining.filter((i) => i !== exitPiece || remaining.length === 1);
    const next = cur
      ? candidates.reduce((a, b) => (distanceToPoly(pieces[b]!, cur!) < distanceToPoly(pieces[a]!, cur!) ? b : a))
      : candidates[0]!;
    remaining.splice(remaining.indexOf(next), 1);
    const first = out.length === (entry ? 1 : 0);
    const sewn = sewPiece(pieces[next]!, fp, cur, first ? entry : null, next === exitPiece ? exit : null);
    if (!sewn.length) continue;
    // Moving to a separate piece: a jump.
    if (!first) out.push(...jumpTo(sewn[0]!).slice(1));
    out.push(...sewn);
    cur = out[out.length - 1]!;
  }
  if (exit && cur && distance(cur, exit) > 0.3) {
    const piece = pieces[exitPiece!]!;
    out.push(...travelStitches(travelInside(cur, exit, [piece], undefined, Math.abs(p.pull) + 0.05)));
  }
  return out.map(fromFrame);
}

/** The top tatami layer of an object. */
export function tatamiFill(region: Region, s: StitchSettings, entry: Point | null = null, exit: Point | null = null): Point[] {
  return tatamiLayer(region, tatamiParams(s, entry, exit));
}

// ---- fill underlay ----

interface FillUnderlayParams {
  angle: number;
  spacing: number;
  inset: number;
  stitchLength: number;
}

function fillUnderlayParams(s: StitchSettings, layer: 1 | 2): FillUnderlayParams {
  return layer === 1
    ? { angle: s.fillAngle + s.underlayAngle, spacing: s.underlaySpacing, inset: s.underlayInset, stitchLength: s.underlayStitchLength }
    : { angle: s.fillAngle + s.underlay2Angle, spacing: s.underlay2Spacing, inset: s.underlay2Inset, stitchLength: s.underlay2StitchLength };
}

/**
 * Tatami underlay: the same generator at fillAngle + underlay angle, row spacing
 * max(0.5, underlay spacing), stitch 4.0, no stagger, row ends pulled in by the inset.
 */
export function tatamiUnderlay(region: Region, s: StitchSettings, layer: 1 | 2 = 1, entry: Point | null = null, exit: Point | null = null): Point[] {
  const u = fillUnderlayParams(s, layer);
  return tatamiLayer(region, {
    angle: u.angle,
    rowSpacing: Math.max(0.5, u.spacing),
    stitchLength: 4.0,
    stagger: false,
    pattern: 'thirds',
    embossWidth: s.embossWidth,
    embossHeight: s.embossHeight,
    pull: -u.inset,
    travelOnEdge: false,
    entry,
    exit,
  });
}

/** Splits stitches longer than `max` into equal parts. */
function splitLong(pts: readonly Point[], max: number): Point[] {
  const out: Point[] = pts.length ? [pts[0]!] : [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const n = Math.ceil(distance(a, b) / max - 1e-9);
    for (let k = 1; k < n; k++) out.push(lerp(a, b, k / n));
    out.push(b);
  }
  return out;
}

/**
 * Fill zigzag underlay: one point per row on alternate sides (rows at the underlay angle and
 * spacing, ends inset), long stitches split at 7 mm; double = a second pass back on the other
 * ends.
 */
export function fillZigzagUnderlay(region: Region, s: StitchSettings, double = false, layer: 1 | 2 = 1): Point[] {
  const u = fillUnderlayParams(s, layer);
  const toFrame = rotator(-u.angle);
  const fromFrame = rotator(u.angle);
  const pieces = rotateRegion(region, toFrame);
  const out: Point[] = [];
  for (const poly of pieces) {
    const piece: Region = [poly];
    const rings = regionRings(piece).map(ringPath);
    for (const section of scanSections(poly, Math.max(0.5, u.spacing))) {
      const end = (row: Row, side: number): Point => {
        const a = Math.min(row.x0 + u.inset, (row.x0 + row.x1) / 2);
        const b = Math.max(row.x1 - u.inset, (row.x0 + row.x1) / 2);
        return side === 0 ? [a, row.y] : [b, row.y];
      };
      const there = section.map((row, k) => end(row, k % 2));
      const pass = double ? [...there, ...[...section].reverse().map((row, k) => end(row, (section.length - 1 - k + 1) % 2))] : there;
      if (out.length) out.push(...travelStitches(travelInside(out[out.length - 1]!, pass[0]!, piece, rings, 0.05)).slice(0, -1));
      out.push(...splitLong(pass, 7));
    }
  }
  return out.map(fromFrame);
}

/** Fill edge run: running stitch round the outline and holes, inset by the underlay inset. */
export function fillEdgeRun(region: Region, s: StitchSettings, layer: 1 | 2 = 1): Point[] {
  const u = fillUnderlayParams(s, layer);
  const rings = offsetOutlines(region, -u.inset);
  const out: Point[] = [];
  for (const ring of rings) {
    const run = runningStitch(ring, { stitchLength: u.stitchLength, runStyle: 'single', stemWidth: 0 });
    if (out.length && run.length) out.push(...travelStitches(travelInside(out[out.length - 1]!, run[0]!, region)).slice(0, -1));
    out.push(...run);
  }
  return out;
}
