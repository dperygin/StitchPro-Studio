// Document model, objects, palette and the per-object stitch cache.

import type { Motif, PathNode, Point, RGB, StitchSettings, StitchType } from './types';
import { STITCH_TYPE_LABELS, defaultSettings } from './types';
import { sewObject } from './generate';

export interface ThreadRef {
  chart: string;
  code: string;
  name: string;
}

/** Lettering data that lets Edit text rebuild a piece. Filled in by the lettering step. */
export type TextMeta = Record<string, unknown>;

export interface StitchObject {
  id: number;
  name: string;
  points: PathNode[];
  settings: StitchSettings;
  color: RGB;
  closed: boolean;
  visible: boolean;
  holes: PathNode[][];
  /** Entry point, or null for automatic. */
  fillStart: Point | null;
  /** Exit point, or null for automatic. */
  fillEnd: Point | null;
  autoEntry: boolean;
  locked: boolean;
  groupId: number | null;
  /** Hand-edited stitches; when set they replace generated stitching. */
  customStitches: Point[] | null;
  /** Second rail of a two-rail satin / column. */
  rail2: PathNode[];
  stopAfter: boolean;
  hoopOut: Point | null;
  textMeta: TextMeta | null;
  stitchAngles: [Point, Point][];
  thread: ThreadRef | null;
  /** Bumped on every change; the stitch cache is keyed by (id, version). */
  version: number;
}

/** A tracing picture shown under the design. */
export interface Artwork {
  id: number;
  name: string;
  /** Image data URL. */
  src: string;
  x: number;
  y: number;
  width: number;
  height: number;
  opacity: number;
  visible: boolean;
  locked: boolean;
}

export interface PaletteSlot {
  color: RGB;
  thread: ThreadRef | null;
}

export interface Guide {
  axis: 'h' | 'v';
  pos: number;
}

export type HoopShape = 'rectangle' | 'circle' | 'roundrect';
export const HOOP_SHAPES: readonly HoopShape[] = ['rectangle', 'circle', 'roundrect'];

export interface StitchDocument {
  name: string;
  /** Order = stitch-out order. */
  objects: StitchObject[];
  artwork: Artwork[];
  hoopWidth: number;
  hoopHeight: number;
  hoopShape: HoopShape;
  hoopCorner: number;
  hoopId: string;
  threadChart: string;
  palette: PaletteSlot[];
  guides: Guide[];
  rulerOrigin: Point;
  autoJump: boolean;
  autoJumpThreshold: number;
  autoTrim: boolean;
  trimThreshold: number;
  closestJoin: boolean;
  joinDistance: number;
  tieStitches: boolean;
  minStitch: number;
  trimJumps: number;
  /** The project's own motifs. */
  motifs: Motif[];
  /** Document-owned id counter (never a global). */
  nextObjectId: number;
}

export const DEFAULT_PALETTE_COLORS: readonly RGB[] = [
  [0, 0, 0],
  [255, 255, 255],
  [200, 16, 46],
  [255, 130, 0],
  [255, 205, 0],
  [0, 132, 61],
  [0, 94, 184],
  [102, 45, 145],
  [236, 0, 140],
  [117, 76, 41],
  [140, 140, 140],
  [0, 170, 165],
];

export function defaultPalette(): PaletteSlot[] {
  return DEFAULT_PALETTE_COLORS.map((c) => ({ color: [c[0], c[1], c[2]], thread: null }));
}

export function createDocument(overrides: Partial<StitchDocument> = {}): StitchDocument {
  return {
    name: 'Untitled',
    objects: [],
    artwork: [],
    hoopWidth: 100,
    hoopHeight: 100,
    hoopShape: 'rectangle',
    hoopCorner: 0,
    hoopId: '',
    threadChart: '',
    palette: defaultPalette(),
    guides: [],
    rulerOrigin: [0, 0],
    autoJump: true,
    autoJumpThreshold: 12.0,
    autoTrim: true,
    trimThreshold: 3,
    closestJoin: true,
    joinDistance: 3,
    tieStitches: true,
    minStitch: 0.3,
    trimJumps: 3,
    motifs: [],
    nextObjectId: 1,
    ...overrides,
  };
}

/** Takes the next id from the document's own counter. */
export function allocateId(doc: StitchDocument): number {
  return doc.nextObjectId++;
}

export function pathNode(x: number, y: number, type: PathNode['type'] = 'corner', width: number | null = null): PathNode {
  return { x, y, type, width };
}

export type NewObject = Partial<Omit<StitchObject, 'id' | 'version'>> & { stitchType?: StitchType };

/** A new object with a fresh id from the document (the object is not added to it). */
export function createObject(doc: StitchDocument, init: NewObject = {}): StitchObject {
  const { stitchType, ...rest } = init;
  const settings = rest.settings ?? defaultSettings(stitchType ? { stitchType } : {});
  const id = allocateId(doc);
  return {
    name: `${STITCH_TYPE_LABELS[settings.stitchType]} ${id}`,
    points: [],
    color: [0, 0, 0],
    closed: false,
    visible: true,
    holes: [],
    fillStart: null,
    fillEnd: null,
    autoEntry: true,
    locked: false,
    groupId: null,
    customStitches: null,
    rail2: [],
    stopAfter: false,
    hoopOut: null,
    textMeta: null,
    stitchAngles: [],
    thread: null,
    ...rest,
    settings,
    id,
    version: 1,
  };
}

/** Returns a changed copy of the object with its version bumped. Every edit goes through here. */
export function updateObject(obj: StitchObject, changes: Partial<Omit<StitchObject, 'id' | 'version'>>): StitchObject {
  return { ...obj, ...changes, id: obj.id, version: obj.version + 1 };
}

// ---- Palette ----

export const sameColor = (a: RGB, b: RGB): boolean => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

export function paletteIndexOf(palette: readonly PaletteSlot[], color: RGB): number {
  return palette.findIndex((s) => sameColor(s.color, color));
}

/**
 * Makes sure every colour an object uses has a palette slot, appending missing ones
 * in stitch-out order. Returns the same array when nothing was missing.
 */
export function syncPalette(palette: PaletteSlot[], objects: readonly StitchObject[]): PaletteSlot[] {
  let out = palette;
  for (const o of objects) {
    if (paletteIndexOf(out, o.color) >= 0) continue;
    if (out === palette) out = [...palette];
    out.push({ color: [o.color[0], o.color[1], o.color[2]], thread: o.thread });
  }
  return out;
}

// ---- Stitches ----

/** Shared empty motif list, so calls without motifs hit the cache (it compares by reference). */
export const NO_MOTIFS: readonly Motif[] = Object.freeze([]);

/** Hand edits if any, else underlay followed by top stitching (see sewObject). */
export function computeStitches(o: StitchObject, motifs: readonly Motif[] = NO_MOTIFS): Point[] {
  if (o.customStitches) return o.customStitches;
  return sewObject(o, motifs);
}

interface CacheEntry {
  version: number;
  motifs: readonly Motif[];
  stitches: Point[];
}

/**
 * Stitches per object, keyed by object id and valid for one (version, project motifs) pair.
 * Owned by the caller - no global state. Motifs are compared by reference, so replace the
 * document's motif array (don't mutate it) when motifs change.
 */
export class StitchCache {
  private entries = new Map<number, CacheEntry>();

  constructor(private readonly compute: (o: StitchObject, motifs: readonly Motif[]) => Point[] = computeStitches) {}

  get(o: StitchObject, motifs: readonly Motif[] = NO_MOTIFS): Point[] {
    const hit = this.entries.get(o.id);
    if (hit && hit.version === o.version && hit.motifs === motifs) return hit.stitches;
    const stitches = this.compute(o, motifs);
    this.entries.set(o.id, { version: o.version, motifs, stitches });
    return stitches;
  }

  delete(id: number): void {
    this.entries.delete(id);
  }

  /** Drops entries for objects no longer in the document. */
  prune(objects: readonly StitchObject[]): void {
    const live = new Set(objects.map((o) => o.id));
    for (const id of this.entries.keys()) if (!live.has(id)) this.entries.delete(id);
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}
