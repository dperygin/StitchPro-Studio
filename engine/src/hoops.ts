// Hoop sizes. The sewing field is centred on (0, 0). (The full catalogue arrives with prompt 19.)

import type { HoopShape } from './document';

export interface Hoop {
  id: string;
  name: string;
  width: number;
  height: number;
  shape: HoopShape;
  corner: number;
}

export const HOOPS: readonly Hoop[] = [
  { id: 'sq-100', name: '100 x 100 mm', width: 100, height: 100, shape: 'rectangle', corner: 0 },
  { id: 'rect-130x180', name: '130 x 180 mm', width: 130, height: 180, shape: 'rectangle', corner: 0 },
  { id: 'sq-150', name: '150 x 150 mm', width: 150, height: 150, shape: 'rectangle', corner: 0 },
  { id: 'rect-200x300', name: '200 x 300 mm', width: 200, height: 300, shape: 'rectangle', corner: 0 },
  { id: 'round-120', name: 'Round 120 mm', width: 120, height: 120, shape: 'circle', corner: 0 },
];

export function findHoop(id: string): Hoop | undefined {
  return HOOPS.find((h) => h.id === id);
}
