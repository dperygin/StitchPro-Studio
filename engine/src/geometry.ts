// JSTS wrapper. EVERY polygon operation (union, buffer/offset, clip, covers) lives here.

import GeometryFactory from 'jsts/org/locationtech/jts/geom/GeometryFactory.js';
import Coordinate from 'jsts/org/locationtech/jts/geom/Coordinate.js';
import OverlayOp from 'jsts/org/locationtech/jts/operation/overlay/OverlayOp.js';
import type { Point } from './types';

const factory = new GeometryFactory();

function toPolygon(ring: readonly Point[]) {
  const coords = ring.map(([x, y]) => new Coordinate(x, y));
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first && last && (first[0] !== last[0] || first[1] !== last[1])) {
    coords.push(new Coordinate(first[0], first[1]));
  }
  return factory.createPolygon(factory.createLinearRing(coords));
}

export function polygonArea(ring: readonly Point[]): number {
  return toPolygon(ring).getArea();
}

/** Area of the union of two simple polygons (placeholder until the full wrapper lands). */
export function unionArea(a: readonly Point[], b: readonly Point[]): number {
  return OverlayOp.union(toPolygon(a), toPolygon(b)).getArea();
}
