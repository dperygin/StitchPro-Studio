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

// ---- affine transforms ----

/** x' = a x + c y + e, y' = b x + d y + f. */
export type Affine = [number, number, number, number, number, number];

export const IDENTITY: Affine = [1, 0, 0, 1, 0, 0];

export function applyAffine(m: Affine, [x, y]: Point): Point {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

/** m1 after m2 (apply m2 first). */
export function compose(m1: Affine, m2: Affine): Affine {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

const about = (cx: number, cy: number, m: Affine): Affine => compose([1, 0, 0, 1, cx, cy], compose(m, [1, 0, 0, 1, -cx, -cy]));

export function translation(dx: number, dy: number): Affine {
  return [1, 0, 0, 1, dx, dy];
}

/** Rotation by deg (clockwise on screen, y down) about (cx, cy). */
export function rotation(deg: number, cx = 0, cy = 0): Affine {
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return about(cx, cy, [c, s, -s, c, 0, 0]);
}

export function scaling(sx: number, sy: number, cx = 0, cy = 0): Affine {
  return about(cx, cy, [sx, 0, 0, sy, 0, 0]);
}

/** Horizontal skew: x' = x - tan(a) (y - anchorY). */
export function skewX(deg: number, anchorY = 0): Affine {
  const t = Math.tan((deg * Math.PI) / 180);
  return [1, 0, -t, 1, t * anchorY, 0];
}

/** Mirror left-right about x = cx (or top-bottom about y = cy with vertical). */
export function mirror(cx: number, cy: number, vertical = false): Affine {
  return vertical ? scaling(1, -1, cx, cy) : scaling(-1, 1, cx, cy);
}

/**
 * A copy of the object under an affine transform, version bumped. Column widths scale by the
 * geometric mean of the two stretch factors (sqrt |det|), and the fill angle turns with the
 * stretch.
 */
export function transformObject(o: StitchObject, m: Affine): StitchObject {
  const moved = mapObjectPoints(o, (p) => applyAffine(m, p));
  const k = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
  const scaleW = (n: PathNode): PathNode => (n.width === null ? n : { ...n, width: n.width * k });
  const a = (o.settings.fillAngle * Math.PI) / 180;
  const dir = [m[0] * Math.cos(a) + m[2] * Math.sin(a), m[1] * Math.cos(a) + m[3] * Math.sin(a)];
  let angle = (Math.atan2(dir[1]!, dir[0]!) * 180) / Math.PI;
  angle = Math.round(angle * 1e9) / 1e9;
  return {
    ...moved,
    points: moved.points.map(scaleW),
    rail2: moved.rail2.map(scaleW),
    settings: { ...o.settings, satinWidth: o.settings.satinWidth * k, fillAngle: angle },
    id: o.id,
    version: o.version + 1,
  };
}

/** A copy sewn the other way round (node order reversed). */
export function reversedObject(o: StitchObject): StitchObject {
  return { ...o, points: [...o.points].reverse(), rail2: [...o.rail2].reverse(), version: o.version + 1 };
}
