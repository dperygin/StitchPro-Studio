// Which settings each stitch type uses, for the Properties panel. Stitch settings are always
// shown in mm (never inches).

import {
  CORNER_MODES,
  FILL_PATTERNS,
  RAGGED_MODES,
  RUN_STYLES,
  UNDERLAY_KINDS,
  hasUnderlay,
  type StitchSettings,
  type StitchType,
} from '@stitchpro/engine';

export type SettingKey = keyof StitchSettings;

export interface SettingField {
  key: SettingKey;
  label: string;
  kind: 'number' | 'bool' | 'enum' | 'text';
  unit?: 'mm' | 'deg' | '%' | 'x';
  min?: number;
  max?: number;
  step?: number;
  options?: readonly string[];
}

export interface SettingSection {
  title: string;
  fields: SettingField[];
}

const n = (key: SettingKey, label: string, unit: SettingField['unit'], min: number, max: number, step: number): SettingField => ({
  key,
  label,
  kind: 'number',
  unit,
  min,
  max,
  step,
});
const b = (key: SettingKey, label: string): SettingField => ({ key, label, kind: 'bool' });
const e = (key: SettingKey, label: string, options: readonly string[]): SettingField => ({ key, label, kind: 'enum', options });
const t = (key: SettingKey, label: string): SettingField => ({ key, label, kind: 'text' });

const width = n('satinWidth', 'Width', 'mm', 0.2, 50, 0.1);
const pull = n('pullCompensation', 'Pull compensation', 'mm', -2, 2, 0.05);
const split = [b('autoSplit', 'Auto split'), n('splitLength', 'Split length', 'mm', 2, 12.7, 0.1)];
const corners: SettingSection = {
  title: 'Corners',
  fields: [e('cornerMode', 'Corner mode', CORNER_MODES), n('mitreBelowDeg', 'Mitre below', 'deg', 0, 180, 1), n('capBelowDeg', 'Cap below', 'deg', 0, 180, 1)],
};
const ragged = [e('raggedMode', 'Ragged edge', RAGGED_MODES), n('raggedAmount', 'Ragged amount', 'mm', 0, 5, 0.1), n('raggedPeriod', 'Ragged period', 'mm', 0.5, 50, 0.5)];
const graded = [b('gradedDensity', 'Graded density'), n('gradedEndDensity', 'End density', 'mm', 0.1, 5, 0.05)];
const angle = n('fillAngle', 'Angle', 'deg', -360, 360, 1);
const motif = [t('motifName', 'Motif'), n('motifLength', 'Motif length', 'mm', 0.5, 50, 0.1), n('motifWidth', 'Motif width', 'mm', 0.2, 50, 0.1), n('motifGap', 'Gap', 'mm', 0, 50, 0.1)];

/** The stitch and effect sections for a stitch type. */
export function settingSections(type: StitchType, s?: StitchSettings): SettingSection[] {
  switch (type) {
    case 'running': {
      const fields = [n('stitchLength', 'Stitch length', 'mm', 0.3, 12.7, 0.1), e('runStyle', 'Style', RUN_STYLES)];
      if (!s || s.runStyle === 'stemstitch') fields.push(n('stemWidth', 'Rope width', 'mm', 0.2, 10, 0.1));
      return [{ title: 'Stitch', fields }];
    }
    case 'satin':
      return [
        { title: 'Stitch', fields: [width, n('satinDensity', 'Density', 'mm', 0.1, 5, 0.05), b('autoSpacing', 'Auto spacing'), pull, b('stitchShortening', 'Stitch shortening'), ...split] },
        corners,
        { title: 'Effects', fields: [n('raisedLayers', 'Raised layers', 'x', 1, 5, 1), ...graded, ...ragged] },
      ];
    case 'zigzag':
      return [{ title: 'Stitch', fields: [width, n('zigzagSpacing', 'Spacing', 'mm', 0.2, 10, 0.1), pull] }, corners, { title: 'Effects', fields: ragged }];
    case 'e_stitch':
      return [{ title: 'Stitch', fields: [width, n('eSpacing', 'Spacing', 'mm', 0.5, 10, 0.1), b('eFlip', 'Flip'), pull] }, corners];
    case 'motif_line':
      return [{ title: 'Stitch', fields: [...motif, n('stitchLength', 'Stitch length', 'mm', 0.3, 12.7, 0.1)] }];
    case 'radial_satin':
      return [
        {
          title: 'Stitch',
          fields: [n('satinDensity', 'Density', 'mm', 0.1, 5, 0.05), b('pairedRails', 'Column (paired nodes)'), pull, b('columnShortening', 'Column shortening'), ...split],
        },
        { title: 'Effects', fields: [...graded, ...ragged] },
      ];
    case 'fill': {
      const fields = [angle, n('fillRowSpacing', 'Row spacing', 'mm', 0.1, 5, 0.05), n('fillStitchLength', 'Stitch length', 'mm', 0.5, 12.7, 0.1), b('fillStagger', 'Stagger'), e('fillPattern', 'Pattern', FILL_PATTERNS), pull, b('travelOnEdge', 'Travel on edge')];
      if (!s || ['diamonds', 'waves', 'zigzag', 'stripes', 'scales'].includes(s.fillPattern)) {
        fields.push(n('embossWidth', 'Pattern width', 'mm', 1, 50, 0.5), n('embossHeight', 'Pattern height', 'mm', 1, 50, 0.5));
      }
      return [{ title: 'Stitch', fields }];
    }
    case 'satin_fill':
      return [{ title: 'Stitch', fields: [angle, n('satinDensity', 'Density', 'mm', 0.1, 5, 0.05), pull, n('splitLength', 'Split length', 'mm', 2, 12.7, 0.1), b('travelOnEdge', 'Travel on edge')] }];
    case 'outline':
      return [{ title: 'Stitch', fields: [n('outlineSpacing', 'Ring spacing', 'mm', 0.2, 10, 0.1), n('outlineStitchLength', 'Stitch length', 'mm', 0.5, 12.7, 0.1), b('rippleOutward', 'Ripple outward')] }];
    case 'motif_fill':
      return [
        {
          title: 'Stitch',
          fields: [
            ...motif,
            t('motif2Name', 'Alternate motif'),
            n('motif2Scale', 'Alternate scale', 'x', 0.1, 5, 0.1),
            n('motifRowSpacing', 'Row spacing', 'mm', 0.5, 50, 0.1),
            n('motifRowOffset', 'Row offset', 'x', 0, 1, 0.05),
            n('motifColumnOffset', 'Column offset', 'x', -1, 1, 0.05),
            angle,
            n('stitchLength', 'Stitch length', 'mm', 0.3, 12.7, 0.1),
          ],
        },
      ];
    case 'contour':
      return [{ title: 'Stitch', fields: [angle, n('fillRowSpacing', 'Row spacing', 'mm', 0.1, 5, 0.05), n('fillStitchLength', 'Stitch length', 'mm', 0.5, 12.7, 0.1)] }];
    case 'stipple':
      return [{ title: 'Stitch', fields: [n('stippleSpacing', 'Spacing', 'mm', 0.8, 20, 0.1), n('stitchLength', 'Stitch length', 'mm', 0.3, 12.7, 0.1)] }];
    case 'cross_stitch':
      return [{ title: 'Stitch', fields: [n('crossSize', 'Cross size', 'mm', 1, 20, 0.1), b('crossDouble', 'Double')] }];
    case 'laydown':
      return [
        {
          title: 'Stitch',
          fields: [angle, n('fillRowSpacing', 'Row spacing', 'mm', 0.1, 10, 0.05), n('fillStitchLength', 'Stitch length', 'mm', 0.5, 12.7, 0.1), n('laydownLayers', 'Layers', 'x', 1, 2, 1), n('laydownAngle2', 'Second layer angle', 'deg', -180, 180, 1)],
        },
      ];
    default:
      return [];
  }
}

const COLUMN_UNDERLAY = ['satin', 'radial_satin'];

/** Underlay 1 and 2 with only the fields the type uses (none for types without underlay). */
export function underlaySections(type: StitchType): SettingSection[] {
  if (!hasUnderlay(type)) return [];
  const column = COLUMN_UNDERLAY.includes(type);
  const layer = (two: boolean): SettingField[] => {
    const k = (one: SettingKey, other: SettingKey) => (two ? other : one);
    const common = [
      n(k('underlaySpacing', 'underlay2Spacing'), 'Spacing', 'mm', 0.3, 10, 0.1),
      n(k('underlayInset', 'underlay2Inset'), 'Inset', 'mm', 0, 5, 0.05),
      n(k('underlayStitchLength', 'underlay2StitchLength'), 'Stitch length', 'mm', 0.5, 12.7, 0.1),
    ];
    const extra = column
      ? [
          n(k('underlayStartMargin', 'underlay2StartMargin'), 'Start margin', 'mm', 0, 10, 0.1),
          n(k('underlayEndMargin', 'underlay2EndMargin'), 'End margin', 'mm', 0, 10, 0.1),
          n(k('underlayZigzagAngle', 'underlay2ZigzagAngle'), 'Zigzag angle', 'deg', 10, 170, 1),
        ]
      : [n(k('underlayAngle', 'underlay2Angle'), 'Angle', 'deg', -360, 360, 1)];
    return [e(k('underlayType', 'underlay2Type'), 'Type', UNDERLAY_KINDS), ...common, ...extra];
  };
  return [
    { title: 'Underlay 1', fields: [b('underlayEnabled', 'Underlay'), ...layer(false)] },
    { title: 'Underlay 2', fields: layer(true) },
  ];
}
