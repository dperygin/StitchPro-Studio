// Knockout overlaps, column cutting, partial applique and auto applique.

import { railColumn, railRungAt } from './columns';
import { pathNode, type NewObject, type StitchObject } from './document';
import { areaRegion } from './generate';
import { bufferRegion, difference, pointInRegion, polygonFromRings, ringArea, unionAll, regionArea, regionWidth, type Region } from './geometry';
import { arcPositions, cumulativeLengths, distance, douglasPeuckerIndices, materializeDetailed, materializePath, pointAt, valueAt } from './path';
import type { PathNode, Point, StitchType } from './types';
import { defaultSettings } from './types';
import { objectArea, objectBase, regionObjects, ringNodes } from './weld';

/** Cutters narrower than this (region width, mm) are ignored. */
export const KNOCKOUT_MIN_CUTTER = 2;
/** Dense fills keep this much overlap under a cutter, mm. */
export const KNOCKOUT_OVERLAP = 1;
/** Fill pieces narrower than this are dropped, mm. */
export const KNOCKOUT_MIN_PIECE = 1;
/** Columns are sampled across every this many mm when cut. */
export const COLUMN_SAMPLE_MM = 0.25;
/** Column pieces shorter than this are dropped by cutColumn, mm. */
export const COLUMN_MIN_LENGTH = 1;

/** Area fills dense enough to knock out (sparse fills and laydown are left as background). */
export const DENSE_FILL_TYPES: readonly StitchType[] = ['fill', 'satin_fill', 'outline', 'contour'];
const SATIN_TYPES: readonly StitchType[] = ['satin', 'radial_satin'];

/** Manual objects and hand-edited stitches are never cut. */
export const isCuttable = (o: StitchObject): boolean => o.settings.stitchType !== 'manual' && !o.customStitches;

// ---- columns sampled across ----

/** One sample across a column: its middle and its two edge points. */
export interface ColumnSample {
  c: Point;
  a: Point;
  b: Point;
}

const unit = (v: Point): Point | null => {
  const l = Math.hypot(v[0], v[1]);
  return l > 1e-12 ? [v[0] / l, v[1] / l] : null;
};

/**
 * A satin, zigzag, E stitch or two-rail column sampled across every `step` mm (closed
 * columns: the closing sample is not repeated). Null for other objects.
 */
export function columnSamples(o: StitchObject, step = COLUMN_SAMPLE_MM): ColumnSample[] | null {
  const t = o.settings.stitchType;
  let out: ColumnSample[];
  if (t === 'radial_satin') {
    const col = railColumn({ rail1: o.points, rail2: o.rail2, closed: o.closed, paired: o.settings.pairedRails });
    if (!col) return null;
    out = arcPositions(col.length, step).map((u) => {
      const { a, b } = railRungAt(col, u);
      return { a, b, c: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] };
    });
  } else if (t === 'satin' || t === 'zigzag' || t === 'e_stitch') {
    const m = materializeDetailed(o.points, o.closed, o.settings.satinWidth);
    if (m.points.length < 2) return null;
    const cum = cumulativeLengths(m.points);
    const total = cum[cum.length - 1]!;
    out = arcPositions(total, step).map((d) => {
      const c = pointAt(m.points, d, cum);
      const ahead = pointAt(m.points, Math.min(total, d + 0.1), cum);
      const behind = pointAt(m.points, Math.max(0, d - 0.1), cum);
      const dir = unit([ahead[0] - behind[0], ahead[1] - behind[1]]) ?? [1, 0];
      const h = valueAt(m.widths, cum, d) / 2;
      const n: Point = [dir[1], -dir[0]];
      return { c, a: [c[0] + n[0] * h, c[1] + n[1] * h], b: [c[0] - n[0] * h, c[1] - n[1] * h] };
    });
  } else return null;
  if (o.closed && out.length > 1) out.pop();
  return out;
}

/** A run of kept samples; `whole` when it is an entire closed column (nothing removed). */
export interface SampleRun {
  samples: ColumnSample[];
  whole: boolean;
  /** Whether a removed sample lies before / after this run. */
  cutStart: boolean;
  cutEnd: boolean;
}

const runLength = (s: readonly ColumnSample[]) => s.reduce((sum, p, i) => (i ? sum + distance(s[i - 1]!.c, p.c) : 0), 0);

/** Runs of samples that pass `keep`, at least `minLength` long (closed columns wrap round). */
export function keptRuns(samples: readonly ColumnSample[], keep: (s: ColumnSample, i: number) => boolean, closed: boolean, minLength: number): SampleRun[] {
  const n = samples.length;
  const kept = samples.map(keep);
  if (kept.every(Boolean)) return [{ samples: [...samples], whole: true, cutStart: false, cutEnd: false }];
  // Closed columns: start just after a removed sample so no run is split by the seam.
  const start = closed ? (kept.indexOf(false) + 1) % n : 0;
  const runs: SampleRun[] = [];
  let cur: ColumnSample[] = [];
  let cutStart = false;
  for (let k = 0; k < n; k++) {
    const i = (start + k) % n;
    if (kept[i]) {
      if (!cur.length) cutStart = closed || k > 0;
      cur.push(samples[i]!);
    } else {
      if (cur.length) runs.push({ samples: cur, whole: false, cutStart, cutEnd: true });
      cur = [];
    }
  }
  if (cur.length) runs.push({ samples: cur, whole: false, cutStart, cutEnd: closed });
  return runs.filter((r) => r.samples.length >= 2 && runLength(r.samples) >= minLength);
}

/** Rebuilds a run as a piece of the column: a satin (centreline) or a two-rail Column. */
export function pieceFromRun(o: StitchObject, run: SampleRun): NewObject {
  const base = objectBase(o);
  const s = run.samples;
  if (o.settings.stitchType === 'radial_satin') {
    // Paired rails every ~1 mm (each pair one rung), ends kept.
    const pick = s.filter((_, i) => i % 4 === 0 || i === s.length - 1);
    return {
      ...base,
      closed: run.whole && o.closed,
      points: pick.map((p) => pathNode(p.a[0], p.a[1])),
      rail2: pick.map((p) => pathNode(p.b[0], p.b[1])),
      stitchAngles: [],
      settings: { ...o.settings, pairedRails: true },
    };
  }
  const centre = s.map((p) => p.c);
  const keepIdx = douglasPeuckerIndices(centre, 0.02);
  const widths = o.points.some((n) => n.width !== null);
  return {
    ...base,
    closed: run.whole && o.closed,
    rail2: [],
    stitchAngles: [],
    points: keepIdx.map((i) => pathNode(s[i]!.c[0], s[i]!.c[1], 'corner', widths ? distance(s[i]!.a, s[i]!.b) : null)),
  };
}

/**
 * cutColumn: the column sampled every 0.25 mm; runs of samples whose middle lies outside the
 * cutter (at least minLength long) rebuilt as satin or two-rail pieces. Null when nothing is
 * cut; [] when the cutter covers it all.
 */
export function cutColumn(o: StitchObject, cutter: Region, minLength = COLUMN_MIN_LENGTH): NewObject[] | null {
  const samples = columnSamples(o);
  if (!samples || samples.length < 2 || !cutter.length) return null;
  const runs = keptRuns(samples, (p) => pointInRegion(cutter, p.c) === 'outside', o.closed, minLength);
  if (runs.length === 1 && runs[0]!.whole) return null;
  return runs.map((r) => pieceFromRun(o, r));
}

// ---- knockout ----

interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function regionBox(region: Region): Box | null {
  let box: Box | null = null;
  for (const poly of region) {
    for (const [x, y] of poly.outer) {
      box = box ? { minX: Math.min(box.minX, x), minY: Math.min(box.minY, y), maxX: Math.max(box.maxX, x), maxY: Math.max(box.maxY, y) } : { minX: x, minY: y, maxX: x, maxY: y };
    }
  }
  return box;
}

const boxesMeet = (a: Box, b: Box) => a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY;

/** Knocks a cutter out of a dense area fill: null when untouched. */
function knockFill(o: StitchObject, cutter: Region): NewObject[] | null {
  const area = areaRegion(o);
  const shrunk = bufferRegion(cutter, -KNOCKOUT_OVERLAP);
  if (!area.length || !shrunk.length) return null;
  const left = difference(area, shrunk);
  if (Math.abs(regionArea(left) - regionArea(area)) < 1e-6) return null;
  const pieces = left.filter((poly) => regionWidth([poly]) >= KNOCKOUT_MIN_PIECE);
  return regionObjects(pieces, objectBase(o));
}

/**
 * Knockout overlaps: each cutter (by id) cuts away the parts of earlier objects under it.
 * Cutter area = outline (fills) or band (satins); cutters narrower than 2 mm are ignored.
 * Dense fills lose the cutters shrunk by a 1 mm overlap (pieces under 1 mm wide dropped);
 * satins are cut by cutColumn; open stitches stay as background. Returns the replacement
 * pieces by object id ([] = removed).
 */
export function knockoutPlan(objects: readonly StitchObject[], cutterIds: readonly number[]): Map<number, NewObject[]> {
  const cutters = new Set(cutterIds);
  const areas = new Map<number, { region: Region; box: Box; index: number }>();
  objects.forEach((o, index) => {
    if (!cutters.has(o.id)) return;
    const region = objectArea(o);
    const box = regionBox(region);
    if (box && regionWidth(region) >= KNOCKOUT_MIN_CUTTER) areas.set(o.id, { region, box, index });
  });
  const plan = new Map<number, NewObject[]>();
  objects.forEach((o, index) => {
    if (cutters.has(o.id) || !isCuttable(o)) return;
    const t = o.settings.stitchType;
    const fill = DENSE_FILL_TYPES.includes(t);
    if (!fill && !SATIN_TYPES.includes(t)) return;
    const own = regionBox(objectArea(o));
    if (!own) return;
    const over = [...areas.values()].filter((c) => c.index > index && boxesMeet(c.box, own)).map((c) => c.region);
    if (!over.length) return;
    const cutter = unionAll(over);
    const pieces = fill ? knockFill(o, cutter) : cutColumn(o, cutter);
    if (pieces) plan.set(o.id, pieces);
  });
  return plan;
}

// ---- applique ----

export type AppliqueRole = 'placement' | 'tackDown' | 'cover';

/** Applique pieces are recognised by their names. */
export const APPLIQUE_NAMES: Readonly<Record<AppliqueRole, string>> = {
  placement: 'Applique placement',
  tackDown: 'Applique tack-down',
  cover: 'Applique cover',
};

export function appliqueRole(o: StitchObject): AppliqueRole | null {
  for (const role of Object.keys(APPLIQUE_NAMES) as AppliqueRole[]) if (o.name.startsWith(APPLIQUE_NAMES[role])) return role;
  return null;
}

export type TackDownKind = 'e_stitch' | 'zigzag' | 'running';

export interface AppliqueOptions {
  tackDown: TackDownKind;
  /** Hoop out to this point after the placement run instead of a plain stop. */
  hoopOut: Point | null;
  tackWidth: number;
  coverWidth: number;
}

export const DEFAULT_APPLIQUE: Readonly<AppliqueOptions> = { tackDown: 'e_stitch', hoopOut: null, tackWidth: 2, coverWidth: 3 };

/**
 * Auto applique along closed outlines (rings in mm): a placement run then a stop (or hoop
 * out), a tack-down (E stitch pointing in, zigzag or run) then a stop, and the cover satin.
 * The host groups the pieces.
 */
export function appliquePieces(rings: readonly Point[][], base: NewObject, opts: Partial<AppliqueOptions> = {}): NewObject[] {
  const o = { ...DEFAULT_APPLIQUE, ...opts };
  const outlines = rings.map((r) => ({ nodes: ringNodes(r), cw: ringArea(r) >= 0 })).filter((r) => r.nodes.length >= 3);
  if (!outlines.length) return [];
  const piece = (role: AppliqueRole, nodes: PathNode[], settings: NewObject['settings'], last: boolean, extra: NewObject = {}): NewObject => ({
    ...base,
    name: APPLIQUE_NAMES[role],
    closed: true,
    points: nodes.map((n) => ({ ...n })),
    holes: [],
    rail2: [],
    stitchAngles: [],
    settings,
    stopAfter: false,
    hoopOut: null,
    ...(last ? extra : {}),
  });
  const n = outlines.length;
  const placement = outlines.map((r, i) =>
    piece('placement', r.nodes, defaultSettings({ stitchType: 'running' }), i === n - 1, o.hoopOut ? { hoopOut: [o.hoopOut[0], o.hoopOut[1]] } : { stopAfter: true }),
  );
  // E stitch prongs point into the fabric: with y down the inside of a clockwise ring is on the
  // right of travel, where the prongs go unflipped.
  const tack = outlines.map((r, i) =>
    piece('tackDown', r.nodes, defaultSettings({ stitchType: o.tackDown, satinWidth: o.tackWidth, eFlip: !r.cw, underlayEnabled: false }), i === n - 1, { stopAfter: true }),
  );
  const cover = outlines.map((r, i) => piece('cover', r.nodes, defaultSettings({ stitchType: 'satin', satinWidth: o.coverWidth }), i === n - 1));
  return [...placement, ...tack, ...cover];
}

/** The fabric outline of an applique placement run, as a region. */
function fabricRegion(o: StitchObject): Region {
  return o.points.length >= 3 ? polygonFromRings(materializePath(o.points, true)) : [];
}

/**
 * Partial applique: a later applique piece's fabric outline cuts the cover satin of every
 * earlier piece (cutColumn). Returns replacement covers by id.
 */
export function partialAppliquePlan(objects: readonly StitchObject[]): Map<number, NewObject[]> {
  const plan = new Map<number, NewObject[]>();
  objects.forEach((cover, i) => {
    if (appliqueRole(cover) !== 'cover' || !isCuttable(cover)) return;
    const fabrics = objects
      .slice(i + 1)
      .filter((p) => appliqueRole(p) === 'placement' && (cover.groupId === null || p.groupId !== cover.groupId))
      .map(fabricRegion)
      .filter((r) => r.length);
    if (!fabrics.length) return;
    const pieces = cutColumn(cover, unionAll(fabrics));
    if (pieces) plan.set(cover.id, pieces);
  });
  return plan;
}
