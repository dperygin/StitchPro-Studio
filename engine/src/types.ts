// Stitch types, settings and defaults. All lengths are millimetres; y grows downward.

export interface Point {
  x: number;
  y: number;
}

/** One needle penetration (or machine command) in the final sequence. */
export type StitchKind = 'stitch' | 'jump' | 'trim' | 'colorChange' | 'stop' | 'end';

export interface Stitch {
  x: number;
  y: number;
  kind: StitchKind;
}

/** How an object is sewn. Extended in later steps. */
export type StitchType = 'run' | 'satin' | 'tatami';

export interface StitchSettings {
  type: StitchType;
  /** Run stitch length, mm. */
  runLength: number;
  /** Satin / fill row spacing, mm. */
  density: number;
}

export const DEFAULT_SETTINGS: Readonly<StitchSettings> = Object.freeze({
  type: 'run',
  runLength: 2.5,
  density: 0.4,
});
