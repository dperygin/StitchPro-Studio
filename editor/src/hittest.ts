// Shape cache and hit testing. Shapes (materialized outlines) are cached by (id, version).

import {
  distanceToPolyline,
  isAreaType,
  isColumnType,
  materializePath,
  pointInRegion,
  type Point,
  type StitchDocument,
  type StitchObject,
} from '@stitchpro/engine';

export interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface Shape {
  /** The dense outline / centreline. */
  outline: Point[];
  holes: Point[][];
  rail2: Point[];
  closed: boolean;
  /** Clicking inside counts (closed fills). */
  solid: boolean;
  /** Two-rail satins and Columns: the band between the rails counts as inside. */
  band: boolean;
  /** Satin, zigzag and E stitch columns: clicks within half the column width count. */
  halfWidth: number;
  box: Box;
}

export function boxOf(points: readonly Point[]): Box {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

export function unionBox(a: Box | null, b: Box): Box {
  if (!a) return { ...b };
  return { minX: Math.min(a.minX, b.minX), minY: Math.min(a.minY, b.minY), maxX: Math.max(a.maxX, b.maxX), maxY: Math.max(a.maxY, b.maxY) };
}

export const boxInside = (inner: Box, outer: Box) =>
  inner.minX >= outer.minX && inner.maxX <= outer.maxX && inner.minY >= outer.minY && inner.maxY <= outer.maxY;

export class ShapeCache {
  private entries = new Map<number, { version: number; shape: Shape }>();

  get(o: StitchObject): Shape {
    const hit = this.entries.get(o.id);
    if (hit && hit.version === o.version) return hit.shape;
    const outline = materializePath(o.points, o.closed);
    const holes = o.holes.map((h) => materializePath(h, true));
    const rail2 = materializePath(o.rail2, o.closed);
    const all = [...outline, ...rail2, ...holes.flat()];
    const shape: Shape = {
      outline,
      holes,
      rail2,
      closed: o.closed,
      solid: o.closed && isAreaType(o.settings.stitchType),
      band: o.settings.stitchType === 'radial_satin' && rail2.length > 1 && outline.length > 1,
      halfWidth: isColumnType(o.settings.stitchType) ? o.settings.satinWidth / 2 : 0,
      box: all.length ? boxOf(all) : { minX: 0, minY: 0, maxX: 0, maxY: 0 },
    };
    this.entries.set(o.id, { version: o.version, shape });
    return shape;
  }

  prune(objects: readonly StitchObject[]): void {
    const live = new Set(objects.map((o) => o.id));
    for (const id of this.entries.keys()) if (!live.has(id)) this.entries.delete(id);
  }
}

/** Distance from p to an object's lines (outline, holes, second rail); 0 inside a solid shape or a column. */
export function distanceToShape(shape: Shape, p: Point): number {
  if (shape.solid && shape.outline.length > 2 && pointInRegion([{ outer: shape.outline, holes: shape.holes }], p) !== 'outside') return 0;
  if (shape.band) {
    // Open: the ring rail 1 then rail 2 backwards; closed: between the two rings (even-odd).
    const region = shape.closed ? [{ outer: shape.outline, holes: [shape.rail2] }] : [{ outer: [...shape.outline, ...[...shape.rail2].reverse()], holes: [] }];
    if (pointInRegion(region, p) !== 'outside') return 0;
  }
  let d = shape.outline.length === 1 ? Math.hypot(p[0] - shape.outline[0]![0], p[1] - shape.outline[0]![1]) : distanceToPolyline(p, shape.outline);
  for (const h of shape.holes) d = Math.min(d, distanceToPolyline(p, h));
  if (shape.rail2.length) d = Math.min(d, distanceToPolyline(p, shape.rail2));
  return Math.max(0, d - shape.halfWidth);
}

/** The topmost (last sewn) visible, unlocked object within tol mm of p. */
export function pickObject(doc: StitchDocument, shapes: ShapeCache, p: Point, tol: number, includeLocked = false): StitchObject | null {
  for (let i = doc.objects.length - 1; i >= 0; i--) {
    const o = doc.objects[i]!;
    if (!o.visible || (o.locked && !includeLocked)) continue;
    const s = shapes.get(o);
    if (p[0] < s.box.minX - tol || p[0] > s.box.maxX + tol || p[1] < s.box.minY - tol || p[1] > s.box.maxY + tol) continue;
    if (distanceToShape(s, p) <= tol) return o;
  }
  return null;
}

/** Index of the node of `o` (points, then rail 2 offset by points.length) nearest p within tol, or -1. */
export function pickNode(o: StitchObject, p: Point, tol: number): number {
  const all = [...o.points, ...o.rail2];
  let best = -1;
  let bestD = tol;
  all.forEach((n, i) => {
    const d = Math.hypot(n.x - p[0], n.y - p[1]);
    if (d <= bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

/** Objects whose shape lies wholly inside the box. */
export function objectsInBox(doc: StitchDocument, shapes: ShapeCache, box: Box): StitchObject[] {
  return doc.objects.filter((o) => o.visible && !o.locked && boxInside(shapes.get(o).box, box));
}
