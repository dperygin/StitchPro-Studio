// Auto-digitizer: a TrueType letter outline -> draft satin columns.
//
// Scale to a 20 mm capital height, rasterize each shape (0.08 mm pixels), exact Euclidean
// distance transform, Zhang-Suen skeleton, trace the skeleton into a graph, prune spurs, chain
// edges into strokes, smooth and measure widths, split at sharp turns, simplify into Column and
// satin objects; small dots become one short column along their principal axis. Drafts are
// meant to be fixed by hand in the font editor.

import type { NewObject } from './document';
import { pathNode } from './document';
import { nestRings, ringArea, type Polygon } from './geometry';
import { cumulativeLengths, distance, douglasPeucker, lineIntersection, movingAverage, pointAt, vertexAngleDeg } from './path';
import { defaultSettings, type PathNode, type Point } from './types';

export interface AutoDigitizeOptions {
  /** Serif fonts prune spurs harder (0.6 x the junction distance instead of 1.3 x). */
  serif?: boolean;
}

/** Working capital height, mm. */
export const AUTO_CAP_MM = 20;
/** Raster pixel size, mm. */
export const AUTO_PIXEL_MM = 0.08;
const PAD = 3;
const INF = 1e20;

// ---- raster ----

interface Raster {
  w: number;
  h: number;
  /** Design position of pixel (0, 0)'s corner. */
  ox: number;
  oy: number;
  inside: Uint8Array;
}

/** Rasterizes a polygon (even-odd) at pixel centres. */
function rasterize(poly: Polygon): Raster {
  const rings = [poly.outer, ...poly.holes];
  const pts = poly.outer;
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const px = AUTO_PIXEL_MM;
  const ox = Math.min(...xs) - PAD * px;
  const oy = Math.min(...ys) - PAD * px;
  const w = Math.ceil((Math.max(...xs) - ox) / px) + PAD + 1;
  const h = Math.ceil((Math.max(...ys) - oy) / px) + PAD + 1;
  const inside = new Uint8Array(w * h);
  for (let j = 0; j < h; j++) {
    const y = oy + (j + 0.5) * px;
    const hits: number[] = [];
    for (const ring of rings) {
      for (let i = 1; i < ring.length; i++) {
        const a = ring[i - 1]!;
        const b = ring[i]!;
        if (a[1] > y !== b[1] > y) hits.push(a[0] + ((y - a[1]) * (b[0] - a[0])) / (b[1] - a[1]));
      }
    }
    hits.sort((p, q) => p - q);
    for (let k = 0; k + 1 < hits.length; k += 2) {
      const i0 = Math.max(0, Math.ceil((hits[k]! - ox) / px - 0.5));
      const i1 = Math.min(w - 1, Math.floor((hits[k + 1]! - ox) / px - 0.5));
      for (let i = i0; i <= i1; i++) inside[j * w + i] = 1;
    }
  }
  return { w, h, ox, oy, inside };
}

// ---- exact Euclidean distance transform (Felzenszwalb & Huttenlocher) ----

/** 1D squared-distance transform of f (lower envelope of parabolas). */
function edt1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array): void {
  let k = 0;
  v[0] = 0;
  z[0] = -INF;
  z[1] = INF;
  for (let q = 1; q < n; q++) {
    let s = (f[q]! + q * q - (f[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!);
    while (s <= z[k]!) {
      k--;
      s = (f[q]! + q * q - (f[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1]! < q) k++;
    d[q] = (q - v[k]!) * (q - v[k]!) + f[v[k]!]!;
  }
}

/** Distance (in pixels) from each inside pixel to the nearest outside pixel; columns then rows. */
export function distanceTransform(inside: Uint8Array, w: number, h: number): Float64Array {
  const grid = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) grid[i] = inside[i] ? INF : 0;
  const n = Math.max(w, h);
  const f = new Float64Array(n);
  const d = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = grid[y * w + x]!;
    edt1d(f, h, d, v, z);
    for (let y = 0; y < h; y++) grid[y * w + x] = d[y]!;
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = grid[y * w + x]!;
    edt1d(f, w, d, v, z);
    for (let x = 0; x < w; x++) grid[y * w + x] = Math.sqrt(d[x]!);
  }
  return grid;
}

// ---- Zhang-Suen thinning ----

/** Neighbours P2..P9: N, NE, E, SE, S, SW, W, NW. */
const NB: [number, number][] = [
  [0, -1],
  [1, -1],
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
];

/** Zhang-Suen thinning, then deletes staircase corner pixels. */
export function skeletonize(inside: Uint8Array, w: number, h: number): Uint8Array {
  const img = Uint8Array.from(inside);
  const at = (x: number, y: number) => (x >= 0 && y >= 0 && x < w && y < h ? img[y * w + x]! : 0);
  let changed = true;
  while (changed) {
    changed = false;
    for (const step of [0, 1]) {
      const remove: number[] = [];
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (!img[y * w + x]) continue;
          const p = NB.map(([dx, dy]) => at(x + dx, y + dy));
          const b = p.reduce((s, v) => s + v, 0);
          if (b < 2 || b > 6) continue;
          let a = 0;
          for (let k = 0; k < 8; k++) if (!p[k] && p[(k + 1) % 8]) a++;
          if (a !== 1) continue;
          const [p2, , p4, , p6, , p8] = p;
          if (step === 0 ? p2! * p4! * p6! === 0 && p4! * p6! * p8! === 0 : p2! * p4! * p8! === 0 && p2! * p6! * p8! === 0) remove.push(y * w + x);
        }
      }
      for (const i of remove) img[i] = 0;
      if (remove.length) changed = true;
    }
  }
  // Staircase corners: a pixel whose only two neighbours are 4-neighbours at a right angle
  // (they still touch diagonally without it).
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!img[y * w + x]) continue;
      const p = NB.map(([dx, dy]) => at(x + dx, y + dy));
      if (p.reduce((s, v) => s + v, 0) !== 2) continue;
      const [n, , e, , s, , wst] = p;
      if ((n && e) || (e && s) || (s && wst) || (wst && n)) img[y * w + x] = 0;
    }
  }
  return img;
}

// ---- skeleton graph ----

interface Edge {
  /** Pixel indices from one node to the other (both node pixels included when present). */
  path: number[];
  a: number;
  b: number;
  alive: boolean;
}

interface Graph {
  edges: Edge[];
  /** Node cluster of each node pixel. */
  clusterOf: Map<number, number>;
  clusterCount: number;
  loops: number[][];
}

function neighbours(img: Uint8Array, w: number, h: number, i: number): number[] {
  const x = i % w;
  const y = (i - x) / w;
  const out: number[] = [];
  for (const [dx, dy] of NB) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx >= 0 && ny >= 0 && nx < w && ny < h && img[ny * w + nx]) out.push(ny * w + nx);
  }
  return out;
}

/** Nodes = clusters of pixels whose neighbour count isn't 2; edges = runs between; loops = cycles. */
function traceGraph(img: Uint8Array, w: number, h: number): Graph {
  const count = new Map<number, number>();
  for (let i = 0; i < w * h; i++) if (img[i]) count.set(i, neighbours(img, w, h, i).length);
  const isNode = (i: number) => count.get(i) !== 2;
  const clusterOf = new Map<number, number>();
  let clusters = 0;
  for (const [i] of count) {
    if (!isNode(i) || clusterOf.has(i)) continue;
    const stack = [i];
    clusterOf.set(i, clusters);
    while (stack.length) {
      const p = stack.pop()!;
      for (const q of neighbours(img, w, h, p)) {
        if (isNode(q) && !clusterOf.has(q)) {
          clusterOf.set(q, clusters);
          stack.push(q);
        }
      }
    }
    clusters++;
  }
  const visited = new Set<number>();
  const edges: Edge[] = [];
  for (const [p, c] of clusterOf) {
    for (const q of neighbours(img, w, h, p)) {
      if (clusterOf.has(q)) {
        if (clusterOf.get(q)! > c) edges.push({ path: [p, q], a: c, b: clusterOf.get(q)!, alive: true });
        continue;
      }
      if (visited.has(q)) continue;
      const path = [p, q];
      visited.add(q);
      let prev = p;
      let cur = q;
      for (;;) {
        const next = neighbours(img, w, h, cur).find((n) => n !== prev && !visited.has(n) && !(clusterOf.has(n) && path.length < 3 && n === p));
        if (next === undefined) break;
        path.push(next);
        if (clusterOf.has(next)) break;
        visited.add(next);
        prev = cur;
        cur = next;
      }
      const end = path[path.length - 1]!;
      if (clusterOf.has(end)) edges.push({ path, a: c, b: clusterOf.get(end)!, alive: true });
    }
  }
  // Plain loops: rings of 2-neighbour pixels never reached from a node.
  const loops: number[][] = [];
  for (const [i] of count) {
    if (isNode(i) || visited.has(i)) continue;
    const loop = [i];
    visited.add(i);
    let cur = i;
    for (;;) {
      const next = neighbours(img, w, h, cur).find((n) => !visited.has(n));
      if (next === undefined) break;
      loop.push(next);
      visited.add(next);
      cur = next;
    }
    if (loop.length > 3) loops.push(loop);
  }
  return { edges, clusterOf, clusterCount: clusters, loops };
}

function degrees(g: Graph): number[] {
  const deg = new Array<number>(g.clusterCount).fill(0);
  for (const e of g.edges) {
    if (!e.alive) continue;
    deg[e.a]!++;
    deg[e.b]!++;
  }
  return deg;
}

/** Up to 4 passes removing dead-end edges at junctions shorter than max(4, factor x the junction's distance). */
function pruneSpurs(g: Graph, dist: Float64Array, factor: number): void {
  const clusterDist = new Array<number>(g.clusterCount).fill(0);
  for (const [p, c] of g.clusterOf) clusterDist[c] = Math.max(clusterDist[c]!, dist[p]!);
  for (let pass = 0; pass < 4; pass++) {
    const deg = degrees(g);
    let removed = false;
    for (const e of g.edges) {
      if (!e.alive) continue;
      const [tip, junction] = deg[e.a] === 1 ? [e.a, e.b] : deg[e.b] === 1 ? [e.b, e.a] : [-1, -1];
      if (tip < 0 || deg[junction]! < 3) continue;
      if (e.path.length < Math.max(4, factor * clusterDist[junction]!)) {
        e.alive = false;
        deg[junction]!--;
        deg[tip]!--;
        removed = true;
      }
    }
    if (!removed) break;
  }
}

interface StrokePx {
  pixels: number[];
  closed: boolean;
  /** Whether each end is a free (dead) end of the skeleton. */
  freeStart: boolean;
  freeEnd: boolean;
}

/** Chains edges into strokes: straight through 2-way nodes; at junctions the most opposite ends pair (dot < -0.6). */
function chainStrokes(g: Graph, w: number): StrokePx[] {
  const deg = degrees(g);
  const alive = g.edges.filter((e) => e.alive);
  const xy = (i: number): Point => [i % w, Math.floor(i / w)];
  // End k of edge e: 0 = its start (node a), 1 = its end (node b).
  const endDir = (e: Edge, k: 0 | 1): Point => {
    const path = k === 0 ? e.path : [...e.path].reverse();
    const a = xy(path[0]!);
    const b = xy(path[Math.min(5, path.length - 1)]!);
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
  };
  const pairOf = new Map<string, [Edge, 0 | 1]>();
  const key = (e: Edge, k: number) => `${alive.indexOf(e)}:${k}`;
  for (let c = 0; c < g.clusterCount; c++) {
    const ends: [Edge, 0 | 1][] = [];
    for (const e of alive) {
      if (e.a === c) ends.push([e, 0]);
      if (e.b === c) ends.push([e, 1]);
    }
    if (ends.length < 2) continue;
    const pairs: { i: number; j: number; dot: number }[] = [];
    for (let i = 0; i < ends.length; i++) {
      for (let j = i + 1; j < ends.length; j++) {
        const [di, dj] = [endDir(ends[i]![0], ends[i]![1]), endDir(ends[j]![0], ends[j]![1])];
        pairs.push({ i, j, dot: di[0] * dj[0] + di[1] * dj[1] });
      }
    }
    pairs.sort((p, q) => p.dot - q.dot);
    const used = new Set<number>();
    for (const p of pairs) {
      // A 2-way node passes straight through; at junctions only near-opposite ends pair.
      if (used.has(p.i) || used.has(p.j) || (ends.length > 2 && p.dot >= -0.6)) continue;
      used.add(p.i);
      used.add(p.j);
      pairOf.set(key(ends[p.i]![0], ends[p.i]![1]), ends[p.j]!);
      pairOf.set(key(ends[p.j]![0], ends[p.j]![1]), ends[p.i]!);
    }
  }
  const done = new Set<Edge>();
  const strokes: StrokePx[] = [];
  for (const start of alive) {
    if (done.has(start)) continue;
    done.add(start);
    // Walk forward from the start edge's end, then backward from its start.
    let pixels = [...start.path];
    let closed = false;
    let cur: [Edge, 0 | 1] = [start, 1];
    for (;;) {
      const next = pairOf.get(key(cur[0], cur[1]));
      if (!next) break;
      if (next[0] === start) {
        closed = true;
        break;
      }
      if (done.has(next[0])) break;
      done.add(next[0]);
      const path = next[1] === 0 ? next[0].path : [...next[0].path].reverse();
      pixels = [...pixels, ...path.slice(1)];
      cur = [next[0], next[1] === 0 ? 1 : 0];
    }
    const endNode = cur[1] === 0 ? cur[0].a : cur[0].b;
    let back: [Edge, 0 | 1] = [start, 0];
    if (!closed) {
      for (;;) {
        const next = pairOf.get(key(back[0], back[1]));
        if (!next || done.has(next[0])) break;
        done.add(next[0]);
        const path = next[1] === 0 ? [...next[0].path].reverse() : next[0].path;
        pixels = [...path.slice(0, -1), ...pixels];
        back = [next[0], next[1] === 0 ? 1 : 0];
      }
    }
    const startNode = back[1] === 0 ? back[0].a : back[0].b;
    strokes.push({ pixels, closed, freeStart: !closed && deg[startNode] === 1, freeEnd: !closed && deg[endNode] === 1 });
  }
  for (const loop of g.loops) strokes.push({ pixels: loop, closed: true, freeStart: false, freeEnd: false });
  return strokes;
}

// ---- strokes in mm ----

interface Stroke {
  pts: Point[];
  widths: number[];
  closed: boolean;
  freeStart: boolean;
  freeEnd: boolean;
}

/** Where the ray p + t d first meets the polygon's outline (t > 0), or null. */
function rayToEdge(poly: Polygon, p: Point, d: Point, maxT: number): number | null {
  let best: number | null = null;
  const far: Point = [p[0] + d[0], p[1] + d[1]];
  for (const ring of [poly.outer, ...poly.holes]) {
    for (let i = 1; i < ring.length; i++) {
      const hit = lineIntersection(p, far, ring[i - 1]!, ring[i]!);
      if (!hit || hit.t <= 1e-6 || hit.u < 0 || hit.u > 1 || hit.t > maxT) continue;
      if (best === null || hit.t < best) best = hit.t;
    }
  }
  return best;
}

/** Runs an end of a stroke straight on to the letter's edge. */
function runOn(s: Stroke, poly: Polygon, atStart: boolean): void {
  if (s.pts.length < 2) return;
  const [end, prev, w] = atStart ? [s.pts[0]!, s.pts[Math.min(3, s.pts.length - 1)]!, s.widths[0]!] : [s.pts[s.pts.length - 1]!, s.pts[Math.max(0, s.pts.length - 4)]!, s.widths[s.widths.length - 1]!];
  const l = distance(prev, end);
  if (l < 1e-9) return;
  const d: Point = [(end[0] - prev[0]) / l, (end[1] - prev[1]) / l];
  const t = rayToEdge(poly, end, d, Math.max(1, 3 * w));
  if (t === null || t < 0.02) return;
  const p: Point = [end[0] + d[0] * t, end[1] + d[1] * t];
  if (atStart) {
    s.pts.unshift(p);
    s.widths.unshift(w);
  } else {
    s.pts.push(p);
    s.widths.push(w);
  }
}

/** Splits strokes at turns sharper than 75 degrees (measured over 0.75 x width). */
function splitAtCorners(s: Stroke, poly: Polygon): Stroke[] {
  if (s.closed || s.pts.length < 5) return [s];
  const cum = cumulativeLengths(s.pts);
  const total = cum[cum.length - 1]!;
  const turns = s.pts.map((p, i) => {
    const r = Math.max(0.25, 0.75 * s.widths[i]!);
    if (cum[i]! - r < 0 || cum[i]! + r > total) return 0;
    return 180 - vertexAngleDeg(pointAt(s.pts, cum[i]! - r, cum), p, pointAt(s.pts, cum[i]! + r, cum));
  });
  const cuts: { i: number; turn: number; r: number }[] = [];
  let run: { i: number; turn: number; r: number }[] = [];
  const flush = () => {
    if (run.length) cuts.push(run.reduce((a, b) => (b.turn > a.turn ? b : a)));
    run = [];
  };
  turns.forEach((t, i) => (t > 75 ? run.push({ i, turn: t, r: Math.max(0.25, 0.75 * s.widths[i]!) }) : flush()));
  flush();
  if (!cuts.length) return [s];
  const pieces: Stroke[] = [];
  let from = 0;
  let freeStart = s.freeStart;
  let startsAfterCorner: { r: number; v: boolean } | null = null;
  for (const c of [...cuts, null]) {
    const to = c ? c.i : s.pts.length - 1;
    // Trim the rounded bit: points within r of the cut on both sides.
    const lo = startsAfterCorner ? cum[from]! + startsAfterCorner.r : cum[from]!;
    const hi = c ? cum[to]! - c.r : cum[to]!;
    const idx = s.pts.map((_, i) => i).filter((i) => i >= from && i <= to && cum[i]! >= lo - 1e-9 && cum[i]! <= hi + 1e-9);
    if (idx.length >= 2) {
      const piece: Stroke = { pts: idx.map((i) => s.pts[i]!), widths: idx.map((i) => s.widths[i]!), closed: false, freeStart, freeEnd: c ? false : s.freeEnd };
      // The piece ending at a corner runs on to the edge; at V corners (> 100 degrees) the next does too.
      if (c) runOn(piece, poly, false);
      if (startsAfterCorner?.v) runOn(piece, poly, true);
      pieces.push(piece);
    }
    if (c) {
      startsAfterCorner = { r: c.r, v: c.turn > 100 };
      from = c.i;
      freeStart = false;
    }
  }
  return pieces.length ? pieces : [s];
}

/** Nodes of a stroke: RDP (0.06 mm), corner nodes at sharp turns, widths from the nearest measured width. */
function strokeNodes(s: Stroke): PathNode[] {
  const pts = s.closed ? [...s.pts, s.pts[0]!] : s.pts;
  let simple = douglasPeucker(pts, 0.06);
  if (s.closed) simple = simple.slice(0, -1);
  const n = simple.length;
  return simple.map((p, i) => {
    let best = 0;
    s.pts.forEach((q, j) => (distance(q, p) < distance(s.pts[best]!, p) ? (best = j) : 0));
    const end = !s.closed && (i === 0 || i === n - 1);
    const a = simple[(i - 1 + n) % n]!;
    const c = simple[(i + 1) % n]!;
    const sharp = !end && vertexAngleDeg(a, p, c) < 150;
    return pathNode(p[0], p[1], end || sharp ? 'corner' : 'curve', Math.max(0.2, s.widths[best]!));
  });
}

/** An open stroke as a Column: paired rails half the width either side, widened at turns (1 / cos, at most x 2). */
function columnOf(nodes: PathNode[]): NewObject {
  const r1: PathNode[] = [];
  const r2: PathNode[] = [];
  nodes.forEach((nd, i) => {
    const a = nodes[Math.max(0, i - 1)]!;
    const b = nodes[Math.min(nodes.length - 1, i + 1)]!;
    const dirIn = norm([nd.x - a.x, nd.y - a.y]) ?? norm([b.x - nd.x, b.y - nd.y]) ?? [1, 0];
    const dirOut = norm([b.x - nd.x, b.y - nd.y]) ?? dirIn;
    const nIn: Point = [dirIn[1], -dirIn[0]];
    const nOut: Point = [dirOut[1], -dirOut[0]];
    const bis = norm([nIn[0] + nOut[0], nIn[1] + nOut[1]]) ?? nIn;
    const cosHalf = bis[0] * nIn[0] + bis[1] * nIn[1];
    const h = ((nd.width ?? 1) / 2) * Math.min(2, 1 / Math.max(0.5, cosHalf));
    r1.push(pathNode(nd.x + bis[0] * h, nd.y + bis[1] * h, nd.type));
    r2.push(pathNode(nd.x - bis[0] * h, nd.y - bis[1] * h, nd.type));
  });
  return { stitchType: 'radial_satin', points: r1, rail2: r2, closed: false, name: 'Column' };
}

function norm(v: Point): Point | null {
  const l = Math.hypot(v[0], v[1]);
  return l > 1e-9 ? [v[0] / l, v[1] / l] : null;
}

/** A dot: one short column along the outline's principal axis (PCA), as wide as the blob at each step. */
function blobColumn(poly: Polygon): NewObject | null {
  const pts = poly.outer.slice(0, -1);
  if (pts.length < 3) return null;
  const mx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const my = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (const [x, y] of pts) {
    sxx += (x - mx) ** 2;
    sxy += (x - mx) * (y - my);
    syy += (y - my) ** 2;
  }
  // Principal axis of the covariance matrix.
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const u: Point = [Math.cos(theta), Math.sin(theta)];
  const v: Point = [-u[1], u[0]];
  const along = pts.map((p) => (p[0] - mx) * u[0] + (p[1] - my) * u[1]);
  const lo = Math.min(...along);
  const hi = Math.max(...along);
  const steps = Math.max(3, Math.ceil((hi - lo) / 0.5));
  const r1: PathNode[] = [];
  const r2: PathNode[] = [];
  for (let k = 0; k <= steps; k++) {
    // Sample just inside the ends so the chord across the blob exists.
    const s = lo + (hi - lo) * (0.04 + (0.92 * k) / steps);
    const c: Point = [mx + u[0] * s, my + u[1] * s];
    const ts: number[] = [];
    for (let i = 1; i < poly.outer.length; i++) {
      const hit = lineIntersection(c, [c[0] + v[0], c[1] + v[1]], poly.outer[i - 1]!, poly.outer[i]!);
      if (hit && hit.u >= 0 && hit.u <= 1) ts.push(hit.t);
    }
    if (ts.length < 2) continue;
    const a = Math.min(...ts);
    const b = Math.max(...ts);
    r1.push(pathNode(c[0] + v[0] * b, c[1] + v[1] * b));
    r2.push(pathNode(c[0] + v[0] * a, c[1] + v[1] * a));
  }
  if (r1.length < 2) return null;
  return { stitchType: 'radial_satin', points: r1, rail2: r2, closed: false, name: 'Dot' };
}

function shapeObjects(poly: Polygon, opts: AutoDigitizeOptions): NewObject[] {
  const r = rasterize(poly);
  const dist = distanceTransform(r.inside, r.w, r.h);
  const skel = skeletonize(r.inside, r.w, r.h);
  const g = traceGraph(skel, r.w, r.h);
  pruneSpurs(g, dist, opts.serif ? 0.6 : 1.3);
  const px = AUTO_PIXEL_MM;
  const toMm = (i: number): Point => [r.ox + ((i % r.w) + 0.5) * px, r.oy + (Math.floor(i / r.w) + 0.5) * px];
  const strokes: Stroke[] = chainStrokes(g, r.w)
    .filter((s) => s.pixels.length >= 3)
    .map((s) => ({
      pts: movingAverage(s.pixels.map(toMm), s.closed),
      widths: s.pixels.map((i) => 2 * Math.max(0.5, dist[i]! - 0.5) * px),
      closed: s.closed,
      freeStart: s.freeStart,
      freeEnd: s.freeEnd,
    }));
  const maxWidth = Math.max(0, ...strokes.flatMap((s) => s.widths));
  const skeletonLength = strokes.reduce((sum, s) => sum + (cumulativeLengths(s.pts).at(-1) ?? 0), 0);
  const xs = poly.outer.map((p) => p[0]);
  const ys = poly.outer.map((p) => p[1]);
  const extent = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  // Small blobs (dots): the skeleton is short compared with the shape's width, or (with a hole)
  // the whole shape is barely wider than its band, too tight a loop for a satin.
  const blob = !strokes.length || skeletonLength < 1.5 * Math.max(maxWidth, px) || (poly.holes.length > 0 && extent < 3 * maxWidth);
  if (blob) {
    if (poly.holes.length) {
      return [{ stitchType: 'fill', closed: true, points: poly.outer.slice(0, -1).map(([x, y]) => pathNode(x, y)), holes: poly.holes.map((h) => h.slice(0, -1).map(([x, y]) => pathNode(x, y))), name: 'Fill' }];
    }
    const dot = blobColumn(poly);
    return dot ? [dot] : [];
  }
  const pieces: Stroke[] = [];
  for (const s of strokes) {
    for (const piece of splitAtCorners(s, poly)) {
      if (!piece.closed) {
        if (piece.freeStart) runOn(piece, poly, true);
        if (piece.freeEnd) runOn(piece, poly, false);
      }
      pieces.push(piece);
    }
  }
  // Stubs at busy junctions (no longer than they are wide) are covered by their neighbours.
  const meanWidth = (p: Stroke) => p.widths.reduce((a, b) => a + b, 0) / p.widths.length;
  const kept = pieces.length > 1 ? pieces.filter((p) => p.closed || (cumulativeLengths(p.pts).at(-1) ?? 0) >= meanWidth(p)) : pieces;
  const out: NewObject[] = [];
  for (const piece of kept.length ? kept : pieces) {
    const nodes = strokeNodes(piece);
    if (nodes.length < 2) continue;
    out.push(piece.closed ? { stitchType: 'satin', closed: true, points: nodes, name: 'Satin' } : columnOf(nodes));
  }
  return out;
}

/** Start and end of an object for ordering. */
function ends(o: NewObject): [Point, Point] {
  const p = o.points ?? [];
  const r = o.rail2 ?? [];
  const mid = (i: number): Point => (r[i] ? [(p[i]!.x + r[i]!.x) / 2, (p[i]!.y + r[i]!.y) / 2] : [p[i]!.x, p[i]!.y]);
  return o.closed ? [mid(0), mid(0)] : [mid(0), mid(p.length - 1)];
}

/** Nearest first from the letter's origin, each from its nearer end. */
function sewNearestFirst(objs: NewObject[]): NewObject[] {
  const left = [...objs];
  const out: NewObject[] = [];
  let at: Point = [0, 0];
  while (left.length) {
    let best = 0;
    let bestD = Infinity;
    let flip = false;
    left.forEach((o, i) => {
      const [a, b] = ends(o);
      if (distance(at, a) < bestD) [best, bestD, flip] = [i, distance(at, a), false];
      if (!o.closed && distance(at, b) < bestD) [best, bestD, flip] = [i, distance(at, b), true];
    });
    let o = left.splice(best, 1)[0]!;
    if (flip) o = { ...o, points: [...(o.points ?? [])].reverse(), rail2: [...(o.rail2 ?? [])].reverse() };
    out.push(o);
    at = ends(o)[1];
  }
  return out;
}

/**
 * Turns a letter outline (closed contours in font units, baseline y = 0, y down) into draft
 * stitch objects in the same units: Columns along strokes, satins for loops, a short column for
 * dots, tatami for dots with holes.
 */
export function autodigitize(contours: readonly Point[][], capHeight: number, opts: AutoDigitizeOptions = {}): NewObject[] {
  if (!(capHeight > 0)) return [];
  const k = AUTO_CAP_MM / capHeight;
  const close = (r: Point[]): Point[] => (r.length && distance(r[0]!, r[r.length - 1]!) > 1e-9 ? [...r, r[0]!] : r);
  const rings = contours.map((c) => close(c.map(([x, y]): Point => [x * k, y * k]))).filter((r) => r.length >= 3 && Math.abs(ringArea(r)) > 1e-6);
  const objects = sewNearestFirst(nestRings(rings).flatMap((poly) => shapeObjects(poly, opts)));
  // Back to font units (widths too).
  const back = (n: PathNode): PathNode => ({ ...n, x: n.x / k, y: n.y / k, width: n.width === null ? null : n.width / k });
  return objects.map((o) => ({
    ...o,
    points: (o.points ?? []).map(back),
    rail2: (o.rail2 ?? []).map(back),
    holes: (o.holes ?? []).map((h) => h.map(back)),
    settings: o.stitchType === 'radial_satin' ? defaultSettings({ stitchType: 'radial_satin', pairedRails: true }) : o.settings,
  }));
}
