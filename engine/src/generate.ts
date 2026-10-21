// Picks the generator per stitch type; underlay; how one object is sewn.

import type { StitchObject } from './document';
import {
  autoSplit,
  averageColumnWidth,
  columnFromCentreline,
  columnStitches,
  railColumn,
  railRungAt,
  railUnderlay,
  twoRailStitches,
  type RailColumn,
  type RailInput,
  type RailUnderlayKind,
} from './columns';
import {
  fillEdgeRun,
  fillZigzagUnderlay,
  travelInside,
  laydown,
  radialFill,
  satinFillParams,
  tatamiParams,
  tatamiUnderlay,
  travelAlongEdge,
  travelStitches,
} from './fill';
import { covers, polygonFromRings, regionArea, regionWidth, type Region } from './geometry';
import { motifFill, motifLine } from './motifs';
import { distance, materializePath, projectOntoPolyline, restartRing, subPolyline } from './path';
import { contourFill, crossStitchFill, raisedSatin, runningStitch, stippleFill } from './stitchlib';
import { fillWithAngles } from './turning';
import type { Motif, PathNode, Point, StitchSettings, StitchType, UnderlayKind } from './types';
import { hasUnderlay, isAreaType } from './types';

const ROW_SPACED: readonly StitchType[] = ['fill', 'laydown'];
const SATIN_SPACED: readonly StitchType[] = ['satin', 'radial_satin', 'satin_fill'];
/** A move between layers longer than this travels rather than going straight. */
const JOIN_STRAIGHT_MAX = 7.5;

/**
 * Spacing convention: settings store the distance between two FORWARD rows (tatami) or two
 * FORWARD stitches (satin), so neighbouring sewn lines are half that apart. This returns the
 * settings with those spacings halved, as every generator expects. Apply it once, before any
 * generator runs.
 */
export function sewnSpacing(settings: StitchSettings): StitchSettings {
  const t = settings.stitchType;
  if (ROW_SPACED.includes(t)) return { ...settings, fillRowSpacing: settings.fillRowSpacing / 2 };
  if (SATIN_SPACED.includes(t)) {
    return { ...settings, satinDensity: settings.satinDensity / 2, gradedEndDensity: settings.gradedEndDensity / 2 };
  }
  return settings;
}

/** The area an object's outline and holes enclose. */
export function areaRegion(o: StitchObject): Region {
  return polygonFromRings(materializePath(o.points, true), o.holes.map((h) => materializePath(h, true)));
}

// ---- entry handling ----

/** Open lines sew from the end nearer their entry: the nodes, reversed if needed. */
function orient(nodes: readonly PathNode[], closed: boolean, entry: Point | null): PathNode[] {
  if (closed || !entry || nodes.length < 2) return [...nodes];
  const first = nodes[0]!;
  const last = nodes[nodes.length - 1]!;
  return distance(entry, [last.x, last.y]) < distance(entry, [first.x, first.y]) ? [...nodes].reverse() : [...nodes];
}

/** A line's dense path: closed outlines start at their entry point. */
function linePath(o: StitchObject, entry: Point | null): Point[] {
  const path = materializePath(orient(o.points, o.closed, entry), o.closed);
  return o.closed && entry && path.length > 2 ? restartRing(path, entry) : path;
}

function railInput(o: StitchObject, s: StitchSettings, entry: Point | null): RailInput {
  const r1 = orient(o.points, o.closed, entry);
  const reversed = r1.length > 1 && r1[0] !== o.points[0];
  return {
    rail1: r1,
    rail2: reversed ? [...o.rail2].reverse() : o.rail2,
    closed: o.closed,
    paired: s.pairedRails,
    stitchAngles: o.stitchAngles,
  };
}

const isColumnObject = (t: StitchType) => t === 'satin' || t === 'radial_satin';

/** The column under a satin or two-rail object, oriented by its entry. */
function objectColumn(o: StitchObject, s: StitchSettings, entry: Point | null): RailColumn | null {
  if (s.stitchType === 'radial_satin') return railColumn(railInput(o, s, entry));
  return columnFromCentreline(orient(o.points, o.closed, entry), o.closed, s);
}

// ---- top stitching ----

/**
 * Top stitching of one object. `start` is where the needle is (the end of the underlay), used
 * by fills as their entry; lines and columns are oriented by the object's own entry point.
 */
export function topStitching(o: StitchObject, s: StitchSettings, motifs: readonly Motif[], start: Point | null): Point[] {
  const entry = o.fillStart;
  const fillEntry = start ?? entry;
  switch (s.stitchType) {
    case 'running':
      return runningStitch(linePath(o, entry), s);
    case 'motif_line':
      return motifLine(linePath(o, entry), s, motifs);
    case 'manual':
      return o.points.map((n): Point => [n.x, n.y]);
    case 'satin': {
      const nodes = orient(o.points, o.closed, entry);
      return raisedSatin(s.raisedLayers, (widthScale, spacingScale) =>
        columnStitches(nodes, o.closed, s, 'satin', { widthScale, spacingScale, startAt: o.closed ? entry : null }),
      );
    }
    case 'zigzag':
    case 'e_stitch':
      return columnStitches(orient(o.points, o.closed, entry), o.closed, s, s.stitchType, { startAt: o.closed ? entry : null });
    case 'radial_satin':
      return twoRailStitches(railInput(o, s, entry), s);
    case 'fill':
      return fillWithAngles(areaRegion(o), o.stitchAngles, tatamiParams(s, fillEntry, o.fillEnd));
    case 'satin_fill':
      // Satin fill always splits long stitches.
      return autoSplit(fillWithAngles(areaRegion(o), o.stitchAngles, satinFillParams(s, fillEntry, o.fillEnd)), s.splitLength);
    case 'outline':
      return radialFill(areaRegion(o), s, fillEntry);
    case 'contour':
      return contourFill(areaRegion(o), s);
    case 'stipple':
      return stippleFill(areaRegion(o), s);
    case 'cross_stitch':
      return crossStitchFill(areaRegion(o), s);
    case 'motif_fill':
      return motifFill(areaRegion(o), s, motifs);
    case 'laydown':
      return laydown(areaRegion(o), s, fillEntry, o.fillEnd);
    default:
      return [];
  }
}

/** Top stitching alone, as the object's own settings and entry describe it. */
export function generateTopStitching(o: StitchObject, motifs: readonly Motif[]): Point[] {
  return topStitching(o, sewnSpacing(o.settings), motifs, o.fillStart);
}

// ---- underlay ----

export interface UnderlayPass {
  /** Columns: center / edge / zigzag / double-zigzag. Fills: edge / zigzag / double-zigzag / tatami / double-tatami. */
  kind: string;
  /** Which settings it uses: layer 1 = underlay*, layer 2 = underlay2*. */
  layer: 1 | 2;
}

/** Lettering under 5 mm capital height has no underlay. */
function smallLettering(o: StitchObject): boolean {
  const cap = o.textMeta?.['capHeight'];
  return typeof cap === 'number' && cap < 5;
}

/**
 * Which underlay passes an object gets. Only tatami, satin fill, satin and two-rail/column
 * objects have underlay, never under 2 mm wide (column: average width; fill: 2 x area /
 * perimeter). Automatic: column under 4 mm -> edge run, wider -> edge run + zigzag; fill under
 * 100 mm2 -> edge run, larger -> edge run + tatami. Layer 2 adds underlay2Type's passes.
 */
export function underlayPlan(o: StitchObject, s: StitchSettings = sewnSpacing(o.settings)): UnderlayPass[] {
  if (!s.underlayEnabled || !hasUnderlay(s.stitchType) || smallLettering(o)) return [];
  const column = isColumnObject(s.stitchType);
  let width: number;
  let area = 0;
  if (column) {
    const col = objectColumn(o, s, null);
    if (!col) return [];
    width = averageColumnWidth(col);
  } else {
    const region = areaRegion(o);
    width = regionWidth(region);
    area = regionArea(region);
  }
  if (width < 2) return [];
  const forColumn: Record<string, string> = { tatami: 'zigzag', 'double-tatami': 'double-zigzag' };
  const forFill: Record<string, string> = { center: 'edge' };
  const expand = (k: UnderlayKind, layer: 1 | 2): UnderlayPass[] => {
    if (k === 'none') return [];
    const auto = column ? (width < 4 ? ['edge'] : ['edge', 'zigzag']) : area < 100 ? ['edge'] : ['edge', 'tatami'];
    const kinds = k === 'auto' ? auto : k.split('+');
    return kinds.map((kind) => ({ kind: (column ? forColumn[kind] : forFill[kind]) ?? kind, layer }));
  };
  return [...expand(s.underlayType, 1), ...expand(s.underlay2Type, 2)];
}

function sewUnderlayPass(o: StitchObject, s: StitchSettings, pass: UnderlayPass, start: Point | null): Point[] {
  if (isColumnObject(s.stitchType)) {
    const col = objectColumn(o, s, o.fillStart);
    return col ? railUnderlay(col, s, pass.kind as RailUnderlayKind, pass.layer) : [];
  }
  const region = areaRegion(o);
  switch (pass.kind) {
    case 'edge':
      return fillEdgeRun(region, s, pass.layer, start);
    case 'zigzag':
      return fillZigzagUnderlay(region, s, false, pass.layer);
    case 'double-zigzag':
      return fillZigzagUnderlay(region, s, true, pass.layer);
    case 'tatami':
      return tatamiUnderlay(region, s, pass.layer, start);
    case 'double-tatami': {
      const first = tatamiUnderlay(region, s, pass.layer, start);
      const turned = pass.layer === 1 ? { ...s, underlayAngle: s.underlayAngle + 90 } : { ...s, underlay2Angle: s.underlay2Angle + 90 };
      const second = tatamiUnderlay(region, turned, pass.layer, first[first.length - 1] ?? start);
      return [...first, ...second.slice(1)];
    }
    default:
      return [];
  }
}

// ---- joining layers inside the object ----

type JoinContext = { kind: 'area'; region: Region; travelOnEdge: boolean } | { kind: 'column'; centre: Point[] } | { kind: 'line' };

/** The middle of a rail column, sampled every 1 mm. */
function railCentre(col: RailColumn): Point[] {
  const steps = Math.max(1, Math.ceil(col.length));
  return Array.from({ length: steps + 1 }, (_, k) => {
    const r = railRungAt(col, (col.length * k) / steps);
    return [(r.a[0] + r.b[0]) / 2, (r.a[1] + r.b[1]) / 2] as Point;
  });
}

function joinContext(o: StitchObject, s: StitchSettings): JoinContext {
  const t = s.stitchType;
  if (isAreaType(t)) return { kind: 'area', region: areaRegion(o), travelOnEdge: s.travelOnEdge };
  if (t === 'radial_satin') {
    const col = railColumn(railInput(o, s, o.fillStart));
    return col ? { kind: 'column', centre: railCentre(col) } : { kind: 'line' };
  }
  if (t === 'satin' || t === 'zigzag' || t === 'e_stitch') {
    return { kind: 'column', centre: materializePath(orient(o.points, o.closed, o.fillStart), o.closed) };
  }
  return { kind: 'line' };
}

/**
 * The stitches that take the needle from a to b inside the object (b included). Short moves
 * that stay inside go straight; otherwise fills travel along the edge just inside (with travel
 * on edge off: straight under the fill where that stays inside, round the edge where it would
 * leave it) and columns run back along the middle.
 * Travel stitches are 2.5 mm.
 */
function joinTravel(a: Point, b: Point, ctx: JoinContext): Point[] {
  const d = distance(a, b);
  if (d <= 1e-9) return [];
  if (ctx.kind === 'line') return [b];
  if (ctx.kind === 'area') {
    if (d <= JOIN_STRAIGHT_MAX && covers(ctx.region, [a, b])) return [b];
    if (!ctx.travelOnEdge) return travelStitches(travelInside(a, b, ctx.region, undefined, 0.3));
    return travelStitches(travelAlongEdge(a, b, ctx.region));
  }
  if (d <= JOIN_STRAIGHT_MAX) return [b];
  const pa = projectOntoPolyline(ctx.centre, a);
  const pb = projectOntoPolyline(ctx.centre, b);
  return travelStitches([a, ...subPolyline(ctx.centre, pa.d, pb.d), b]);
}

function appendJoined(out: Point[], pts: readonly Point[], ctx: JoinContext): void {
  if (!pts.length) return;
  if (out.length) {
    out.push(...joinTravel(out[out.length - 1]!, pts[0]!, ctx));
    out.push(...pts.slice(1));
  } else out.push(...pts);
}

/** Underlay passes alone (each starting where the last ended), joined inside the object. */
export function generateUnderlay(o: StitchObject, _motifs: readonly Motif[] = []): Point[] {
  const s = sewnSpacing(o.settings);
  const ctx = joinContext(o, s);
  const out: Point[] = [];
  for (const pass of underlayPlan(o, s)) appendJoined(out, sewUnderlayPass(o, s, pass, out[out.length - 1] ?? o.fillStart), ctx);
  return out;
}

/**
 * How one object is sewn: its underlay layers (each starting where the last ended), then its
 * top stitching, joined inside the object.
 */
export function sewObject(o: StitchObject, motifs: readonly Motif[] = []): Point[] {
  const s = sewnSpacing(o.settings);
  const ctx = joinContext(o, s);
  const out: Point[] = [];
  for (const pass of underlayPlan(o, s)) appendJoined(out, sewUnderlayPass(o, s, pass, out[out.length - 1] ?? o.fillStart), ctx);
  appendJoined(out, topStitching(o, s, motifs, out[out.length - 1] ?? null), ctx);
  return out;
}
