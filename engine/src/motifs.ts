// Motif library, motif line, motif fill, stamps.
//
// A motif is points in a unit box: x 0..1 along, y -0.5..0.5 across (y down, like the
// screen), running from (0, 0) to (1, 0).

import { pointInRegion, type Region } from './geometry';
import { arcPositions, cumulativeLengths, distance, pointAt, resamplePolyline } from './path';
import { JUMP_MARK, type Motif, type Point, type StitchSettings } from './types';

/** Samples y = f(x) on 0..1; the ends are pinned to y = 0 (a motif runs from (0,0) to (1,0)). */
const arc = (n: number, f: (t: number) => number): Point[] =>
  Array.from({ length: n + 1 }, (_, i) => [i / n, i === 0 || i === n ? 0 : f(i / n)]);

/** The built-in motifs. */
export const BUILTIN_MOTIFS: readonly Motif[] = [
  { name: 'wave', points: arc(12, (t) => -0.5 * Math.sin(2 * Math.PI * t)) },
  { name: 'scallop', points: arc(10, (t) => -0.5 * Math.sin(Math.PI * t)) },
  { name: 'rickrack', points: [[0, 0], [0.25, -0.5], [0.75, 0.5], [1, 0]] },
  { name: 'diamond', points: [[0, 0], [0.5, -0.5], [1, 0], [0.5, 0.5], [0, 0], [1, 0]] },
  {
    name: 'leaf',
    points: [
      ...arc(8, (t) => -0.5 * Math.sin(Math.PI * t)),
      ...arc(8, (t) => 0.5 * Math.sin(Math.PI * t)).reverse().slice(1),
      [1, 0],
    ],
  },
  { name: 'cross', points: [[0, 0], [0.5, 0], [0.5, -0.5], [0.5, 0.5], [0.5, 0], [1, 0]] },
  {
    name: 'loop',
    points: [
      [0, 0],
      [0.5, 0],
      ...Array.from({ length: 12 }, (_, i): Point => {
        const a = Math.PI / 2 + ((i + 1) * 2 * Math.PI) / 12;
        return [0.5 + 0.25 * Math.cos(a), -0.25 + 0.25 * Math.sin(a)];
      }),
      [1, 0],
    ],
  },
  { name: 'triple', points: [[0, 0], [1, 0], [0, 0], [1, 0]] },
];

/** A motif by name: the project's own motifs first, then the built-in ones. */
export function findMotif(name: string, projectMotifs: readonly Motif[] = []): Motif | null {
  return projectMotifs.find((m) => m.name === name) ?? BUILTIN_MOTIFS.find((m) => m.name === name) ?? null;
}

/** Splits segments longer than `max` evenly. */
function subdivide(pts: readonly Point[], max: number): Point[] {
  const out: Point[] = pts.length ? [pts[0]!] : [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const n = Math.max(1, Math.ceil(distance(a, b) / max - 1e-9));
    for (let k = 1; k <= n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  return out;
}

const sameP = (a: Point, b: Point) => a[0] === b[0] && a[1] === b[1];
function appendDistinct(out: Point[], pts: readonly Point[]): void {
  for (const p of pts) if (!out.length || !sameP(out[out.length - 1]!, p)) out.push(p);
}

/**
 * Motif line: the motif repeated along the path, scaled to motifLength x motifWidth and
 * stretched slightly so a whole number fits, with motifGap of running stitch between.
 */
export function motifLine(path: readonly Point[], s: StitchSettings, projectMotifs: readonly Motif[] = []): Point[] {
  const motif = findMotif(s.motifName, projectMotifs);
  if (!motif || path.length < 2) return path.map((p) => [p[0], p[1]]);
  const cum = cumulativeLengths(path);
  const total = cum[cum.length - 1]!;
  if (total <= 0) return [];
  let gap = Math.max(0, s.motifGap);
  const n = Math.max(1, Math.round((total + gap) / (s.motifLength + gap)));
  let len = (total + gap) / n - gap;
  if (len <= 0.1) {
    gap = 0;
    len = total / n;
  }
  const along = (d: number, across: number): Point => {
    const p = pointAt(path, d, cum);
    const a = pointAt(path, d - 0.05, cum);
    const b = pointAt(path, d + 0.05, cum);
    const l = distance(a, b) || 1;
    // Screen-right of the direction (y down): (-dy, dx).
    return [p[0] + (-(b[1] - a[1]) / l) * across, p[1] + ((b[0] - a[0]) / l) * across];
  };
  const out: Point[] = [];
  for (let k = 0; k < n; k++) {
    const d0 = k * (len + gap);
    appendDistinct(out, subdivide(motif.points.map(([u, v]) => along(d0 + u * len, v * s.motifWidth)), s.stitchLength));
    if (gap > 0 && k < n - 1) appendDistinct(out, arcPositions(gap, s.stitchLength).map((d) => pointAt(path, d0 + len + d, cum)));
  }
  return out;
}

function rotator(deg: number): (p: Point) => Point {
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a);
  const sn = Math.sin(a);
  return (p) => [p[0] * c - p[1] * sn, p[0] * sn + p[1] * c];
}

/** True when every point of a polyline (sampled every 0.2 mm) lies inside the region. */
function wholyInside(region: Region, pts: readonly Point[]): boolean {
  for (let i = 0; i < pts.length; i++) {
    if (pointInRegion(region, pts[i]!) === 'outside') return false;
    if (i > 0) {
      const a = pts[i - 1]!;
      const b = pts[i]!;
      const n = Math.ceil(distance(a, b) / 0.2);
      for (let k = 1; k < n; k++) if (pointInRegion(region, [a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]) === 'outside') return false;
    }
  }
  return true;
}

/**
 * Motif fill: rows of motifs at the fill angle, motifRowSpacing apart; every other row shifted
 * by motifRowOffset (a fraction of the motif pitch), every other motif raised by
 * motifColumnOffset x row spacing and, with motif2Name set, replaced by that motif scaled by
 * motif2Scale. Only motifs wholly inside are sewn; rows alternate direction.
 */
export function motifFill(region: Region, s: StitchSettings, projectMotifs: readonly Motif[] = []): Point[] {
  const motif1 = findMotif(s.motifName, projectMotifs);
  if (!motif1 || !region.length || !(s.motifRowSpacing > 0) || !(s.motifLength > 0)) return [];
  const motif2 = s.motif2Name ? findMotif(s.motif2Name, projectMotifs) : null;
  const toFrame = rotator(-s.fillAngle);
  const fromFrame = rotator(s.fillAngle);
  const local: Region = region.map((p) => ({ outer: p.outer.map(toFrame), holes: p.holes.map((h) => h.map(toFrame)) }));
  const all = local.flatMap((p) => p.outer);
  const xs = all.map((p) => p[0]);
  const ys = all.map((p) => p[1]);
  const pitch = s.motifLength + Math.max(0, s.motifGap);
  const rs = s.motifRowSpacing;

  const out: Point[] = [];
  let rowIndex = 0;
  for (let r = Math.floor((Math.min(...ys) - s.motifWidth) / rs); r * rs <= Math.max(...ys) + s.motifWidth; r++) {
    const offset = r % 2 !== 0 ? s.motifRowOffset * pitch : 0;
    const row: Point[][] = [];
    for (let k = Math.floor((Math.min(...xs) - offset) / pitch) - 1; k * pitch + offset <= Math.max(...xs); k++) {
      const odd = k % 2 !== 0;
      const alt = odd && motif2 !== null;
      const m = alt ? motif2! : motif1;
      const scale = alt ? s.motif2Scale : 1;
      const x0 = k * pitch + offset;
      const y = r * rs - (odd ? s.motifColumnOffset * rs : 0);
      const pts = m.points.map(([u, v]): Point => [x0 + u * s.motifLength * scale, y + v * s.motifWidth * scale]);
      if (wholyInside(local, pts)) row.push(subdivide(pts, s.stitchLength));
    }
    if (!row.length) continue;
    const ordered = rowIndex++ % 2 === 0 ? row : row.reverse().map((pts) => [...pts].reverse());
    for (const pts of ordered) {
      if (out.length && !wholyInside(local, [out[out.length - 1]!, pts[0]!])) {
        for (let j = 1; j < JUMP_MARK; j++) out.push(pts[0]!);
        out.push(...pts);
      } else if (out.length) {
        appendDistinct(out, resamplePolyline([out[out.length - 1]!, pts[0]!], s.stitchLength).slice(1));
        appendDistinct(out, pts);
      } else out.push(...pts);
    }
  }
  return out.map(fromFrame);
}
