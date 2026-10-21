// Picks the generator per stitch type; underlay.
// Placeholder generators - the real ones arrive with the stitch-type steps.

import type { StitchObject } from './document';
import type { Motif, Point } from './types';

export function generateUnderlay(_o: StitchObject, _motifs: readonly Motif[]): Point[] {
  return [];
}

export function generateTopStitching(_o: StitchObject, _motifs: readonly Motif[]): Point[] {
  return [];
}
