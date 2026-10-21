// Cut objects along a line (the Cut shapes tool, a knife).

import type { NewObject, StitchObject } from './document';
import { pathNode } from './document';
import { areaRegion } from './generate';
import { bandRegion, distanceToRegion, lineOutside, regionWidth, splitRegion, type Region } from './geometry';
import { columnSamples, isCuttable, keptRuns, pieceFromRun, type ColumnSample, type SampleRun } from './knockout';
import { cumulativeLengths, distance, distanceToPolyline, distanceToSegment, douglasPeuckerIndices, lineIntersection, materializeDetailed, projectOntoPolyline, valueAt } from './path';
import type { Point } from './types';
import { isAreaType } from './types';
import { objectBase, regionObjects } from './weld';

/** Columns and lines are cut by the line thickened to this width, mm. */
export const CUT_THICKNESS = 0.13;
/** Cut ends are extended back to the line when it is this close, mm. */
export const CUT_REACH = 0.76;
/** Pieces narrower (areas) or shorter (lines) than this are dropped, mm. */
export const CUT_SLIVER = 0.3;

const HALF = CUT_THICKNESS / 2;

/** Where a ray from p along unit d first meets the cut line within CUT_REACH, or null. */
function reachLine(p: Point, d: Point, line: readonly Point[]): Point | null {
  let best: { t: number; point: Point } | null = null;
  const far: Point = [p[0] + d[0], p[1] + d[1]];
  for (let i = 1; i < line.length; i++) {
    const hit = lineIntersection(p, far, line[i - 1]!, line[i]!);
    if (!hit || hit.t < -1e-9 || hit.t > CUT_REACH || hit.u < -1e-9 || hit.u > 1 + 1e-9) continue;
    if (!best || hit.t < best.t) best = { t: hit.t, point: hit.point };
  }
  return best ? best.point : null;
}

const direction = (from: Point, to: Point): Point | null => {
  const l = distance(from, to);
  return l > 1e-9 ? [(to[0] - from[0]) / l, (to[1] - from[1]) / l] : null;
};

/** Moves an end that the cut made (it lies on the thickened line's edge) back onto the line. */
function extendEnd(end: Point, inner: Point, line: readonly Point[]): Point {
  if (distanceToPolyline(end, line) > HALF + 0.01) return end;
  const d = direction(inner, end);
  return (d && reachLine(end, d, line)) ?? end;
}

/** Whether a rung (segment p-q) touches the thickened cut line. */
function rungCut(p: Point, q: Point, line: readonly Point[]): boolean {
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]!;
    const b = line[i]!;
    const hit = lineIntersection(p, q, a, b);
    if (hit && hit.t >= 0 && hit.t <= 1 && hit.u >= 0 && hit.u <= 1) return true;
    if (Math.min(distanceToSegment(p, a, b), distanceToSegment(q, a, b), distanceToSegment(a, p, q), distanceToSegment(b, p, q)) <= HALF) return true;
  }
  return false;
}

/** Areas: split exactly; nearest-first from the entry, the exit piece last. */
function cutArea(o: StitchObject, line: readonly Point[]): NewObject[] | null {
  const pieces = splitRegion(areaRegion(o), line).filter((r) => regionWidth(r) >= CUT_SLIVER);
  if (pieces.length < 2) return null;
  const entry: Point = o.fillStart ?? [o.points[0]!.x, o.points[0]!.y];
  const left = [...pieces];
  let exit: Region | null = null;
  if (o.fillEnd) {
    const end = o.fillEnd;
    left.sort((a, b) => distanceToRegion(a, end) - distanceToRegion(b, end));
    exit = left.shift()!;
  }
  const ordered: Region[] = [];
  let at = entry;
  while (left.length) {
    left.sort((a, b) => distanceToRegion(a, at) - distanceToRegion(b, at));
    const next = left.shift()!;
    ordered.push(next);
    const ring = next[0]!.outer;
    at = ring.reduce((s, p) => [s[0] + p[0] / ring.length, s[1] + p[1] / ring.length], [0, 0] as Point);
  }
  if (exit) ordered.push(exit);
  const out = ordered.flatMap((r) => regionObjects(r, objectBase(o)));
  if (out.length) {
    if (o.fillStart) out[0]!.fillStart = o.fillStart;
    if (o.fillEnd) out[out.length - 1]!.fillEnd = o.fillEnd;
  }
  return out;
}

/** Lines and satin centrelines: the parts outside the thickened cut line, ends brought back to it. */
function cutPath(o: StitchObject, line: readonly Point[]): NewObject[] | null {
  const m = materializeDetailed(o.points, o.closed, o.settings.satinWidth);
  if (m.points.length < 2) return null;
  const total = cumulativeLengths(m.points).at(-1)!;
  let parts = lineOutside(m.points, bandRegion(line, HALF, { cap: 'flat' }));
  // A closed path cut away from its seam: the last part runs on into the first.
  if (o.closed && parts.length > 1 && distance(parts[0]![0]!, m.points[0]!) < 1e-6 && distance(parts.at(-1)!.at(-1)!, m.points[0]!) < 1e-6) {
    parts = [[...parts.at(-1)!, ...parts[0]!.slice(1)], ...parts.slice(1, -1)];
  }
  parts = parts.filter((p) => cumulativeLengths(p).at(-1)! >= CUT_SLIVER);
  const kept = parts.reduce((s, p) => s + cumulativeLengths(p).at(-1)!, 0);
  // Untouched: nothing was cut away.
  if (kept > total - 0.05) return null;
  const cum = cumulativeLengths(m.points);
  const widths = o.points.some((n) => n.width !== null);
  return parts.map((part) => {
    const pts = part.map((p): Point => [p[0], p[1]]);
    pts[0] = extendEnd(pts[0]!, pts[1]!, line);
    pts[pts.length - 1] = extendEnd(pts.at(-1)!, pts.at(-2)!, line);
    const width = (p: Point) => (widths ? valueAt(m.widths, cum, projectOntoPolyline(m.points, p).d) : null);
    return {
      ...objectBase(o),
      closed: false,
      rail2: [],
      stitchAngles: [],
      points: douglasPeuckerIndices(pts, 0.02).map((i) => pathNode(pts[i]![0], pts[i]![1], 'corner', width(pts[i]!))),
    };
  });
}

/** Brings a two-rail run's cut ends (each rail) back to the line. */
function extendRun(run: SampleRun, line: readonly Point[]): SampleRun {
  const s = run.samples.map((p) => ({ ...p }));
  const fix = (end: ColumnSample, inner: ColumnSample) => {
    const da = direction(inner.a, end.a);
    const db = direction(inner.b, end.b);
    const a = (da && reachLine(end.a, da, line)) ?? end.a;
    const b = (db && reachLine(end.b, db, line)) ?? end.b;
    return { a, b, c: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] as Point };
  };
  if (run.cutStart && s.length > 1) s[0] = fix(s[0]!, s[1]!);
  if (run.cutEnd && s.length > 1) s[s.length - 1] = fix(s.at(-1)!, s.at(-2)!);
  return { ...run, samples: s };
}

/** Two-rail columns: rungs touching the thickened line are removed, cut ends brought back to it. */
function cutRails(o: StitchObject, line: readonly Point[]): NewObject[] | null {
  const samples = columnSamples(o);
  if (!samples || samples.length < 2) return null;
  const runs = keptRuns(samples, (p) => !rungCut(p.a, p.b, line), o.closed, CUT_SLIVER);
  if (runs.length === 1 && runs[0]!.whole) return null;
  return runs.map((r) => pieceFromRun(o, extendRun(r, line)));
}

/**
 * Cuts one object along a line. Areas split exactly (pieces nearest-first from the entry, the
 * exit piece last); columns and lines are cut by the line thickened 0.13 mm with their ends
 * extended back to it (within 0.76 mm); slivers under 0.3 mm are dropped. Manual and
 * hand-edited objects are not cut. Null when the line misses the object.
 */
export function cutObject(o: StitchObject, line: readonly Point[]): NewObject[] | null {
  if (line.length < 2 || !isCuttable(o) || o.points.length < 2) return null;
  const t = o.settings.stitchType;
  if (isAreaType(t)) return o.points.length >= 3 ? cutArea(o, line) : null;
  if (t === 'radial_satin') return cutRails(o, line);
  return cutPath(o, line);
}
