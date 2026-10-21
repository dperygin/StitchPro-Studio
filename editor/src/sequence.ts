// Sewing-order rules by colour: back/forward one colour, sequence by colour, optimize colour
// changes. Pure functions over the object list.

import { sameColor, type StitchObject } from '@stitchpro/engine';
import type { Box } from './hittest';

export interface ColourBlock {
  start: number;
  /** Exclusive. */
  end: number;
}

/** Runs of consecutive objects with the same colour. */
export function colourBlocks(objs: readonly StitchObject[]): ColourBlock[] {
  const out: ColourBlock[] = [];
  objs.forEach((o, i) => {
    const last = out[out.length - 1];
    if (last && sameColor(objs[last.start]!.color, o.color)) last.end = i + 1;
    else out.push({ start: i, end: i + 1 });
  });
  return out;
}

/** Sequence by colour: objects grouped by colour in order of first appearance, keeping their order within a colour. */
export function sequenceByColour(objs: readonly StitchObject[]): StitchObject[] {
  const groups: StitchObject[][] = [];
  for (const o of objs) {
    const g = groups.find((x) => sameColor(x[0]!.color, o.color));
    if (g) g.push(o);
    else groups.push([o]);
  }
  return groups.flat();
}

const grow = (b: Box, d: number): Box => ({ minX: b.minX - d, minY: b.minY - d, maxX: b.maxX + d, maxY: b.maxY + d });
const overlaps = (a: Box, b: Box) => a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY;

/**
 * Optimize colour changes: an object joins the latest earlier run of its colour only if its
 * bounding box grown by 0.5 mm overlaps nothing sewn in between (so the stacking stays right).
 */
export function optimizeColourChanges(objs: readonly StitchObject[], boxOf: (o: StitchObject) => Box): StitchObject[] {
  const out: StitchObject[] = [];
  for (const o of objs) {
    let j = -1;
    for (let k = out.length - 1; k >= 0; k--) {
      if (sameColor(out[k]!.color, o.color)) {
        j = k;
        break;
      }
    }
    if (j >= 0 && j < out.length - 1) {
      const mine = grow(boxOf(o), 0.5);
      if (!out.slice(j + 1).some((b) => overlaps(mine, boxOf(b)))) {
        out.splice(j + 1, 0, o);
        continue;
      }
    }
    out.push(o);
  }
  return out;
}

/** Moves the given objects back (-1) before the colour block in front of them, or forward (+1) past the block after them. */
export function moveByColourBlock(objs: readonly StitchObject[], ids: readonly number[], dir: 1 | -1): StitchObject[] {
  const moving = objs.filter((o) => ids.includes(o.id));
  if (!moving.length) return [...objs];
  const first = objs.findIndex((o) => ids.includes(o.id));
  const last = objs.length - 1 - [...objs].reverse().findIndex((o) => ids.includes(o.id));
  const rest = objs.filter((o) => !ids.includes(o.id));
  const blocks = colourBlocks(rest);
  // Where the selection sits in the remaining list.
  const before = objs.slice(0, first).filter((o) => !ids.includes(o.id)).length;
  const after = objs.slice(0, last + 1).filter((o) => !ids.includes(o.id)).length;
  // Pass exactly one block of another colour (blocks of the selection's own colour don't count).
  const own = moving[0]!.color;
  const other = (b: ColourBlock) => !sameColor(rest[b.start]!.color, own);
  let at: number;
  if (dir < 0) {
    const block = [...blocks].reverse().find((b) => b.start < before && other(b));
    if (!block) return [...objs];
    at = block.start;
  } else {
    const block = blocks.find((b) => b.end > after && other(b));
    if (!block) return [...objs];
    at = block.end;
  }
  return [...rest.slice(0, at), ...moving, ...rest.slice(at)];
}
