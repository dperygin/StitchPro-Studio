// Stitch types, settings and defaults. All lengths are millimetres; y grows downward.

/** [x, y] in mm. */
export type Point = [number, number];

/** [r, g, b], each 0..255. */
export type RGB = [number, number, number];

export type NodeType = 'corner' | 'curve';

export interface PathNode {
  x: number;
  y: number;
  type: NodeType;
  /** This node's column width in mm; null = the object's satin width. */
  width: number | null;
}

/** A motif: points in a unit box (x 0..1 along, y -0.5..0.5 across), from (0,0) to (1,0). */
export interface Motif {
  name: string;
  points: Point[];
}

// ---- Stitch types ----

export const STITCH_TYPES = [
  'running',
  'satin',
  'zigzag',
  'e_stitch',
  'motif_line',
  'manual',
  'radial_satin',
  'fill',
  'satin_fill',
  'outline',
  'motif_fill',
  'contour',
  'stipple',
  'cross_stitch',
  'laydown',
] as const;

export type StitchType = (typeof STITCH_TYPES)[number];

export const STITCH_TYPE_LABELS: Readonly<Record<StitchType, string>> = {
  running: 'Run',
  satin: 'Satin',
  zigzag: 'Zigzag',
  e_stitch: 'E Stitch',
  motif_line: 'Motif',
  manual: 'Manual',
  radial_satin: 'Two-Rail Satin', // also used by the Column tool
  fill: 'Tatami',
  satin_fill: 'Satin fill',
  outline: 'Radial Fill',
  motif_fill: 'Motif Fill',
  contour: 'Contour',
  stipple: 'Stipple',
  cross_stitch: 'Cross Stitch',
  laydown: 'Laydown',
};

export const COLUMN_TYPES: readonly StitchType[] = ['satin', 'zigzag', 'e_stitch'];
export const AREA_TYPES: readonly StitchType[] = [
  'fill',
  'outline',
  'motif_fill',
  'contour',
  'stipple',
  'cross_stitch',
  'satin_fill',
  'laydown',
];
export const ROW_FILL_TYPES: readonly StitchType[] = ['fill', 'satin_fill'];
export const SPACED_COLUMN_TYPES: readonly StitchType[] = ['satin', 'zigzag', 'e_stitch', 'radial_satin'];
export const UNDERLAY_TYPES: readonly StitchType[] = ['fill', 'satin', 'radial_satin', 'satin_fill'];

export const isColumnType = (t: StitchType): boolean => COLUMN_TYPES.includes(t);
export const isAreaType = (t: StitchType): boolean => AREA_TYPES.includes(t);
export const isRowFill = (t: StitchType): boolean => ROW_FILL_TYPES.includes(t);
export const isSpacedColumnType = (t: StitchType): boolean => SPACED_COLUMN_TYPES.includes(t);
export const hasUnderlay = (t: StitchType): boolean => UNDERLAY_TYPES.includes(t);

// ---- Setting enums (value lists double as validation tables for loaders) ----

export const RUN_STYLES = ['single', 'triple', 'backstitch', 'stemstitch', 'sculpture'] as const;
export type RunStyle = (typeof RUN_STYLES)[number];

export const CORNER_MODES = ['none', 'mitre', 'cap', 'auto'] as const;
export type CornerMode = (typeof CORNER_MODES)[number];

export const FILL_PATTERNS = [
  'thirds',
  'quarters',
  'fifths',
  'brick',
  'random',
  'diagonal',
  'diagonal-left',
  'chevron',
  'herringbone',
  'basket',
  'diamonds',
  'waves',
  'zigzag',
  'stripes',
  'scales',
] as const;
export type FillPattern = (typeof FILL_PATTERNS)[number];

export const RAGGED_MODES = ['none', 'random', 'periodic'] as const;
export type RaggedMode = (typeof RAGGED_MODES)[number];

export const UNDERLAY_KINDS = [
  'none',
  'auto',
  'center',
  'edge',
  'zigzag',
  'double-zigzag',
  'tatami',
  'double-tatami',
  // legacy combinations
  'center+zigzag',
  'edge+zigzag',
  'edge+tatami',
] as const;
export type UnderlayKind = (typeof UNDERLAY_KINDS)[number];

// ---- Settings ----

export interface StitchSettings {
  stitchType: StitchType;
  stitchLength: number;
  runStyle: RunStyle;
  stemWidth: number;
  satinWidth: number;
  cornerMode: CornerMode;
  mitreBelowDeg: number;
  capBelowDeg: number;
  satinDensity: number;
  pairedRails: boolean;
  raisedLayers: number;
  stitchShortening: boolean;
  columnShortening: boolean;
  autoSpacing: boolean;
  autoSplit: boolean;
  splitLength: number;
  zigzagSpacing: number;
  eSpacing: number;
  eFlip: boolean;
  fillAngle: number;
  fillRowSpacing: number;
  fillStitchLength: number;
  fillStagger: boolean;
  fillPattern: FillPattern;
  embossWidth: number;
  embossHeight: number;
  rippleOutward: boolean;
  stippleSpacing: number;
  crossSize: number;
  crossDouble: boolean;
  outlineSpacing: number;
  outlineStitchLength: number;
  motifName: string;
  motif2Name: string;
  motifLength: number;
  motifWidth: number;
  motifGap: number;
  motifRowSpacing: number;
  motifRowOffset: number;
  motifColumnOffset: number;
  motif2Scale: number;
  gradedDensity: boolean;
  gradedEndDensity: number;
  raggedMode: RaggedMode;
  raggedAmount: number;
  raggedPeriod: number;
  pullCompensation: number;
  underlayEnabled: boolean;
  underlayType: UnderlayKind;
  underlay2Type: UnderlayKind;
  underlaySpacing: number;
  underlayAngle: number;
  underlayInset: number;
  underlayStitchLength: number;
  underlayStartMargin: number;
  underlayEndMargin: number;
  underlayZigzagAngle: number;
  underlay2Spacing: number;
  underlay2Angle: number;
  underlay2Inset: number;
  underlay2StitchLength: number;
  underlay2StartMargin: number;
  underlay2EndMargin: number;
  underlay2ZigzagAngle: number;
  travelOnEdge: boolean;
  laydownLayers: number;
  laydownAngle2: number;
}

export const DEFAULT_SETTINGS: Readonly<StitchSettings> = Object.freeze({
  stitchType: 'running',
  stitchLength: 3.0,
  runStyle: 'single',
  stemWidth: 1.0,
  satinWidth: 3.0,
  cornerMode: 'auto',
  mitreBelowDeg: 120,
  capBelowDeg: 45,
  satinDensity: 0.4,
  pairedRails: false,
  raisedLayers: 1,
  stitchShortening: true,
  columnShortening: false,
  autoSpacing: true,
  autoSplit: true,
  splitLength: 7.0,
  zigzagSpacing: 2.0,
  eSpacing: 2.5,
  eFlip: false,
  fillAngle: 0,
  fillRowSpacing: 0.4,
  fillStitchLength: 4.0,
  fillStagger: true,
  fillPattern: 'thirds',
  embossWidth: 6,
  embossHeight: 6,
  rippleOutward: false,
  stippleSpacing: 2.5,
  crossSize: 2.5,
  crossDouble: false,
  outlineSpacing: 0.6,
  outlineStitchLength: 2.5,
  motifName: 'wave',
  motif2Name: '',
  motifLength: 4.0,
  motifWidth: 3.0,
  motifGap: 0,
  motifRowSpacing: 4.0,
  motifRowOffset: 0.5,
  motifColumnOffset: 0,
  motif2Scale: 1,
  gradedDensity: false,
  gradedEndDensity: 1.2,
  raggedMode: 'none',
  raggedAmount: 0.8,
  raggedPeriod: 4.0,
  pullCompensation: 0.2,
  underlayEnabled: true,
  underlayType: 'auto',
  underlay2Type: 'none',
  underlaySpacing: 2.0,
  underlayAngle: 90,
  underlayInset: 0.3,
  underlayStitchLength: 2.5,
  underlayStartMargin: 0.3,
  underlayEndMargin: 0.3,
  underlayZigzagAngle: 90,
  underlay2Spacing: 2.0,
  underlay2Angle: 90,
  underlay2Inset: 0.3,
  underlay2StitchLength: 2.5,
  underlay2StartMargin: 0.3,
  underlay2EndMargin: 0.3,
  underlay2ZigzagAngle: 90,
  travelOnEdge: true,
  laydownLayers: 2,
  laydownAngle2: 90,
});

/** A fresh, mutable copy of the defaults with optional overrides. */
export function defaultSettings(overrides: Partial<StitchSettings> = {}): StitchSettings {
  return { ...DEFAULT_SETTINGS, ...overrides };
}
