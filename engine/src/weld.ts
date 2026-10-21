// Merge shapes; "what an object covers".

import { columnFromCentreline, railColumn } from './columns';
import type { StitchObject } from './document';
import { areaRegion } from './generate';
import { closeRing, nestRings, offsetOutlines, polygonFromRings, type Region } from './geometry';
import { douglasPeucker, materializePath } from './path';
import type { Point } from './types';
import { isAreaType } from './types';

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
