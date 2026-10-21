// Worksheet data: what a design sews, counted from its export plan (the same commands the
// machine file is written from).

import type { ExportPlan } from './export';
import type { RGB } from './types';

/** Machine speed the run time is estimated at, stitches per minute. */
export const RUN_SPEED_SPM = 800;

export interface ColourBlockReport {
  /** 1-based position in the sewing order. */
  index: number;
  color: RGB;
  name: string;
  brand: string;
  code: string;
  stitches: number;
  /** Thread sewn in this block, mm. */
  threadLength: number;
  /** Stops inside or right after this block. */
  stops: number;
}

export interface DesignReport {
  width: number;
  height: number;
  minX: number;
  minY: number;
  stitches: number;
  /** Colour blocks (the stop sequence, in sewing order). */
  blocks: ColourBlockReport[];
  colourChanges: number;
  stops: number;
  trims: number;
  jumps: number;
  /** Top thread length, mm. */
  threadLength: number;
  /** Sewing time at RUN_SPEED_SPM, minutes. */
  runMinutes: number;
}

/** Counts a design's stitches, colours, stops, trims, thread length, run time and size. */
export function designReport(plan: ExportPlan): DesignReport {
  const blocks: ColourBlockReport[] = plan.threads.map((t, i) => ({ index: i + 1, color: t.color, name: t.name, brand: t.brand, code: t.code, stitches: 0, threadLength: 0, stops: 0 }));
  let block = 0;
  let prev: [number, number] | null = null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const r = { stitches: 0, colourChanges: 0, stops: 0, trims: 0, jumps: 0, threadLength: 0 };
  for (const [kind, x, y] of plan.commands) {
    if (kind === 'stitch') {
      r.stitches++;
      const b = blocks[block];
      if (b) b.stitches++;
      if (prev) {
        const len = Math.hypot(x - prev[0], y - prev[1]);
        r.threadLength += len;
        if (b) b.threadLength += len;
      }
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    } else if (kind === 'jump') r.jumps++;
    else if (kind === 'trim') r.trims++;
    else if (kind === 'stop') {
      r.stops++;
      const b = blocks[block];
      if (b) b.stops++;
    } else if (kind === 'color_change') {
      r.colourChanges++;
      block++;
    }
    prev = [x, y];
  }
  if (!r.stitches) minX = minY = maxX = maxY = 0;
  return { ...r, blocks, width: maxX - minX, height: maxY - minY, minX, minY, runMinutes: r.stitches / RUN_SPEED_SPM };
}
