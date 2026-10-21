// Standard shapes, fitted to a box (all closed).

import { pathNode } from './document';
import type { PathNode } from './types';

export type ShapeKind = 'rectangle' | 'circle' | 'triangle' | 'diamond' | 'hexagon' | 'star' | 'heart';
export const SHAPE_KINDS: readonly ShapeKind[] = ['rectangle', 'circle', 'triangle', 'diamond', 'hexagon', 'star', 'heart'];

export interface BoxXY {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Star inner radius as a fraction of the outer one. */
export const STAR_INNER = 0.382;

/** A shape in unit coordinates (roughly -1..1, y down). */
function unitShape(kind: ShapeKind): PathNode[] {
  const at = (u: number, v: number, type: PathNode['type'] = 'corner') => pathNode(u, v, type);
  const polar = (n: number, radius: (i: number) => number, type: PathNode['type'] = 'corner') =>
    Array.from({ length: n }, (_, i) => {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
      return at(radius(i) * Math.cos(a), radius(i) * Math.sin(a), type);
    });
  switch (kind) {
    case 'rectangle':
      return [at(-1, -1), at(1, -1), at(1, 1), at(-1, 1)];
    case 'circle':
      return polar(12, () => 1, 'curve');
    case 'triangle':
      return [at(0, -1), at(1, 1), at(-1, 1)];
    case 'diamond':
      return [at(0, -1), at(1, 0), at(0, 1), at(-1, 0)];
    case 'hexagon':
      return polar(6, () => 1);
    case 'star':
      return polar(10, (i) => (i % 2 === 0 ? 1 : STAR_INNER));
    case 'heart':
      return [
        at(0, -0.55),
        at(0.5, -1, 'curve'),
        at(1, -0.45, 'curve'),
        at(0.65, 0.3, 'curve'),
        at(0, 1),
        at(-0.65, 0.3, 'curve'),
        at(-1, -0.45, 'curve'),
        at(-0.5, -1, 'curve'),
      ];
  }
}

function extent(nodes: readonly PathNode[]) {
  const xs = nodes.map((n) => n.x);
  const ys = nodes.map((n) => n.y);
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

/** Width / height of a shape in its natural proportions (what Ctrl keeps while dragging). */
export function naturalAspect(kind: ShapeKind): number {
  const e = extent(unitShape(kind));
  return (e.maxX - e.minX) / (e.maxY - e.minY);
}

/** The nodes of a standard shape, its extent stretched exactly onto the box. */
export function standardShape(kind: ShapeKind, box: BoxXY): PathNode[] {
  const x0 = Math.min(box.x0, box.x1);
  const x1 = Math.max(box.x0, box.x1);
  const y0 = Math.min(box.y0, box.y1);
  const y1 = Math.max(box.y0, box.y1);
  const unit = unitShape(kind);
  const e = extent(unit);
  return unit.map((n) =>
    pathNode(x0 + ((n.x - e.minX) / (e.maxX - e.minX)) * (x1 - x0), y0 + ((n.y - e.minY) / (e.maxY - e.minY)) * (y1 - y0), n.type, n.width),
  );
}
