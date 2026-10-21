// Merge shapes; "what an object covers".

import { columnFromCentreline, railColumn } from './columns';
import { pathNode, type NewObject, type StitchObject } from './document';
import { areaRegion } from './generate';
import { bufferRegion, closeRing, nestRings, offsetOutlines, polygonFromRings, unionAll, type Region } from './geometry';
import { douglasPeucker, materializePath } from './path';
import type { PathNode, Point } from './types';
import { isAreaType } from './types';

/** Fill holes: how far each new hole fill reaches under the object around it, mm. */
export const FILL_HOLES_MARGIN = 0.3;

/** A band between two edges: one ring for an open column, nested rings for a closed one. */
function band(left: Point[], right: Point[], closed: boolean): Region {
  if (left.length < 2 || right.length < 2) return [];
  if (closed) return nestRings([closeRing(left), closeRing(right)]);
  return polygonFromRings([...left, ...[...right].reverse()]);
}

/**
 * What an object covers (objectArea): an area's outline and holes, or a column's band (its
 * edge rings nested, the outer edge the shell). Open lines and manual stitches cover nothing.
 */
export function objectArea(o: StitchObject): Region {
  const t = o.settings.stitchType;
  if (isAreaType(t)) return areaRegion(o);
  if (t === 'radial_satin') {
    const col = railColumn({ rail1: o.points, rail2: o.rail2, closed: o.closed, paired: o.settings.pairedRails });
    return col ? band(col.r1, col.r2, o.closed) : [];
  }
  if (t === 'satin' || t === 'zigzag' || t === 'e_stitch') {
    const col = columnFromCentreline(o.points, o.closed, o.settings);
    return col ? band(col.r1, col.r2, o.closed) : [];
  }
  return [];
}

/**
 * Outlines of what an object covers, offset by d mm (negative insets): for insert offset and
 * add border. Closed lines count as the area they enclose.
 */
export function offsetObjectOutlines(o: StitchObject, d: number): Point[][] {
  let area = objectArea(o);
  if (!area.length && o.closed && o.points.length >= 3) area = polygonFromRings(materializePath(o.points, true));
  if (!area.length) return [];
  return offsetOutlines(area, d, 'round').map((ring) => douglasPeucker(ring, 0.05));
}

/** What an object covers, counting a closed line as the area it encloses. */
export function enclosedArea(o: StitchObject): Region {
  const area = objectArea(o);
  if (area.length || !o.closed || o.points.length < 3) return area;
  return polygonFromRings(materializePath(o.points, true));
}

/**
 * An object's fields for new pieces made from it: no id or version, no hand-edited stitches,
 * lettering data or entry/exit; its name only with `keepName` (else new pieces get their own).
 */
export function objectBase(o: StitchObject, keepName = true): NewObject {
  const { id: _id, version: _version, name, ...rest } = o;
  const base: NewObject = { ...rest, settings: { ...o.settings }, customStitches: null, textMeta: null, fillStart: null, fillEnd: null };
  if (keepName) base.name = name;
  return base;
}

/** A closed ring as corner nodes (simplified within 0.02 mm; the repeated end dropped). */
export function ringNodes(ring: readonly Point[]): PathNode[] {
  return douglasPeucker(closeRing(ring), 0.02)
    .slice(0, -1)
    .map(([x, y]) => pathNode(x, y));
}

/** One closed object per polygon of a region (outline and holes), on top of `base`. */
export function regionObjects(region: Region, base: NewObject): NewObject[] {
  return region
    .map((poly) => ({ ...base, closed: true, rail2: [], stitchAngles: [], points: ringNodes(poly.outer), holes: poly.holes.map(ringNodes).filter((h) => h.length >= 3) }))
    .filter((o) => o.points.length >= 3);
}

/**
 * Weld: the union of the objects' areas as new objects with the first object's settings (a
 * stitch type that isn't an area becomes tatami).
 */
export function weldObjects(objects: readonly StitchObject[]): NewObject[] {
  const first = objects[0];
  if (!first) return [];
  const union = unionAll(objects.map(enclosedArea));
  const settings = isAreaType(first.settings.stitchType) ? { ...first.settings } : { ...first.settings, stitchType: 'fill' as const };
  return regionObjects(union, { ...objectBase(first, false), settings, groupId: null });
}

/** Fill holes: each hole as a new object with the same settings, grown by the margin. */
export function fillHoleObjects(o: StitchObject, margin = FILL_HOLES_MARGIN): NewObject[] {
  const base = objectBase(o, false);
  return o.holes.flatMap((h) => {
    const hole = polygonFromRings(materializePath(h, true));
    return regionObjects(margin > 0 ? bufferRegion(hole, margin) : hole, base);
  });
}
