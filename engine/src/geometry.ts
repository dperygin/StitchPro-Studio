// JSTS wrapper. EVERY polygon operation (union, buffer/offset, clip, covers) lives here.

import GeometryFactory from 'jsts/org/locationtech/jts/geom/GeometryFactory.js';
import Coordinate from 'jsts/org/locationtech/jts/geom/Coordinate.js';
import OverlayOp from 'jsts/org/locationtech/jts/operation/overlay/OverlayOp.js';
import type { Point } from './types';

const factory = new GeometryFactory();

function toPolygon(ring: readonly Point[]) {
  const coords = ring.map((p) => new Coordinate(p.x, p.y));
  const first = ring[0];
  if (first && (first.x !== ring[ring.length - 1]!.x || first.y !== ring[ring.length - 1]!.y)) {
    coords.push(new Coordinate(first.x, first.y));
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
