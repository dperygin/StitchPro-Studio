// Previews for the top toolbar: a small sample stitched by the engine (the same code that sews
// designs) and a one-line description, shown when a button is hovered or focused.

import { createDocument, createObject, defaultSettings, pathNode, sewObject, standardShape, stitchRuns, type NewObject, type PathNode, type Point, type RGB, type StitchType } from '@stitchpro/engine';

export interface Preview {
  description: string;
  /** Sample objects in a 40 x 26 mm box. */
  objects: () => NewObject[];
  /** Draw the objects' nodes too (digitizing tools: what you click versus what is sewn). */
  nodes?: boolean;
  /** Draw a dashed selection box around the sample. */
  selection?: boolean;
}

const PURPLE: RGB = [120, 48, 136];
const RASPBERRY: RGB = [176, 40, 88];
const NAVY: RGB = [0, 40, 88];
const OLIVE: RGB = [125, 143, 66];

const n = (pts: [number, number][], type: PathNode['type'] = 'curve') => pts.map(([x, y], i) => pathNode(x, y, i === 0 || i === pts.length - 1 ? 'corner' : type));
/** A gentle S curve across the box, for line stitches. */
const WAVE = n([[2, 18], [12, 6], [24, 20], [38, 8]]);
/** An oval, for fills. */
const LEAF: PathNode[] = standardShape('circle', { x0: 3, y0: 2, x1: 37, y1: 24 });

/**
 * Sparser than real stitching (rows, satin spacing) and no underlay, so each type's texture
 * and direction shows at this size; real density would print as solid colour.
 */
const PREVIEW_SETTINGS = { underlayEnabled: false, fillRowSpacing: 1.8, fillStitchLength: 3, satinDensity: 1.1, outlineSpacing: 1.2, stippleSpacing: 3 };

const line = (stitchType: StitchType, color: RGB, extra: Partial<NewObject> = {}): NewObject => ({ stitchType, color, points: WAVE, ...extra });
const fill = (stitchType: StitchType, color: RGB, extra: Partial<NewObject> = {}): NewObject => ({ stitchType, color, closed: true, points: LEAF, ...extra });
const shape = (kind: Parameters<typeof standardShape>[0], color: RGB): NewObject => ({ stitchType: 'fill', color, closed: true, points: standardShape(kind, { x0: 8, y0: 1, x1: 32, y1: 25 }) });

export const PREVIEWS: Record<string, Preview> = {
  'tool.select': { description: 'Click an object to select it, drag a box round several, then move, resize or rotate them.', objects: () => [fill('fill', RASPBERRY)], selection: true },
  'draw.open': { description: 'Click points along a line (right click for curves); Enter finishes. Sewn with the chosen outline stitch.', objects: () => [line('running', NAVY)], nodes: true },
  'draw.closed': { description: 'Click points round a shape; double click closes it. Filled with the chosen fill stitch.', objects: () => [fill('fill', RASPBERRY)], nodes: true },
  'draw.column': { description: 'Click one edge, then the other, back and forth along the column. Each pair sets the width and stitch direction there; Enter finishes.', objects: () => [{ stitchType: 'radial_satin', color: PURPLE, points: n([[3, 10], [14, 4], [26, 8], [37, 3]]), rail2: n([[4, 20], [15, 14], [27, 18], [38, 13]]), settings: defaultSettings({ stitchType: 'radial_satin', pairedRails: true }) }], nodes: true },
  'draw.twoRail': { description: 'Draw one edge, then the other: a satin between two rails of any shape.', objects: () => [{ stitchType: 'radial_satin', color: PURPLE, points: n([[3, 6], [20, 2], [37, 6]]), rail2: n([[3, 20], [20, 13], [37, 20]]) }], nodes: true },
  'draw.manual': { description: 'Every click is one needle point: full control for tiny details.', objects: () => [{ stitchType: 'manual', color: NAVY, points: n([[3, 20], [8, 6], [13, 20], [18, 6], [23, 20], [28, 6], [33, 20], [37, 8]], 'corner') }], nodes: true },
  'shape.circle': { description: 'Drag a box for a circle (Ctrl keeps it round).', objects: () => [shape('circle', RASPBERRY)] },
  'shape.rectangle': { description: 'Drag a box for a rectangle (Ctrl keeps it square).', objects: () => [shape('rectangle', OLIVE)] },
  'menu.shapes': { description: 'More standard shapes: triangle, diamond, hexagon, star and heart.', objects: () => [shape('star', PURPLE)] },
  'mode.outline': { description: 'Closed shapes are stitched along their outline.', objects: () => [fill('running', NAVY)] },
  'mode.fill': { description: 'Closed shapes are filled.', objects: () => [fill('fill', RASPBERRY)] },
  'type.running': { description: 'Run: a single line of stitches, for outlines and details.', objects: () => [line('running', NAVY)] },
  'type.satin': { description: 'Satin: smooth, shiny zigzags across a column, for borders and lettering.', objects: () => [line('satin', PURPLE)] },
  'type.zigzag': { description: 'Zigzag: an open zigzag, light and quick.', objects: () => [line('zigzag', RASPBERRY)] },
  'type.e_stitch': { description: 'E stitch: a comb-like edge, often used for applique tack-down.', objects: () => [line('e_stitch', OLIVE)] },
  'type.motif_line': { description: 'Motif: a repeated little pattern along the line.', objects: () => [line('motif_line', PURPLE)] },
  'type.fill': { description: 'Tatami: rows of running stitches, for covering large areas.', objects: () => [fill('fill', RASPBERRY)] },
  'type.satin_fill': { description: 'Satin fill: a shape filled with satin stitches, for small shiny areas.', objects: () => [fill('satin_fill', PURPLE)] },
  'type.outline': { description: 'Radial fill: rows that follow the outline inwards.', objects: () => [fill('outline', NAVY)] },
  'type.motif_fill': { description: 'Motif fill: the shape covered with a repeating pattern.', objects: () => [fill('motif_fill', OLIVE)] },
  'type.contour': { description: 'Contour: lines echoing the shape, like ripples.', objects: () => [fill('contour', PURPLE)] },
  'type.stipple': { description: 'Stipple: a meandering line for a light, quilted texture.', objects: () => [fill('stipple', RASPBERRY)] },
  'type.cross_stitch': { description: 'Cross stitch: the shape filled with little crosses.', objects: () => [fill('cross_stitch', NAVY)] },
};

export const PREVIEW_W = 160;
export const PREVIEW_H = 104;
const cache = new Map<string, string>();

/** A preview picture as a data URL (stitched once, then cached). */
export function previewImage(id: string): string | null {
  const p = PREVIEWS[id];
  if (!p) return null;
  const hit = cache.get(id);
  if (hit) return hit;
  const doc = createDocument();
  const objects = p.objects().map((o) => {
    const obj = createObject(doc, o);
    Object.assign(obj.settings, PREVIEW_SETTINGS);
    return obj;
  });
  const ratio = 2;
  const canvas = document.createElement('canvas');
  canvas.width = PREVIEW_W * ratio;
  canvas.height = PREVIEW_H * ratio;
  const ctx = canvas.getContext('2d')!;
  // 40 x 26 mm drawn into the card with a margin.
  const k = Math.min((PREVIEW_W - 16) / 40, (PREVIEW_H - 16) / 26) * ratio;
  const ox = (canvas.width - 40 * k) / 2;
  const oy = (canvas.height - 26 * k) / 2;
  const at = ([x, y]: Point): Point => [ox + x * k, oy + y * k];
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  for (const o of objects) {
    const runs = stitchRuns(sewObject(o)).map((run) => run.map(at));
    ctx.strokeStyle = `rgb(${o.color.join(', ')})`;
    ctx.lineWidth = 0.7 * ratio;
    ctx.beginPath();
    for (const run of runs) run.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.stroke();
    // Needle points: they tell tatami (short stitches) from satin (edge to edge).
    ctx.fillStyle = `rgb(${o.color.map((v) => Math.round(v * 0.6)).join(', ')})`;
    for (const run of runs) for (const [x, y] of run) ctx.fillRect(x - 0.9 * ratio, y - 0.9 * ratio, 1.8 * ratio, 1.8 * ratio);
  }
  if (p.nodes) {
    for (const o of objects) {
      for (const node of [...o.points, ...o.rail2]) {
        const [x, y] = at([node.x, node.y]);
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = '#783088';
        ctx.lineWidth = 1.5 * ratio;
        ctx.beginPath();
        if (node.type === 'corner') ctx.rect(x - 3 * ratio, y - 3 * ratio, 6 * ratio, 6 * ratio);
        else ctx.arc(x, y, 3.2 * ratio, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }
  }
  if (p.selection) {
    ctx.setLineDash([4 * ratio, 3 * ratio]);
    ctx.strokeStyle = '#783088';
    ctx.lineWidth = 1 * ratio;
    ctx.strokeRect(ox + 1 * k, oy + 1 * k, 38 * k, 24 * k);
  }
  const url = canvas.toDataURL('image/png');
  cache.set(id, url);
  return url;
}
