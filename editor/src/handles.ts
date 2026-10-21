// Selection handles. Scale mode: corner handles resize proportionally, side handles one way.
// Rotate mode (click the selection again): corner circles and a handle above the box rotate,
// diamond handles on the top and bottom edges skew. A centre handle moves.

import { rotation, scaling, skewX, translation, type Affine, type Point } from '@stitchpro/engine';
import { HANDLE_PADDING_PX, HANDLE_PICK_PX, MAX_SKEW_DEG, MOVE_HANDLE_RADIUS_PX, ROTATE_HANDLE_PX } from './constants';
import type { Box } from './hittest';
import type { Editor } from './editor';

export type HandleKind =
  | 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'
  | 'rotate' | 'rot-nw' | 'rot-ne' | 'rot-se' | 'rot-sw'
  | 'skew-n' | 'skew-s'
  | 'move';

export interface Handle {
  kind: HandleKind;
  /** Screen position, CSS pixels. */
  x: number;
  y: number;
}

/** The selection box in screen pixels, padded. */
export function screenBox(ed: Editor, box: Box): Box {
  const [x0, y0] = ed.view.toScreen([box.minX, box.minY]);
  const [x1, y1] = ed.view.toScreen([box.maxX, box.maxY]);
  const p = HANDLE_PADDING_PX;
  return { minX: Math.min(x0, x1) - p, minY: Math.min(y0, y1) - p, maxX: Math.max(x0, x1) + p, maxY: Math.max(y0, y1) + p };
}

/** Handles of the current selection (none for locked selections or other tools). */
export function selectionHandles(ed: Editor): Handle[] {
  if (ed.toolName !== 'select') return [];
  const sel = ed.selectedObjects().filter((o) => !o.locked);
  const box = ed.selectionBox(sel);
  if (!box) return [];
  const b = screenBox(ed, box);
  const mx = (b.minX + b.maxX) / 2;
  const my = (b.minY + b.maxY) / 2;
  const move: Handle = { kind: 'move', x: mx, y: my };
  if (ed.handleMode === 'rotate') {
    return [
      { kind: 'rot-nw', x: b.minX, y: b.minY },
      { kind: 'rot-ne', x: b.maxX, y: b.minY },
      { kind: 'rot-se', x: b.maxX, y: b.maxY },
      { kind: 'rot-sw', x: b.minX, y: b.maxY },
      { kind: 'rotate', x: mx, y: b.minY - ROTATE_HANDLE_PX },
      { kind: 'skew-n', x: mx, y: b.minY },
      { kind: 'skew-s', x: mx, y: b.maxY },
      move,
    ];
  }
  return [
    { kind: 'nw', x: b.minX, y: b.minY },
    { kind: 'n', x: mx, y: b.minY },
    { kind: 'ne', x: b.maxX, y: b.minY },
    { kind: 'e', x: b.maxX, y: my },
    { kind: 'se', x: b.maxX, y: b.maxY },
    { kind: 's', x: mx, y: b.maxY },
    { kind: 'sw', x: b.minX, y: b.maxY },
    { kind: 'w', x: b.minX, y: my },
    move,
  ];
}

/** The handle under a screen point (edge handles before the centre move handle). */
export function handleAt(ed: Editor, p: { x: number; y: number }): Handle | null {
  const hs = selectionHandles(ed);
  const edge = hs.find((h) => h.kind !== 'move' && Math.hypot(h.x - p.x, h.y - p.y) <= HANDLE_PICK_PX);
  if (edge) return edge;
  return hs.find((h) => h.kind === 'move' && Math.hypot(h.x - p.x, h.y - p.y) <= MOVE_HANDLE_RADIUS_PX) ?? null;
}

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

/**
 * The transform a handle drag makes, from design point `start` to `cur`, with `box` the
 * selection's box when the drag began. Shift snaps rotation to 15 and skew to 5 degree steps.
 */
export function handleTransform(kind: HandleKind, box: Box, startIn: Point, curIn: Point, shift: boolean): { m: Affine; label: string } {
  let start = startIn;
  let cur = curIn;
  const cx = (box.minX + box.maxX) / 2;
  const cy = (box.minY + box.maxY) / 2;
  if (kind === 'move') return { m: translation(cur[0] - start[0], cur[1] - start[1]), label: 'Move' };

  if (kind === 'rotate' || kind.startsWith('rot-')) {
    let a = deg(Math.atan2(cur[1] - cy, cur[0] - cx) - Math.atan2(start[1] - cy, start[0] - cx));
    if (shift) a = Math.round(a / 15) * 15;
    return { m: rotation(a, cx, cy), label: 'Rotate' };
  }

  if (kind === 'skew-n' || kind === 'skew-s') {
    // x' = x - tan(a) (y - anchorY), anchored on the opposite edge.
    const anchorY = kind === 'skew-n' ? box.maxY : box.minY;
    const handleY = kind === 'skew-n' ? box.minY : box.maxY;
    const h = anchorY - handleY;
    let a = h !== 0 ? deg(Math.atan((cur[0] - start[0]) / h)) : 0;
    if (shift) a = Math.round(a / 5) * 5;
    a = Math.max(-MAX_SKEW_DEG, Math.min(MAX_SKEW_DEG, a));
    return { m: skewX(a, anchorY), label: 'Skew' };
  }

  // Resize: anchored on the opposite corner / side. The handles sit padded outside the box, so
  // the grabbed box corner / edge moves by the pointer's movement.
  const ax = kind.includes('w') ? box.maxX : kind.includes('e') ? box.minX : cx;
  const ay = kind.includes('n') ? box.maxY : kind.includes('s') ? box.minY : cy;
  const edgeX = kind.includes('w') ? box.minX : kind.includes('e') ? box.maxX : cx;
  const edgeY = kind.includes('n') ? box.minY : kind.includes('s') ? box.maxY : cy;
  start = [edgeX, edgeY];
  cur = [edgeX + (curIn[0] - startIn[0]), edgeY + (curIn[1] - startIn[1])];
  const factor = (c: number, s: number, a: number) => (Math.abs(s - a) > 1e-9 ? (c - a) / (s - a) : 1);
  let sx = 1;
  let sy = 1;
  if (kind.length === 2) {
    // Corner: proportional, projected onto the diagonal.
    const vx = start[0] - ax;
    const vy = start[1] - ay;
    const len2 = vx * vx + vy * vy;
    const k = len2 > 0 ? ((cur[0] - ax) * vx + (cur[1] - ay) * vy) / len2 : 1;
    sx = sy = k;
  } else if (kind === 'e' || kind === 'w') sx = factor(cur[0], start[0], ax);
  else sy = factor(cur[1], start[1], ay);
  // Never collapse to nothing.
  const clamp = (v: number) => (Math.abs(v) < 0.01 ? Math.sign(v || 1) * 0.01 : v);
  return { m: scaling(clamp(sx), clamp(sy), ax, ay), label: 'Resize' };
}
