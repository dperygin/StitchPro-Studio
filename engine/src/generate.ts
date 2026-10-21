// Picks the generator per stitch type; underlay.

import type { StitchObject } from './document';
import { autoSplit, columnStitches, twoRailStitches } from './columns';
import { laydown, radialFill, satinFillParams, tatamiParams } from './fill';
import { motifFill, motifLine } from './motifs';
import { polygonFromRings, type Region } from './geometry';
import { materializePath } from './path';
import { contourFill, crossStitchFill, raisedSatin, runningStitch, stippleFill } from './stitchlib';
import { fillWithAngles } from './turning';
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

/** The area an object's outline and holes enclose. */
export function areaRegion(o: StitchObject): Region {
  return polygonFromRings(materializePath(o.points, true), o.holes.map((h) => materializePath(h, true)));
}

export function generateUnderlay(_o: StitchObject, _motifs: readonly Motif[]): Point[] {
  return [];
}

export function generateTopStitching(o: StitchObject, motifs: readonly Motif[]): Point[] {
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
    case 'manual':
      return o.points.map((n): Point => [n.x, n.y]);
    case 'motif_line':
      return motifLine(materializePath(o.points, o.closed), s, motifs);
    case 'fill':
      return fillWithAngles(areaRegion(o), o.stitchAngles, tatamiParams(s, o.fillStart, o.fillEnd));
    case 'satin_fill':
      // Satin fill always splits long stitches.
      return autoSplit(fillWithAngles(areaRegion(o), o.stitchAngles, satinFillParams(s, o.fillStart, o.fillEnd)), s.splitLength);
    case 'outline':
      return radialFill(areaRegion(o), s, o.fillStart);
    case 'contour':
      return contourFill(areaRegion(o), s);
    case 'stipple':
      return stippleFill(areaRegion(o), s);
    case 'cross_stitch':
      return crossStitchFill(areaRegion(o), s);
    case 'motif_fill':
      return motifFill(areaRegion(o), s, motifs);
    case 'laydown':
      return laydown(areaRegion(o), s, o.fillStart, o.fillEnd);
    case 'radial_satin':
      return twoRailStitches(
        { rail1: o.points, rail2: o.rail2, closed: o.closed, paired: s.pairedRails, stitchAngles: o.stitchAngles },
        s,
      );
    default:
      return []; // remaining generators arrive in later steps
  }
}
