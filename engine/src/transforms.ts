// Move/rotate/scale/skew/mirror and copy tools.

import type { StitchObject } from './document';
import type { PathNode, Point } from './types';

/** Applies f to every position an object carries (nodes, holes, rails, entry/exit, angles, hand edits, hoop out). */
export function mapObjectPoints(o: StitchObject, f: (p: Point) => Point): Omit<StitchObject, 'id' | 'version'> {
  const node = (n: PathNode): PathNode => {
    const [x, y] = f([n.x, n.y]);
    return { ...n, x, y };
  };
  const pt = (p: Point | null) => (p ? f(p) : null);
  return {
    ...o,
    points: o.points.map(node),
    holes: o.holes.map((h) => h.map(node)),
    rail2: o.rail2.map(node),
    fillStart: pt(o.fillStart),
    fillEnd: pt(o.fillEnd),
    hoopOut: pt(o.hoopOut),
    customStitches: o.customStitches ? o.customStitches.map(f) : null,
    stitchAngles: o.stitchAngles.map(([a, b]) => [f(a), f(b)] as [Point, Point]),
  };
}

/** A copy of the object moved by (dx, dy) mm, version bumped. */
export function translateObject(o: StitchObject, dx: number, dy: number): StitchObject {
  return { ...mapObjectPoints(o, ([x, y]) => [x + dx, y + dy]), id: o.id, version: o.version + 1 };
}
