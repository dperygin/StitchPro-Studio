// Run styles, raised satin, contour, stipple, cross stitch.

import { cumulativeLengths, pointAt, resamplePolyline } from './path';
import type { Point, RunStyle } from './types';

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
