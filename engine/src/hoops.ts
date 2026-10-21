// Hoop sizes. The sewing field is centred on (0, 0); only fields at least 76.2 mm (3 in) both
// ways are listed.

import type { HoopShape } from './document';

export type HoopKind = 'round' | 'rounded' | 'rectangle' | 'border' | 'magnetic' | 'sash' | 'cap';

export interface Hoop {
  id: string;
  name: string;
  kind: HoopKind;
  width: number;
  height: number;
  shape: HoopShape;
  /** Corner radius of rounded hoops, mm. */
  corner: number;
}

export const MIN_HOOP_MM = 76.2;

const inches = (mm: number) => (mm / 25.4).toFixed(1).replace(/\.0$/, '');
const label = (w: number, h: number) => `${w} x ${h} mm (${inches(w)} x ${inches(h)} in)`;

function hoop(kind: HoopKind, w: number, h: number, shape: HoopShape = 'rectangle', corner = 0, prefix = ''): Hoop {
  return { id: shape === 'circle' ? `${kind}-${w}` : `${kind}-${w}x${h}`, name: `${prefix}${shape === 'circle' ? `Round ${w} mm (${inches(w)} in)` : label(w, h)}`, kind, width: w, height: h, shape, corner };
}

/** Squares and rectangles from 100 x 100 to 297 x 465, upright and sideways. */
const RECTANGLES: [number, number][] = [
  [100, 100],
  [130, 180],
  [150, 150],
  [150, 240],
  [160, 260],
  [180, 300],
  [200, 200],
  [200, 300],
  [240, 240],
  [250, 400],
  [260, 360],
  [297, 465],
];

const all: Hoop[] = [
  ...[85, 100, 120, 130, 150, 170, 190].map((d) => hoop('round', d, d, 'circle')),
  ...[100, 120, 150, 180, 200].map((s) => hoop('rounded', s, s, 'roundrect', Math.round(s * 0.12), 'Rounded ')),
  ...RECTANGLES.flatMap(([w, h]) => (w === h ? [hoop('rectangle', w, h)] : [hoop('rectangle', w, h), hoop('rectangle', h, w)])),
  ...[
    [100, 300],
    [130, 420],
    [100, 500],
  ].map(([w, h]) => hoop('border', w!, h!, 'rectangle', 0, 'Border ')),
  ...[
    [130, 130],
    [180, 130],
    [260, 200],
    [300, 200],
    [360, 200],
    [430, 330],
  ].map(([w, h]) => hoop('magnetic', w!, h!, 'rectangle', 0, 'Magnetic ')),
  ...[
    [600, 400],
    [800, 500],
    [1000, 500],
    [1200, 500],
  ].map(([w, h]) => hoop('sash', w!, h!, 'rectangle', 0, 'Sash ')),
  hoop('cap', 150, 135, 'rectangle', 0, 'Cap frame '),
];

export const HOOPS: readonly Hoop[] = all.filter((h) => h.width >= MIN_HOOP_MM && h.height >= MIN_HOOP_MM);

export const HOOP_KIND_LABELS: Readonly<Record<HoopKind, string>> = {
  round: 'Round',
  rounded: 'Rounded squares',
  rectangle: 'Squares and rectangles',
  border: 'Border hoops',
  magnetic: 'Magnetic frames',
  sash: 'Sash frames',
  cap: 'Cap frame',
};

export function findHoop(id: string): Hoop | undefined {
  return HOOPS.find((h) => h.id === id);
}

/** Whether every point lies inside the hoop's sewing field (centred on 0, 0). */
export function fitsHoop(points: Iterable<readonly [number, number]>, w: number, h: number, shape: HoopShape, corner = 0): boolean {
  const hw = w / 2;
  const hh = h / 2;
  for (const [x, y] of points) {
    if (shape === 'circle') {
      if ((x / hw) ** 2 + (y / hh) ** 2 > 1 + 1e-9) return false;
      continue;
    }
    if (Math.abs(x) > hw + 1e-9 || Math.abs(y) > hh + 1e-9) return false;
    if (shape === 'roundrect' && corner > 0) {
      const dx = Math.abs(x) - (hw - corner);
      const dy = Math.abs(y) - (hh - corner);
      if (dx > 0 && dy > 0 && dx * dx + dy * dy > corner * corner + 1e-9) return false;
    }
  }
  return true;
}
