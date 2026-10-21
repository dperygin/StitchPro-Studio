// Polygon operations. This is the ONLY file that touches JSTS: everything here takes and
// returns plain data (rings of [x, y] points in mm, y down).
//
// Conventions: a Ring is closed (first point repeated at the end). A Region is a list of
// polygons, each an outer ring with holes; [] is the empty region.
// Note: JSTS PreparedGeometry is broken in v2.12, so predicates use plain RelateOp.

import GeometryFactory from 'jsts/org/locationtech/jts/geom/GeometryFactory.js';
import Coordinate from 'jsts/org/locationtech/jts/geom/Coordinate.js';
import BufferOp from 'jsts/org/locationtech/jts/operation/buffer/BufferOp.js';
import BufferParameters from 'jsts/org/locationtech/jts/operation/buffer/BufferParameters.js';
import OffsetCurveBuilder from 'jsts/org/locationtech/jts/operation/buffer/OffsetCurveBuilder.js';
import OverlayOp from 'jsts/org/locationtech/jts/operation/overlay/OverlayOp.js';
import RelateOp from 'jsts/org/locationtech/jts/operation/relate/RelateOp.js';
import UnaryUnionOp from 'jsts/org/locationtech/jts/operation/union/UnaryUnionOp.js';
import Polygonizer from 'jsts/org/locationtech/jts/operation/polygonize/Polygonizer.js';
import IsValidOp from 'jsts/org/locationtech/jts/operation/valid/IsValidOp.js';
import InteriorPointArea from 'jsts/org/locationtech/jts/algorithm/InteriorPointArea.js';
import { closestOnSegment, distance, distanceToSegment, douglasPeucker } from './path';
import type { Point } from './types';

export type Ring = Point[];

export interface Polygon {
  outer: Ring;
  holes: Ring[];
}

export type Region = Polygon[];

/** A point, an open line, or a region: what the predicates accept. */
export type Shape = Point | Point[] | Region;

// JSTS ships `any`-typed declarations; keep that confined to this file.
type JGeom = any;

const factory = new GeometryFactory();
const EPS = 1e-9;

// ---- conversions ----

const samePoint = (a: Point, b: Point) => Math.abs(a[0] - b[0]) <= EPS && Math.abs(a[1] - b[1]) <= EPS;

/** A copy of the ring with repeated neighbours removed and the first point repeated at the end. */
export function closeRing(ring: readonly Point[]): Ring {
  const out: Ring = [];
  for (const p of ring) if (!out.length || !samePoint(out[out.length - 1]!, p)) out.push([p[0], p[1]]);
  if (out.length > 1 && samePoint(out[0]!, out[out.length - 1]!)) out.pop();
  if (out.length) out.push([out[0]![0], out[0]![1]]);
  return out;
}

const coords = (pts: readonly Point[]) => pts.map(([x, y]) => new Coordinate(x, y));
const fromCoords = (cs: { x: number; y: number }[]): Point[] => cs.map((c) => [c.x, c.y]);

function ringToJsts(ring: readonly Point[]): JGeom | null {
  const r = closeRing(ring);
  return r.length >= 4 ? factory.createLinearRing(coords(r)) : null;
}

function polygonToJsts(poly: Polygon): JGeom | null {
  const shell = ringToJsts(poly.outer);
  if (!shell) return null;
  const holes = poly.holes.map(ringToJsts).filter((h) => h !== null);
  return factory.createPolygon(shell, holes);
}

function regionToJsts(region: Region): JGeom {
  const polys = region.map(polygonToJsts).filter((p) => p !== null);
  return polys.length === 1 ? polys[0] : factory.createMultiPolygon(polys);
}

function lineToJsts(line: readonly Point[]): JGeom {
  const pts: Point[] = [];
  for (const p of line) if (!pts.length || !samePoint(pts[pts.length - 1]!, p)) pts.push(p);
  if (pts.length === 0) return factory.createLineString([]);
  if (pts.length === 1) return factory.createPoint(new Coordinate(pts[0]![0], pts[0]![1]));
  return factory.createLineString(coords(pts));
}

function shapeToJsts(s: Shape): JGeom {
  if (s.length === 0) return factory.createMultiPolygon([]);
  if (typeof s[0] === 'number') return factory.createPoint(new Coordinate(s[0], (s as Point)[1]));
  if (Array.isArray(s[0])) return lineToJsts(s as Point[]);
  return regionToJsts(s as Region);
}

/** Every polygon in a JSTS geometry (lines and points are dropped). */
function regionFromJsts(g: JGeom): Region {
  const out: Region = [];
  const walk = (geom: JGeom) => {
    if (geom.isEmpty()) return;
    const type: string = geom.getGeometryType();
    if (type === 'Polygon') {
      const holes: Ring[] = [];
      for (let i = 0; i < geom.getNumInteriorRing(); i++) holes.push(fromCoords(geom.getInteriorRingN(i).getCoordinates()));
      out.push({ outer: fromCoords(geom.getExteriorRing().getCoordinates()), holes });
    } else if (type === 'MultiPolygon' || type === 'GeometryCollection') {
      for (let i = 0; i < geom.getNumGeometries(); i++) walk(geom.getGeometryN(i));
    }
  };
  walk(g);
  return out;
}

// ---- construction and inspection ----

/** A region from an outline and holes; self-intersecting input is repaired (see repairRegion). */
export function polygonFromRings(outer: readonly Point[], holes: readonly (readonly Point[])[] = []): Region {
  const poly: Polygon = { outer: closeRing(outer), holes: holes.map(closeRing).filter((h) => h.length >= 4) };
  const g = polygonToJsts(poly);
  if (!g) return [];
  return IsValidOp.isValid(g) ? regionFromJsts(g) : repairRegion([poly]);
}

/** The separate pieces of a region, each as its own region. */
export function regionPieces(region: Region): Region[] {
  return region.map((p) => [p]);
}

/** Every ring of a region: each outline followed by its holes. */
export function regionRings(region: Region): Ring[] {
  return region.flatMap((p) => [p.outer, ...p.holes]);
}

const isValidRegion = (region: Region): boolean => IsValidOp.isValid(regionToJsts(region));

/**
 * Repairs an invalid region by the even-odd rule: the rings are noded and the faces rebuilt
 * (JSTS Polygonizer); a face is kept when it lies inside an odd number of rings. A zero-width
 * buffer alone would drop half of a figure-8 outline, so it is only the fallback.
 */
export function repairRegion(region: Region): Region {
  const rings = regionRings(region).map(closeRing).filter((r) => r.length >= 4);
  if (!rings.length) return [];
  try {
    const noded = UnaryUnionOp.union(factory.createMultiLineString(rings.map((r) => factory.createLineString(coords(r)))));
    const polygonizer = new Polygonizer();
    polygonizer.add(noded);
    const faces: JGeom[] = polygonizer.getPolygons().toArray();
    const kept = faces.filter((face) => {
      const p = InteriorPointArea.getInteriorPoint(face);
      return p && rings.filter((r) => pointInRing(r, [p.x, p.y])).length % 2 === 1;
    });
    if (kept.length) return regionFromJsts(UnaryUnionOp.union(factory.createGeometryCollection(kept)));
  } catch {
    // fall back to the zero-width buffer
  }
  return regionFromJsts(BufferOp.bufferOp(regionToJsts(region), 0));
}

// ---- buffers and offsets ----

export interface BufferOptions {
  join?: 'round' | 'mitre';
  cap?: 'round' | 'flat' | 'square';
  /** Segments per quarter circle on round joins/caps. */
  quadrantSegments?: number;
  mitreLimit?: number;
}

function bufferParams(opts: BufferOptions): JGeom {
  const p = new BufferParameters();
  p.setQuadrantSegments(opts.quadrantSegments ?? 8);
  p.setJoinStyle(opts.join === 'mitre' ? BufferParameters.JOIN_MITRE : BufferParameters.JOIN_ROUND);
  p.setEndCapStyle(
    opts.cap === 'flat' ? BufferParameters.CAP_FLAT : opts.cap === 'square' ? BufferParameters.CAP_SQUARE : BufferParameters.CAP_ROUND,
  );
  if (opts.mitreLimit !== undefined) p.setMitreLimit(opts.mitreLimit);
  return p;
}

/** Polygon offset (Minkowski sum with a disc of radius d; negative d shrinks). */
export function bufferRegion(region: Region, d: number, opts: BufferOptions = {}): Region {
  if (!region.length) return [];
  return regionFromJsts(BufferOp.bufferOp(regionToJsts(region), d, bufferParams(opts)));
}

/** The area within halfWidth of a line (round caps unless told otherwise). */
export function bandRegion(line: readonly Point[], halfWidth: number, opts: BufferOptions = {}): Region {
  if (!line.length || !(halfWidth > 0)) return [];
  return regionFromJsts(BufferOp.bufferOp(lineToJsts(line), halfWidth, bufferParams(opts)));
}

/** The outlines of a closed shape offset by d (negative = inset), as rings. */
export function offsetOutlines(region: Region, d: number, join: 'round' | 'mitre' = 'round'): Ring[] {
  return regionRings(bufferRegion(region, d, { join }));
}

/**
 * An open line offset to one side with mitre joins, simplified to 0.05 mm. Positive d is
 * to the left of the direction of travel as seen on screen (y down).
 */
export function offsetLine(line: readonly Point[], d: number, mitreLimit = 5): Point[] {
  const pts = line.filter((p, i) => i === 0 || !samePoint(line[i - 1]!, p));
  if (pts.length < 2 || d === 0) return pts.map((p) => [p[0], p[1]]);
  const builder = new OffsetCurveBuilder(factory.getPrecisionModel(), bufferParams({ join: 'mitre', mitreLimit }));
  // JSTS measures "left" with y up; on screen (y down) that side is the right, hence -d.
  return douglasPeucker(fromCoords(builder.getOffsetCurve(coords(pts), -d)), 0.05);
}

// ---- predicates and overlays ----

/** True when a has no point of b outside it (boundary counts as inside). */
export function covers(a: Region, b: Shape): boolean {
  if (!a.length) return false;
  return RelateOp.covers(regionToJsts(a), shapeToJsts(b));
}

/** True when b lies in the interior of a (touching the boundary only is not enough for a point). */
export function contains(a: Region, b: Shape): boolean {
  if (!a.length) return false;
  return RelateOp.contains(regionToJsts(a), shapeToJsts(b));
}

/** Runs a JSTS overlay; on a topology failure repairs the inputs and tries once more. */
function overlay(op: (a: JGeom, b: JGeom) => JGeom, a: Region, b: Region): Region {
  try {
    return regionFromJsts(op(regionToJsts(a), regionToJsts(b)));
  } catch {
    return regionFromJsts(op(regionToJsts(repairRegion(a)), regionToJsts(repairRegion(b))));
  }
}

/** a minus b (knockouts). */
export function difference(a: Region, b: Region): Region {
  if (!a.length) return [];
  if (!b.length) return a;
  return overlay((x, y) => OverlayOp.difference(x, y), a, b);
}

export function intersection(a: Region, b: Region): Region {
  if (!a.length || !b.length) return [];
  return overlay((x, y) => OverlayOp.intersection(x, y), a, b);
}

/**
 * Union of many areas (unary union). JSTS can return a wrong answer for invalid input
 * without failing, so invalid parts are repaired first; if the union still fails, every
 * part is repaired with a zero-width buffer and the union retried.
 */
export function unionAll(regions: readonly Region[]): Region {
  const parts = regions.filter((r) => r.length).map((r) => (isValidRegion(r) ? r : repairRegion(r)));
  if (!parts.length) return [];
  const run = (rs: readonly Region[]) =>
    regionFromJsts(UnaryUnionOp.union(factory.createGeometryCollection(rs.map(regionToJsts))));
  try {
    return run(parts);
  } catch {
    return run(parts.map((r) => regionFromJsts(BufferOp.bufferOp(regionToJsts(r), 0))));
  }
}

/**
 * Splits a region along a line into pieces: the outline is noded with the line and the
 * faces rebuilt by the JSTS Polygonizer; faces inside the region are kept. If noding fails,
 * the line buffered by 0.005 mm is subtracted instead.
 */
export function splitRegion(region: Region, line: readonly Point[]): Region[] {
  if (!region.length || line.length < 2) return regionPieces(region);
  try {
    const lines = [...regionRings(region).map((r) => factory.createLineString(coords(closeRing(r)))), lineToJsts(line)];
    const noded = UnaryUnionOp.union(factory.createMultiLineString(lines));
    const polygonizer = new Polygonizer();
    polygonizer.add(noded);
    const faces: JGeom[] = polygonizer.getPolygons().toArray();
    const out: Region[] = [];
    for (const face of faces) {
      const inside = InteriorPointArea.getInteriorPoint(face);
      if (inside && pointInRegion(region, [inside.x, inside.y]) === 'inside') out.push(regionFromJsts(face));
    }
    if (out.length) return out;
  } catch {
    // fall through to the subtraction fallback
  }
  return regionPieces(difference(region, bandRegion(line, 0.005, { cap: 'flat' })));
}

// ---- measures ----

/** Shoelace formula. With y down, a positive area means the ring runs clockwise on screen. */
export function ringArea(ring: readonly Point[]): number {
  let s = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}

/** Ring direction as seen on screen (y down). */
export function ringOrientation(ring: readonly Point[]): 'cw' | 'ccw' {
  return ringArea(ring) >= 0 ? 'cw' : 'ccw';
}

export function regionArea(region: Region): number {
  return region.reduce((sum, p) => sum + Math.abs(ringArea(p.outer)) - p.holes.reduce((h, r) => h + Math.abs(ringArea(r)), 0), 0);
}

export function regionPerimeter(region: Region): number {
  let total = 0;
  for (const r of regionRings(region)) for (let i = 1; i < r.length; i++) total += distance(r[i - 1]!, r[i]!);
  return total;
}

/** Typical width of a region: 2 x area / perimeter. */
export function regionWidth(region: Region): number {
  const p = regionPerimeter(region);
  return p > 0 ? (2 * regionArea(region)) / p : 0;
}

// ---- points, nesting and lines (exact, no JSTS needed) ----

function pointInRing(ring: readonly Point[], p: Point): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!;
    const b = ring[j]!;
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

/** Where a point lies relative to a region (even-odd over all rings). */
export function pointInRegion(region: Region, p: Point, tolerance = 1e-9): 'inside' | 'outside' | 'boundary' {
  let inside = false;
  for (const ring of regionRings(region)) {
    for (let i = 1; i < ring.length; i++) if (distanceToSegment(p, ring[i - 1]!, ring[i]!) <= tolerance) return 'boundary';
    if (pointInRing(ring, p)) inside = !inside;
  }
  return inside ? 'inside' : 'outside';
}

/** The nearest point of the region's outline to p, and its distance. */
export function nearestOnBoundary(region: Region, p: Point): { point: Point; distance: number } {
  let best: { point: Point; distance: number } = { point: [p[0], p[1]], distance: Infinity };
  for (const ring of regionRings(region)) {
    for (let i = 1; i < ring.length; i++) {
      const c = closestOnSegment(p, ring[i - 1]!, ring[i]!).point;
      const d = distance(p, c);
      if (d < best.distance) best = { point: c, distance: d };
    }
  }
  return best;
}

/** The nearest point of the region to p (p itself when inside) and the distance (0 inside). */
export function nearestPoint(region: Region, p: Point): { point: Point; distance: number } {
  if (pointInRegion(region, p) !== 'outside') return { point: [p[0], p[1]], distance: 0 };
  return nearestOnBoundary(region, p);
}

/** Distance from p to the region (0 inside). */
export function distanceToRegion(region: Region, p: Point): number {
  return nearestPoint(region, p).distance;
}

/**
 * Sorts loose rings into polygons by even-odd containment: a ring inside an even number
 * of others is an outline, inside an odd number a hole of the smallest ring around it.
 */
export function nestRings(rings: readonly (readonly Point[])[]): Region {
  const rs = rings.map(closeRing).filter((r) => r.length >= 4);
  const areas = rs.map((r) => Math.abs(ringArea(r)));
  const probe = (i: number, j: number): Point => rs[i]!.find((p) => !onRing(rs[j]!, p)) ?? rs[i]![0]!;
  const containers = rs.map((_, i) =>
    rs.map((_, j) => j).filter((j) => j !== i && areas[j]! >= areas[i]! && pointInRing(rs[j]!, probe(i, j))),
  );
  const depth = containers.map((c) => c.length);
  const shells = new Map<number, Polygon>();
  rs.forEach((r, i) => {
    if (depth[i]! % 2 === 0) shells.set(i, { outer: r, holes: [] });
  });
  rs.forEach((r, i) => {
    if (depth[i]! % 2 === 0) return;
    const parent = containers[i]!.filter((j) => depth[j] === depth[i]! - 1).sort((a, b) => areas[a]! - areas[b]!)[0];
    if (parent !== undefined) shells.get(parent)!.holes.push(r);
  });
  return [...shells.values()];
}

function onRing(ring: readonly Point[], p: Point): boolean {
  for (let i = 1; i < ring.length; i++) if (distanceToSegment(p, ring[i - 1]!, ring[i]!) <= EPS) return true;
  return false;
}

/** Arc-length parameters (as segment index + t) where a polyline meets a region's outline. */
function splitParams(line: readonly Point[], region: Region): number[][] {
  const rings = regionRings(region);
  return line.slice(1).map((b, k) => {
    const a = line[k]!;
    const ts = [0, 1];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    for (const ring of rings) {
      for (let i = 1; i < ring.length; i++) {
        const c = ring[i - 1]!;
        const d = ring[i]!;
        const ex = d[0] - c[0];
        const ey = d[1] - c[1];
        const den = dx * ey - dy * ex;
        if (Math.abs(den) > EPS) {
          const t = ((c[0] - a[0]) * ey - (c[1] - a[1]) * ex) / den;
          const u = ((c[0] - a[0]) * dy - (c[1] - a[1]) * dx) / den;
          if (t > 0 && t < 1 && u >= -EPS && u <= 1 + EPS) ts.push(t);
        } else {
          // Parallel: where a collinear edge starts/ends along this segment.
          const len2 = dx * dx + dy * dy;
          for (const q of [c, d]) {
            if (len2 > 0 && distanceToSegment(q, a, b) <= EPS) {
              const t = ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / len2;
              if (t > 0 && t < 1) ts.push(t);
            }
          }
        }
      }
    }
    return [...new Set(ts)].sort((x, y) => x - y);
  });
}

/** Pieces of a line, in order and direction, whose midpoints satisfy `keep`. */
function partsOfLine(line: readonly Point[], region: Region, keep: (where: 'inside' | 'outside' | 'boundary') => boolean): Point[][] {
  const out: Point[][] = [];
  let current: Point[] | null = null;
  const params = splitParams(line, region);
  params.forEach((ts, k) => {
    const a = line[k]!;
    const b = line[k + 1]!;
    const at = (t: number): Point => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    for (let i = 1; i < ts.length; i++) {
      const t0 = ts[i - 1]!;
      const t1 = ts[i]!;
      const p0 = at(t0);
      const p1 = at(t1);
      if (samePoint(p0, p1)) continue;
      if (keep(pointInRegion(region, at((t0 + t1) / 2)))) {
        if (!current) out.push((current = [p0]));
        current.push(p1);
      } else current = null;
    }
  });
  return out;
}

/** The parts of a line inside (or on the edge of) a region, in line order and direction. */
export function clipLine(line: readonly Point[], region: Region): Point[][] {
  if (line.length < 2 || !region.length) return [];
  return partsOfLine(line, region, (w) => w !== 'outside');
}

/** The parts of a line outside a region, in line order and direction. */
export function lineOutside(line: readonly Point[], region: Region): Point[][] {
  if (line.length < 2) return [];
  if (!region.length) return [line.map((p): Point => [p[0], p[1]])];
  return partsOfLine(line, region, (w) => w === 'outside');
}

// ---- fast rasterized covers tests ----

/** A region rasterized once on a grid: cell (i, j) is set when its centre is covered. */
export interface CoverRaster {
  x0: number;
  y0: number;
  cell: number;
  cols: number;
  rows: number;
  bits: Uint8Array;
}

function emptyRaster(minX: number, minY: number, maxX: number, maxY: number, cell: number): CoverRaster {
  const cols = Math.max(1, Math.ceil((maxX - minX) / cell) + 1);
  const rows = Math.max(1, Math.ceil((maxY - minY) / cell) + 1);
  return { x0: minX, y0: minY, cell, cols, rows, bits: new Uint8Array(cols * rows) };
}

/** Rasterizes a region (even-odd scanlines at cell centres) for fast "is this covered" tests. */
export function fastAreaCovers(region: Region, cell = 0.2): CoverRaster {
  const rings = regionRings(region);
  const all = rings.flat();
  if (!all.length) return emptyRaster(0, 0, 0, 0, cell);
  const xs = all.map((p) => p[0]);
  const ys = all.map((p) => p[1]);
  const r = emptyRaster(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys), cell);
  for (let j = 0; j < r.rows; j++) {
    const y = r.y0 + (j + 0.5) * cell;
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
      const i0 = Math.max(0, Math.ceil((hits[k]! - r.x0) / cell - 0.5));
      const i1 = Math.min(r.cols - 1, Math.floor((hits[k + 1]! - r.x0) / cell - 0.5));
      for (let i = i0; i <= i1; i++) r.bits[j * r.cols + i] = 1;
    }
  }
  return r;
}

/** Rasterizes the band within halfWidth of a line for fast "is this covered" tests. */
export function fastBandCovers(line: readonly Point[], halfWidth: number, cell = 0.2): CoverRaster {
  if (!line.length) return emptyRaster(0, 0, 0, 0, cell);
  const xs = line.map((p) => p[0]);
  const ys = line.map((p) => p[1]);
  const r = emptyRaster(Math.min(...xs) - halfWidth, Math.min(...ys) - halfWidth, Math.max(...xs) + halfWidth, Math.max(...ys) + halfWidth, cell);
  const segs = line.length === 1 ? [[line[0]!, line[0]!]] : line.slice(1).map((b, k) => [line[k]!, b]);
  for (const [a, b] of segs as [Point, Point][]) {
    const i0 = Math.max(0, Math.floor((Math.min(a[0], b[0]) - halfWidth - r.x0) / cell));
    const i1 = Math.min(r.cols - 1, Math.ceil((Math.max(a[0], b[0]) + halfWidth - r.x0) / cell));
    const j0 = Math.max(0, Math.floor((Math.min(a[1], b[1]) - halfWidth - r.y0) / cell));
    const j1 = Math.min(r.rows - 1, Math.ceil((Math.max(a[1], b[1]) + halfWidth - r.y0) / cell));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const idx = j * r.cols + i;
        if (r.bits[idx]) continue;
        if (distanceToSegment([r.x0 + (i + 0.5) * cell, r.y0 + (j + 0.5) * cell], a, b) <= halfWidth) r.bits[idx] = 1;
      }
    }
  }
  return r;
}

function rasterHas(r: CoverRaster, p: Point): boolean {
  const i = Math.floor((p[0] - r.x0) / r.cell);
  const j = Math.floor((p[1] - r.y0) / r.cell);
  return i >= 0 && j >= 0 && i < r.cols && j < r.rows && r.bits[j * r.cols + i] === 1;
}

const anyHas = (rs: readonly CoverRaster[], p: Point) => rs.some((r) => rasterHas(r, p));

/** True when every sample of the move a-b (one per cell) is covered by any of the rasters. */
export function moveCovered(rasters: CoverRaster | readonly CoverRaster[], a: Point, b: Point): boolean {
  const rs = Array.isArray(rasters) ? rasters : [rasters as CoverRaster];
  if (!rs.length) return false;
  const n = Math.max(1, Math.ceil(distance(a, b) / rs[0]!.cell));
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    if (!anyHas(rs, [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])) return false;
  }
  return true;
}

/** How much of the move a-b (mm) is not covered by any of the rasters, sampled once per cell. */
export function uncoveredLength(rasters: CoverRaster | readonly CoverRaster[], a: Point, b: Point): number {
  const rs = Array.isArray(rasters) ? rasters : [rasters as CoverRaster];
  const len = distance(a, b);
  if (!rs.length) return len;
  const n = Math.max(1, Math.ceil(len / rs[0]!.cell));
  let missing = 0;
  for (let k = 0; k < n; k++) {
    const t = (k + 0.5) / n;
    if (!anyHas(rs, [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])) missing++;
  }
  return (len * missing) / n;
}
