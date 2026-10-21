// Laydown under the design: a light fill sewn first that flattens the fabric's pile.

import type { NewObject, StitchObject } from './document';
import { bandRegion, bufferRegion, polygonFromRings, unionAll, type Region } from './geometry';
import { materializePath } from './path';
import type { Point } from './types';
import { defaultSettings } from './types';
import { objectArea, regionObjects } from './weld';

export type LaydownShape = 'outline' | 'box' | 'ellipse';

/** Lines count as a band this far either side, mm. */
export const LAYDOWN_LINE_HALF_WIDTH = 0.75;
/** Default growth of the laydown beyond the design, mm. */
export const LAYDOWN_OFFSET = 2;

/** What one object adds to the laydown: its area, or its line as a band. */
function laydownPart(o: StitchObject): Region {
  const area = objectArea(o);
  if (area.length) return area;
  const line: Point[] = o.customStitches ?? materializePath(o.points, o.closed);
  return line.length >= 2 ? bandRegion(line, LAYDOWN_LINE_HALF_WIDTH) : [];
}

/**
 * The laydown area: the union of the design's areas and lines (each line a band 0.75 mm either
 * side) grown by the offset; or the box round it; or an ellipse through the box's corners.
 */
export function laydownRegion(objects: readonly StitchObject[], shape: LaydownShape = 'outline', offset = LAYDOWN_OFFSET): Region {
  const parts = objects.filter((o) => o.visible && o.settings.stitchType !== 'laydown').map(laydownPart);
  const union = unionAll(parts);
  if (!union.length) return [];
  if (shape === 'outline') return offset ? bufferRegion(union, offset) : union;
  const xs = union.flatMap((p) => p.outer.map((q) => q[0]));
  const ys = union.flatMap((p) => p.outer.map((q) => q[1]));
  const x0 = Math.min(...xs) - offset;
  const x1 = Math.max(...xs) + offset;
  const y0 = Math.min(...ys) - offset;
  const y1 = Math.max(...ys) + offset;
  if (shape === 'box') {
    return polygonFromRings([
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
    ]);
  }
  // The ellipse with the box's proportions through its corners: semi-axes x sqrt 2.
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const a = ((x1 - x0) / 2) * Math.SQRT2;
  const b = ((y1 - y0) / 2) * Math.SQRT2;
  const n = 72;
  return polygonFromRings(Array.from({ length: n }, (_, i): Point => [cx + a * Math.cos((2 * Math.PI * i) / n), cy + b * Math.sin((2 * Math.PI * i) / n)]));
}

/** Laydown objects (to be sewn first) for a design. */
export function laydownObjects(objects: readonly StitchObject[], shape: LaydownShape = 'outline', offset = LAYDOWN_OFFSET): NewObject[] {
  const first = objects.find((o) => o.visible);
  const base: NewObject = { settings: defaultSettings({ stitchType: 'laydown' }), color: first ? [...first.color] : [0, 0, 0], thread: first?.thread ?? null, name: 'Laydown' };
  return regionObjects(laydownRegion(objects, shape, offset), base);
}
