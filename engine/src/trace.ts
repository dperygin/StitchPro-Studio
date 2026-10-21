// Picture auto-digitizer: a flat-colour picture (logo, clip art) -> traced colour shapes ->
// draft stitch objects.
//
// 1. Reduce the colours (k-means in CIELAB, deterministic), optionally snapped to a thread chart.
// 2. Clean up: one 3 x 3 majority pass, then specks and pinholes smaller than the minimum
//    area are merged into the colour around them.
// 3. Trace each colour's pixels into outlines along the pixel edges (4-connected), nested into
//    shapes with holes; staircases simplified and the outlines smoothed into curve nodes.
// 4. Digitize: thin shapes (no thicker than a satin) become satin columns (the outline auto-digitizer), wide ones
//    tatami; each colour reaches a little under the colours sewn after it so no gaps show.
//
// Plain pixel data in, plain data out (no DOM), so it can run in a Web Worker.

import { autodigitize } from './autodigitize';
import { mulberry32Stream } from './columns';
import type { NewObject, ThreadRef } from './document';
import { bufferRegion, intersection, nestRings, regionArea, unionAll, type Region } from './geometry';
import { douglasPeucker, movingAverage, resamplePolyline } from './path';
import { nearestThread, srgbToLab, type Lab, type Thread } from './threads';
import { defaultSettings, type Point, type RGB } from './types';
import { smoothNodes } from './vector';

/** RGBA pixels, row by row. */
export interface PixelImage {
  width: number;
  height: number;
  data: ArrayLike<number>;
}

/** Where the whole picture lies in the design, mm. */
export interface Placement {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TraceOptions {
  /** Colours to reduce the picture to (2-16). */
  colours: number;
  /** Shapes and holes smaller than this are dropped or filled, mm^2. */
  minArea: number;
  /** Outline smoothing tolerance, mm. */
  smoothing: number;
  /** Leave out the colour that fills most of the picture's border (a plain background). */
  dropBackground: boolean;
  /** Snap the colours to the nearest threads of this chart (and merge equal ones). */
  threads?: readonly Thread[];
  chart?: string;
}

export interface DigitizeOptions {
  /** Shapes no thicker than this (the widest circle inside them, mm) become satin columns; 0 = never. */
  columnMaxWidth: number;
  /** How far each colour reaches under the colours sewn after it, mm. */
  overlap: number;
}

export const DEFAULT_TRACE: Readonly<TraceOptions> = { colours: 6, minArea: 2, smoothing: 0.15, dropBackground: true };
export const DEFAULT_DIGITIZE: Readonly<DigitizeOptions> = { columnMaxWidth: 3.5, overlap: 0.4 };

/** One colour of the traced picture. */
export interface TracedLayer {
  color: RGB;
  thread: ThreadRef | null;
  region: Region;
  /** Area, mm^2. */
  area: number;
}

const TRANSPARENT = 255;
const SAMPLE_PIXELS = 20000;
const KMEANS_ROUNDS = 12;

const labDistance2 = (a: Lab, b: Lab) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

// ---- 1. colours ----

export interface Quantized {
  palette: RGB[];
  /** Palette index per pixel; 255 = transparent. */
  labels: Uint8Array;
}

/** k-means colour reduction in CIELAB (k-means++ start, fixed seed); transparent pixels stay 255. */
export function quantize(img: PixelImage, k: number): Quantized {
  const n = img.width * img.height;
  const labels = new Uint8Array(n).fill(TRANSPARENT);
  const opaque: number[] = [];
  for (let i = 0; i < n; i++) if (img.data[i * 4 + 3]! >= 128) opaque.push(i);
  if (!opaque.length) return { palette: [], labels };
  const rgbAt = (i: number): RGB => [img.data[i * 4]!, img.data[i * 4 + 1]!, img.data[i * 4 + 2]!];
  // Lab of each distinct colour, computed once.
  const labCache = new Map<number, Lab>();
  const labAt = (i: number): Lab => {
    const key = (img.data[i * 4]! << 16) | (img.data[i * 4 + 1]! << 8) | img.data[i * 4 + 2]!;
    let lab = labCache.get(key);
    if (!lab) labCache.set(key, (lab = srgbToLab(rgbAt(i))));
    return lab;
  };
  const step = Math.max(1, Math.floor(opaque.length / SAMPLE_PIXELS));
  const sample = opaque.filter((_, j) => j % step === 0).map(labAt);
  const kk = Math.max(1, Math.min(16, Math.round(k), sample.length));
  // k-means++ start.
  const rand = mulberry32Stream(1);
  const centres: Lab[] = [sample[Math.floor(rand() * sample.length)]!];
  const nearest2 = sample.map((p) => labDistance2(p, centres[0]!));
  while (centres.length < kk) {
    const total = nearest2.reduce((s, d) => s + d, 0);
    if (total <= 1e-9) break;
    let r = rand() * total;
    let pick = 0;
    while (pick < sample.length - 1 && (r -= nearest2[pick]!) > 0) pick++;
    centres.push(sample[pick]!);
    sample.forEach((p, i) => (nearest2[i] = Math.min(nearest2[i]!, labDistance2(p, sample[pick]!))));
  }
  const closest = (p: Lab) => {
    let best = 0;
    let bestD = Infinity;
    centres.forEach((c, j) => {
      const d = labDistance2(p, c);
      if (d < bestD) [best, bestD] = [j, d];
    });
    return best;
  };
  for (let round = 0; round < KMEANS_ROUNDS; round++) {
    const sums = centres.map((): [number, number, number, number] => [0, 0, 0, 0]);
    for (const p of sample) {
      const s = sums[closest(p)]!;
      s[0] += p[0];
      s[1] += p[1];
      s[2] += p[2];
      s[3]++;
    }
    let moved = 0;
    sums.forEach((s, j) => {
      if (!s[3]) return;
      const next: Lab = [s[0] / s[3], s[1] / s[3], s[2] / s[3]];
      moved = Math.max(moved, labDistance2(next, centres[j]!));
      centres[j] = next;
    });
    if (moved < 0.01) break;
  }
  // Every pixel to its centre; the palette is the mean RGB of each cluster.
  const byColour = new Map<number, number>();
  const rgbSums = centres.map((): [number, number, number, number] => [0, 0, 0, 0]);
  for (const i of opaque) {
    const key = (img.data[i * 4]! << 16) | (img.data[i * 4 + 1]! << 8) | img.data[i * 4 + 2]!;
    let j = byColour.get(key);
    if (j === undefined) byColour.set(key, (j = closest(labAt(i))));
    labels[i] = j;
    const s = rgbSums[j]!;
    s[0] += img.data[i * 4]!;
    s[1] += img.data[i * 4 + 1]!;
    s[2] += img.data[i * 4 + 2]!;
    s[3]++;
  }
  // Drop empty clusters.
  const remap = new Uint8Array(centres.length).fill(TRANSPARENT);
  const palette: RGB[] = [];
  rgbSums.forEach((s, j) => {
    if (!s[3]) return;
    remap[j] = palette.length;
    palette.push([Math.round(s[0] / s[3]), Math.round(s[1] / s[3]), Math.round(s[2] / s[3])]);
  });
  for (let i = 0; i < n; i++) if (labels[i] !== TRANSPARENT) labels[i] = remap[labels[i]!]!;
  return { palette, labels };
}

/** Snaps the palette to threads, merging colours that land on the same thread. */
function snapToThreads(q: Quantized, threads: readonly Thread[], chart: string): { palette: RGB[]; refs: (ThreadRef | null)[] } {
  const keys: string[] = [];
  const palette: RGB[] = [];
  const refs: (ThreadRef | null)[] = [];
  const remap = q.palette.map((c) => {
    const m = nearestThread(c, threads);
    if (!m) return -1;
    const key = `${m.thread.code}`;
    let j = keys.indexOf(key);
    if (j < 0) {
      j = keys.length;
      keys.push(key);
      palette.push([...m.thread.rgb]);
      refs.push({ chart, code: m.thread.code, name: m.thread.name });
    }
    return j;
  });
  if (remap.some((j) => j < 0)) return { palette: q.palette, refs: q.palette.map(() => null) };
  for (let i = 0; i < q.labels.length; i++) if (q.labels[i] !== TRANSPARENT) q.labels[i] = remap[q.labels[i]!]!;
  return { palette, refs };
}

// ---- 2. clean-up ----

/** One 3 x 3 majority pass: a pixel takes the label most of its neighbourhood has (5 of 9). */
function majority(labels: Uint8Array, w: number, h: number): Uint8Array {
  const out = Uint8Array.from(labels);
  const counts = new Map<number, number>();
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      counts.clear();
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const l = labels[(y + dy) * w + x + dx]!;
        counts.set(l, (counts.get(l) ?? 0) + 1);
      }
      for (const [l, c] of counts) if (c >= 5 && l !== labels[y * w + x]) out[y * w + x] = l;
    }
  }
  return out;
}

/** Merges 4-connected components smaller than minPixels into the label around them most. */
function mergeSpecks(labels: Uint8Array, w: number, h: number, minPixels: number): void {
  for (let pass = 0; pass < 3; pass++) {
    const comp = new Int32Array(w * h).fill(-1);
    let changed = false;
    let id = 0;
    for (let start = 0; start < w * h; start++) {
      if (comp[start] !== -1) continue;
      const l = labels[start]!;
      const members = [start];
      comp[start] = id;
      const around = new Map<number, number>();
      for (let k = 0; k < members.length; k++) {
        const i = members[k]!;
        const x = i % w;
        const y = (i - x) / w;
        for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]] as const) {
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const j = ny * w + nx;
          if (labels[j] === l) {
            if (comp[j] === -1) {
              comp[j] = id;
              members.push(j);
            }
          } else around.set(labels[j]!, (around.get(labels[j]!) ?? 0) + 1);
        }
      }
      id++;
      if (members.length >= minPixels || !around.size) continue;
      let best = -1;
      let bestCount = -1;
      for (const [nl, c] of around) if (c > bestCount) [best, bestCount] = [nl, c];
      for (const i of members) labels[i] = best;
      changed = true;
    }
    if (!changed) break;
  }
}

/** The label covering most of the picture's border, when it covers at least half of it. */
function borderLabel(labels: Uint8Array, w: number, h: number): number | null {
  const counts = new Map<number, number>();
  const add = (i: number) => counts.set(labels[i]!, (counts.get(labels[i]!) ?? 0) + 1);
  for (let x = 0; x < w; x++) {
    add(x);
    add((h - 1) * w + x);
  }
  for (let y = 1; y < h - 1; y++) {
    add(y * w);
    add(y * w + w - 1);
  }
  let best: number | null = null;
  let bestCount = 0;
  for (const [l, c] of counts) if (c > bestCount) [best, bestCount] = [l, c];
  const total = 2 * w + 2 * Math.max(0, h - 2);
  return best !== null && bestCount >= total / 2 ? best : null;
}

// ---- 3. outlines ----

/**
 * Outlines of the pixels with one label, along pixel edges (corner coordinates), inside on the
 * right; at a corner where two pixels touch diagonally the walk turns right, so diagonal
 * neighbours stay separate (4-connected, as the clean-up counts them).
 */
export function traceLabel(labels: Uint8Array, w: number, h: number, label: number): Point[][] {
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && labels[y * w + x] === label;
  const W1 = w + 1;
  // Directed edges by start vertex: [dx, dy] per edge (several at a saddle).
  const out = new Map<number, number[]>();
  const dirs: [number, number][] = [
    [1, 0],
    [0, 1],
    [-1, 0],
    [0, -1],
  ];
  const addEdge = (vx: number, vy: number, d: number) => {
    const key = vy * W1 + vx;
    const list = out.get(key);
    if (list) list.push(d);
    else out.set(key, [d]);
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!inside(x, y)) continue;
      if (!inside(x, y - 1)) addEdge(x, y, 0); // top, left to right
      if (!inside(x + 1, y)) addEdge(x + 1, y, 1); // right, downward
      if (!inside(x, y + 1)) addEdge(x + 1, y + 1, 2); // bottom, right to left
      if (!inside(x - 1, y)) addEdge(x, y + 1, 3); // left, upward
    }
  }
  const rings: Point[][] = [];
  for (const [startKey, list] of out) {
    while (list.length) {
      let key = startKey;
      let d = list.pop()!;
      const ring: Point[] = [];
      for (let guard = 0; guard < 4 * W1 * (h + 1); guard++) {
        const vx = key % W1;
        const vy = (key - vx) / W1;
        ring.push([vx, vy]);
        key = (vy + dirs[d]![1]) * W1 + vx + dirs[d]![0];
        const next = out.get(key);
        if (!next || !next.length) break;
        // Prefer a right turn, then straight on, then left.
        const pick = [(d + 1) % 4, d, (d + 3) % 4].find((c) => next.includes(c));
        if (pick === undefined) break;
        next.splice(next.indexOf(pick), 1);
        d = pick;
      }
      // Keep the corners only.
      const corners = ring.filter((p, i) => {
        const a = ring[(i - 1 + ring.length) % ring.length]!;
        const b = ring[(i + 1) % ring.length]!;
        return (p[0] - a[0]) * (b[1] - p[1]) - (p[1] - a[1]) * (b[0] - p[0]) !== 0;
      });
      if (corners.length >= 4) rings.push(corners);
    }
  }
  return rings;
}

/** Pixel corner coordinates -> design mm. */
const toMm = (img: PixelImage, at: Placement) => (p: Point): Point => [at.x + (p[0] * at.width) / img.width, at.y + (p[1] * at.height) / img.height];

/**
 * A pixel-staircase ring made smooth and simple: resampled every pixel, averaged over five
 * pixels (the steps go, a square corner rounds by about a pixel), then Douglas-Peucker. Closed.
 */
function simplifyRing(ring: readonly Point[], pixel: number, tolerance: number): Point[] {
  const dense = resamplePolyline([...ring, ring[0]!], pixel).slice(0, -1);
  if (dense.length < 8) return douglasPeucker([...ring, ring[0]!], tolerance);
  const smooth = movingAverage(dense, true, 5);
  return douglasPeucker([...smooth, smooth[0]!], tolerance);
}

/**
 * Traces a picture into colour layers (mm, placed as `at`), largest first. Shapes and holes
 * under the minimum area are left out.
 */
export function traceImage(img: PixelImage, at: Placement, options: Partial<TraceOptions> = {}): TracedLayer[] {
  const o = { ...DEFAULT_TRACE, ...options };
  const { width: w, height: h } = img;
  if (w < 2 || h < 2) return [];
  const q = quantize(img, o.colours);
  let palette = q.palette;
  let refs: (ThreadRef | null)[] = palette.map(() => null);
  if (o.threads?.length) ({ palette, refs } = snapToThreads(q, o.threads, o.chart ?? ''));
  const mmPerPx = Math.sqrt((at.width / w) * (at.height / h));
  const labels = majority(q.labels, w, h);
  mergeSpecks(labels, w, h, Math.max(2, o.minArea / (mmPerPx * mmPerPx)));
  const background = o.dropBackground ? borderLabel(labels, w, h) : null;
  const map = toMm(img, at);
  const tolerance = Math.max(0.25 * mmPerPx, o.smoothing);
  const layers: TracedLayer[] = [];
  palette.forEach((color, label) => {
    if (label === background) return;
    const rings = traceLabel(labels, w, h, label)
      .map((r) => simplifyRing(r.map(map), mmPerPx, tolerance))
      .filter((r) => r.length >= 4);
    const region = nestRings(rings)
      .map((poly) => ({ outer: poly.outer, holes: poly.holes.filter((hole) => regionArea([{ outer: hole, holes: [] }]) >= o.minArea) }))
      .filter((poly) => regionArea([poly]) >= o.minArea);
    if (region.length) layers.push({ color, thread: refs[label] ?? null, region, area: regionArea(region) });
  });
  return layers.sort((a, b) => b.area - a.area);
}

// ---- 4. stitches ----

/**
 * Draft stitch objects for traced layers, sewn in the given order: shapes at most
 * columnMaxWidth wide become satin columns, the rest tatami; each layer reaches `overlap`
 * under the layers after it.
 */
export function digitizeLayers(layers: readonly TracedLayer[], options: Partial<DigitizeOptions> = {}, smoothing = DEFAULT_TRACE.smoothing): NewObject[] {
  const o = { ...DEFAULT_DIGITIZE, ...options };
  const out: NewObject[] = [];
  layers.forEach((layer, i) => {
    let region = layer.region;
    const later = layers.slice(i + 1).map((l) => l.region);
    if (o.overlap > 0 && later.length) {
      const grown = intersection(bufferRegion(region, o.overlap, { join: 'mitre' }), unionAll([region, ...later]));
      if (grown.length) region = grown;
    }
    const base: NewObject = { color: [...layer.color], thread: layer.thread };
    for (const poly of region) {
      const piece: Region = [poly];
      // Thin: shrinking it by half the column width leaves nothing.
      if (o.columnMaxWidth > 0 && !bufferRegion(piece, -o.columnMaxWidth / 2).length) {
        // Thin shapes: satin columns from the outline auto-digitizer (in mm: a 20 mm "capital").
        const cols = autodigitize([poly.outer, ...poly.holes], 20);
        if (cols.length) {
          for (const c of cols) out.push({ ...c, ...base });
          continue;
        }
      }
      out.push({
        ...base,
        settings: defaultSettings({ stitchType: 'fill' }),
        closed: true,
        points: smoothNodes(poly.outer, true, smoothing),
        holes: poly.holes.map((hole) => smoothNodes(hole, true, smoothing)),
      });
    }
  });
  return out;
}

/** Traced layers as an SVG at real size (mm), for editing elsewhere. */
export function tracedSvg(layers: readonly TracedLayer[]): string {
  const all = layers.flatMap((l) => l.region.flatMap((p) => p.outer));
  const xs = all.map((p) => p[0]);
  const ys = all.map((p) => p[1]);
  const x0 = all.length ? Math.min(...xs) - 1 : 0;
  const y0 = all.length ? Math.min(...ys) - 1 : 0;
  const w = all.length ? Math.max(...xs) - x0 + 1 : 1;
  const h = all.length ? Math.max(...ys) - y0 + 1 : 1;
  const r = (v: number) => (Math.round(v * 1000) / 1000).toString();
  const ring = (pts: readonly Point[]) => `M${pts.map((p) => `${r(p[0])} ${r(p[1])}`).join('L')}Z`;
  const hex = (c: RGB) => `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  const paths = layers.map((l) => `<path fill="${hex(l.color)}" fill-rule="evenodd" d="${l.region.map((p) => [p.outer, ...p.holes].map(ring).join('')).join('')}"/>`);
  return [`<?xml version="1.0" encoding="UTF-8"?>`, `<svg xmlns="http://www.w3.org/2000/svg" width="${r(w)}mm" height="${r(h)}mm" viewBox="${r(x0)} ${r(y0)} ${r(w)} ${r(h)}">`, ...paths, `</svg>`, ''].join('\n');
}
