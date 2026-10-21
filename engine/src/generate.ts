// Picks the generator per stitch type; underlay.

import type { StitchObject } from './document';
import { columnStitches } from './columns';
import { materializePath } from './path';
import { raisedSatin, runningStitch } from './stitchlib';
import type { Motif, Point, StitchSettings, StitchType } from './types';

const ROW_SPACED: readonly StitchType[] = ['fill', 'laydown'];
const SATIN_SPACED: readonly StitchType[] = ['satin', 'radial_satin', 'satin_fill'];

/**
 * Spacing convention: settings store the distance between two FORWARD rows (tatami) or two
 * FORWARD stitches (satin), so neighbouring sewn lines are half that apart. This returns the
 * settings with those spacings halved, as every generator expects. Apply it once, before any
 * generator runs.
 */
export function sewnSpacing(settings: StitchSettings): StitchSettings {
  const t = settings.stitchType;
  if (ROW_SPACED.includes(t)) return { ...settings, fillRowSpacing: settings.fillRowSpacing / 2 };
  if (SATIN_SPACED.includes(t)) {
    return { ...settings, satinDensity: settings.satinDensity / 2, gradedEndDensity: settings.gradedEndDensity / 2 };
  }
  return settings;
}

export function generateUnderlay(_o: StitchObject, _motifs: readonly Motif[]): Point[] {
  return [];
}

export function generateTopStitching(o: StitchObject, _motifs: readonly Motif[]): Point[] {
  const s = sewnSpacing(o.settings);
  switch (s.stitchType) {
    case 'running':
      return runningStitch(materializePath(o.points, o.closed), s);
    case 'satin':
      return raisedSatin(s.raisedLayers, (widthScale, spacingScale) =>
        columnStitches(o.points, o.closed, s, 'satin', { widthScale, spacingScale }),
      );
    case 'zigzag':
    case 'e_stitch':
      return columnStitches(o.points, o.closed, s, s.stitchType);
    default:
      return []; // remaining generators arrive in later steps
  }
}
