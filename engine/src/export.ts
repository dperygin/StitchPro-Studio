// Export plan (needle commands) and machine marks.
//
// The plan is what the server turns into a machine file: plain data, in millimetres, y down.

import type { StitchDocument, StitchObject, ThreadRef } from './document';
import { paletteIndexOf, sameColor, updateObject } from './document';
import { TRAVEL_STITCH } from './fill';
import { covers, fastAreaCovers, nearestOnBoundary, uncoveredLength, type CoverRaster } from './geometry';
import { cumulativeLengths, distance, pointAt, resampleKeepingCorners } from './path';
import { JUMP_MARK, isAreaType, type Point, type RGB } from './types';
import { objectArea } from './weld';

export type CommandKind = 'stitch' | 'jump' | 'trim' | 'stop' | 'color_change';
export type Command = [CommandKind, number, number];

export interface ExportThread {
  color: RGB;
  name: string;
  brand: string;
  code: string;
}

export interface ExportPlan {
  name: string;
  /** One entry per colour block, in sewing order. */
  threads: ExportThread[];
  commands: Command[];
  /** Let the writer split stitches longer than maxStitch into jumps. */
  autoJump: boolean;
  maxStitch: number;
  /** Number of jumps a machine reads as a trim (DST). */
  trimJumps: number;
}

export type MarkKind = 'start' | 'end' | 'tie_in' | 'tie_off' | 'trim' | 'stop' | 'hoop_out' | 'color_change' | 'travel';

export interface MachineMark {
  kind: MarkKind;
  at: Point;
  /** For travel runs: the path travelled. */
  path?: Point[];
  objectId?: number;
}

export type StitchesOf = (o: StitchObject) => Point[];

/** Tie-in/off: two stitches 0.7 mm along the run and back. */
const TIE_LENGTH = 0.7;
/** How many same-colour objects ahead may hide a connecting run. */
const COVER_LOOKAHEAD = 8;

const COLUMN_TYPES = new Set(['satin', 'zigzag', 'e_stitch', 'radial_satin']);

// ---- runs ----

export interface Run {
  object: StitchObject;
  points: Point[];
}

/** The longest stitch a line object makes; longer moves are connectors. */
function longestStitch(o: StitchObject, doc: StitchDocument): number {
  const s = o.settings;
  switch (s.stitchType) {
    case 'running':
      return Math.max(0.5, s.stitchLength) + (s.runStyle === 'stemstitch' ? s.stemWidth : 0);
    case 'motif_line':
      return Math.max(s.stitchLength, s.motifLength, s.motifWidth);
    default:
      return doc.autoJumpThreshold;
  }
}

/** Drops stitches shorter than minStitch, keeping both ends of the run. */
function dropShort(pts: Point[], minStitch: number): Point[] {
  if (pts.length <= 2 || !(minStitch > 0)) return pts;
  const out: Point[] = [pts[0]!];
  for (let i = 1; i < pts.length - 1; i++) if (distance(out[out.length - 1]!, pts[i]!) >= minStitch) out.push(pts[i]!);
  const last = pts[pts.length - 1]!;
  if (out.length > 1 && distance(out[out.length - 1]!, last) < minStitch) out.pop();
  out.push(last);
  return out;
}

/**
 * Splits an object's stitches into runs at connectors: jump marks always; with auto trim also
 * area moves longer than the trim distance that cross open fabric, and line moves longer than
 * the longest stitch. Columns are one run.
 */
export function splitRuns(o: StitchObject, pts: readonly Point[], doc: StitchDocument): Run[] {
  const t = o.settings.stitchType;
  const area = isAreaType(t);
  const cover = area && doc.autoTrim ? objectArea(o) : null;
  const limit = longestStitch(o, doc) + 1e-6;
  const runs: Point[][] = [];
  let cur: Point[] = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    // A jump mark: the landing point written JUMP_MARK times.
    let marked = i + JUMP_MARK - 1 < pts.length;
    for (let k = 1; marked && k < JUMP_MARK; k++) marked = pts[i + k]![0] === p[0] && pts[i + k]![1] === p[1];
    if (marked && cur.length) {
      runs.push(cur);
      cur = [p];
      i += JUMP_MARK - 1;
      continue;
    }
    if (cur.length && doc.autoTrim && !COLUMN_TYPES.has(t)) {
      const prev = cur[cur.length - 1]!;
      const d = distance(prev, p);
      const connector = area ? d > doc.trimThreshold && !covers(cover!, [prev, p]) : d > limit;
      if (connector) {
        runs.push(cur);
        cur = [];
      }
    }
    if (!cur.length || cur[cur.length - 1]![0] !== p[0] || cur[cur.length - 1]![1] !== p[1]) cur.push(p);
  }
  if (cur.length) runs.push(cur);
  return runs.map((r) => ({ object: o, points: dropShort(r, doc.minStitch) }));
}

// ---- plan ----

function threadOf(doc: StitchDocument, o: StitchObject): ExportThread {
  const slot = doc.palette[paletteIndexOf(doc.palette, o.color)];
  const t: ThreadRef | null = o.thread ?? slot?.thread ?? null;
  return { color: [o.color[0], o.color[1], o.color[2]], name: t?.name ?? '', brand: t?.chart ?? '', code: t?.code ?? '' };
}

/** A point `d` mm along a run from its start (or back from its end). */
function alongRun(pts: readonly Point[], d: number, fromEnd: boolean): Point {
  const line = fromEnd ? [...pts].reverse() : pts;
  return pointAt(line, d, cumulativeLengths(line));
}

export interface PlanResult {
  plan: ExportPlan;
  marks: MachineMark[];
}

/** Builds the export plan and the machine marks for the canvas. */
export function planDesign(doc: StitchDocument, stitchesOf: StitchesOf): PlanResult {
  const objects = doc.objects.filter((o) => o.visible);
  const runs: Run[] = objects.flatMap((o) => splitRuns(o, stitchesOf(o), doc).filter((r) => r.points.length));
  const commands: Command[] = [];
  const marks: MachineMark[] = [];
  const threads: ExportThread[] = [];
  const emit = (kind: CommandKind, p: Point) => commands.push([kind, p[0], p[1]]);
  const mark = (kind: MarkKind, at: Point, extra: Partial<MachineMark> = {}) => marks.push({ kind, at: [at[0], at[1]], ...extra });

  // Raster cover tests, built once per object.
  const rasters = new Map<StitchObject, CoverRaster>();
  const rasterOf = (o: StitchObject) => {
    let r = rasters.get(o);
    if (!r) rasters.set(o, (r = fastAreaCovers(objectArea(o))));
    return r;
  };

  const tieIn = (run: Point[], objectId: number) => {
    if (!doc.tieStitches || run.length < 2) return;
    emit('stitch', alongRun(run, TIE_LENGTH, false));
    emit('stitch', run[0]!);
    mark('tie_in', run[0]!, { objectId });
  };
  const tieOff = (run: Point[], objectId: number) => {
    if (!doc.tieStitches || run.length < 2) return;
    const end = run[run.length - 1]!;
    emit('stitch', alongRun(run, TIE_LENGTH, true));
    emit('stitch', end);
    mark('tie_off', end, { objectId });
  };
  /** Start a run after the thread was cut: jump there, stitch, tie in. */
  const startFresh = (run: Run) => {
    const p = run.points[0]!;
    emit('jump', p);
    emit('stitch', p);
    tieIn(run.points, run.object.id);
  };
  const trim = (at: Point) => {
    emit('trim', at);
    mark('trim', at);
  };

  let prev: Run | null = null;
  let cut = true; // the thread is cut (nothing sewn yet, or after a trim)
  let color: RGB | null = null;

  runs.forEach((run, i) => {
    const o = run.object;
    const start = run.points[0]!;
    if (!prev) {
      threads.push(threadOf(doc, o));
      color = o.color;
      startFresh(run);
      mark('start', start, { objectId: o.id });
    } else if (!sameColor(color!, o.color)) {
      // New colour: tie-off, trim, colour change, jump, tie-in.
      const end = prev.points[prev.points.length - 1]!;
      if (!cut) {
        tieOff(prev.points, prev.object.id);
        trim(end);
      }
      emit('color_change', end);
      mark('color_change', end, { objectId: o.id });
      threads.push(threadOf(doc, o));
      color = o.color;
      startFresh(run);
    } else if (cut) {
      startFresh(run);
    } else {
      const end = prev.points[prev.points.length - 1]!;
      const d = distance(end, start);
      if (d <= doc.trimThreshold) {
        emit('stitch', start); // run straight on
      } else if (!doc.autoTrim) {
        emit('jump', start);
        emit('stitch', start);
      } else {
        // (a) Hidden under the same-colour objects still to come?
        const ahead: StitchObject[] = [];
        for (let j = i; j < runs.length && ahead.length < COVER_LOOKAHEAD; j++) {
          const oj = runs[j]!.object;
          if (!sameColor(oj.color, o.color)) break;
          if (!ahead.includes(oj) && isCovering(oj)) ahead.push(oj);
        }
        const hidden = ahead.length > 0 && uncoveredLength(ahead.map(rasterOf), end, start) <= doc.trimThreshold;
        // (b) Closest join: the next object comes within joinDistance of where the last ended.
        const join = !hidden && doc.closestJoin ? closestJoinPath(run.points, end, doc.joinDistance) : null;
        if (hidden) {
          const path = resampleKeepingCorners([end, start], TRAVEL_STITCH);
          for (const p of path.slice(1)) emit('stitch', p);
          mark('travel', end, { path, objectId: o.id });
        } else if (join) {
          for (const p of join.slice(1)) emit('stitch', p);
          mark('travel', end, { path: join, objectId: o.id });
        } else {
          tieOff(prev.points, prev.object.id);
          trim(end);
          startFresh(run);
        }
      }
    }
    cut = false;
    for (const p of run.points.slice(1)) emit('stitch', p);

    // Last run of this object: stop / hoop out.
    const lastOfObject = runs[i + 1]?.object !== o;
    const end = run.points[run.points.length - 1]!;
    if (lastOfObject && o.hoopOut) {
      tieOff(run.points, o.id);
      trim(end);
      emit('jump', o.hoopOut);
      emit('stop', o.hoopOut);
      mark('hoop_out', o.hoopOut, { objectId: o.id });
      cut = true;
    } else if (lastOfObject && o.stopAfter) {
      emit('stop', end);
      mark('stop', end, { objectId: o.id });
    }
    prev = run;
  });

  if (prev) {
    const last = prev as Run;
    const end = last.points[last.points.length - 1]!;
    if (!cut) {
      tieOff(last.points, last.object.id);
      trim(end);
    }
    mark('end', end, { objectId: last.object.id });
  }

  return {
    plan: {
      name: doc.name,
      threads,
      commands,
      autoJump: doc.autoJump,
      maxStitch: doc.autoJumpThreshold,
      trimJumps: doc.trimJumps,
    },
    marks,
  };
}

/** Objects whose stitching covers an area (open lines and manual stitches cover nothing). */
function isCovering(o: StitchObject): boolean {
  const t = o.settings.stitchType;
  return isAreaType(t) || COLUMN_TYPES.has(t);
}

/**
 * Closest join: if the run comes within joinDistance of `from`, step to its nearest stitch and
 * run back inside it (along its own stitches) to its first point. Null otherwise.
 */
function closestJoinPath(run: readonly Point[], from: Point, joinDistance: number): Point[] | null {
  let k = 0;
  run.forEach((p, i) => {
    if (distance(p, from) < distance(run[k]!, from)) k = i;
  });
  if (distance(run[k]!, from) > joinDistance) return null;
  if (k === 0) return [from, run[0]!];
  const back = run.slice(0, k + 1).reverse();
  return [from, ...resampleKeepingCorners(back, TRAVEL_STITCH, { angleBelowDeg: 170 })];
}

/** The export plan for the server (see planDesign for the canvas marks). */
export function buildExportPlan(doc: StitchDocument, stitchesOf: StitchesOf): ExportPlan {
  return planDesign(doc, stitchesOf).plan;
}

// ---- closest join in the editor ----

/** The point of an object nearest p: on an area's outline, or the nearer end of an open line. */
function nearestEntry(o: StitchObject, p: Point): Point | null {
  if (o.points.length === 0) return null;
  if (isAreaType(o.settings.stitchType) || o.closed) {
    const area = objectArea(o);
    if (area.length) return nearestOnBoundary(area, p).point;
    // Closed line: nearest point of its outline.
    const ring: Point[] = o.points.map((n) => [n.x, n.y]);
    ring.push(ring[0]!);
    return nearestOnBoundary([{ outer: ring, holes: [] }], p).point;
  }
  const first: Point = [o.points[0]!.x, o.points[0]!.y];
  const last: Point = [o.points[o.points.length - 1]!.x, o.points[o.points.length - 1]!.y];
  return distance(p, first) <= distance(p, last) ? first : last;
}

const samePoint = (a: Point | null, b: Point | null) => (a === null ? b === null : b !== null && a[0] === b[0] && a[1] === b[1]);

/**
 * Closest join, applied by the editor on every commit: an object with autoEntry starts at its
 * point nearest the previous same-colour object's exit when within joinDistance (otherwise its
 * entry is automatic), and a row fill's exit moves toward the next object. Returns the objects,
 * changed ones as new versions; unchanged objects are returned as they were.
 */
export function applyClosestJoin(doc: StitchDocument, stitchesOf: StitchesOf): StitchObject[] {
  if (!doc.closestJoin) return doc.objects;
  const out = [...doc.objects];
  for (let i = 0; i < out.length; i++) {
    let o = out[i]!;
    if (!o.autoEntry || !o.visible) continue;
    const prev = i > 0 ? out[i - 1]! : null;
    let fillStart: Point | null = null;
    if (prev && prev.visible && sameColor(prev.color, o.color)) {
      const pts = stitchesOf(prev);
      const exit = pts[pts.length - 1];
      const entry = exit ? nearestEntry(o, exit) : null;
      if (exit && entry && distance(exit, entry) <= doc.joinDistance) fillStart = entry;
    }
    let fillEnd = o.fillEnd;
    const t = o.settings.stitchType;
    if (t === 'fill' || t === 'satin_fill') {
      const next = out[i + 1];
      const target = next ? (next.fillStart ?? (next.points[0] ? ([next.points[0].x, next.points[0].y] as Point) : null)) : null;
      fillEnd = target ? nearestEntry(o, target) : null;
    }
    if (!samePoint(fillStart, o.fillStart) || !samePoint(fillEnd, o.fillEnd)) {
      o = updateObject(o, { fillStart, fillEnd });
      out[i] = o;
    }
  }
  return out;
}
