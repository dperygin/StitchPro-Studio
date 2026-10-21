// Document model, objects, palette and the per-object stitch cache.

import type { Point, Stitch, StitchSettings } from './types';
import { DEFAULT_SETTINGS } from './types';

export interface DesignObject {
  id: string;
  /** Bumped on every change; the stitch cache is keyed by (id, version). */
  version: number;
  colorIndex: number;
  points: Point[];
  settings: StitchSettings;
}

export interface PaletteEntry {
  name: string;
  rgb: [number, number, number];
  code?: string;
  brand?: string;
}

export interface Design {
  name: string;
  objects: DesignObject[];
  palette: PaletteEntry[];
}

export function createDesign(name = 'Untitled'): Design {
  return { name, objects: [], palette: [{ name: 'Black', rgb: [0, 0, 0] }] };
}

export function createObject(id: string, points: Point[] = []): DesignObject {
  return { id, version: 1, colorIndex: 0, points, settings: { ...DEFAULT_SETTINGS } };
}

/** Returns a copy of the object with its version bumped. */
export function touch(obj: DesignObject, changes: Partial<Omit<DesignObject, 'id' | 'version'>> = {}): DesignObject {
  return { ...obj, ...changes, version: obj.version + 1 };
}

/** Stitches cached by (object id, version). Owned by the caller - no global state. */
export class StitchCache {
  private entries = new Map<string, { version: number; stitches: Stitch[] }>();

  get(obj: DesignObject, generate: (o: DesignObject) => Stitch[]): Stitch[] {
    const hit = this.entries.get(obj.id);
    if (hit && hit.version === obj.version) return hit.stitches;
    const stitches = generate(obj);
    this.entries.set(obj.id, { version: obj.version, stitches });
    return stitches;
  }

  delete(id: string): void {
    this.entries.delete(id);
  }

  get size(): number {
    return this.entries.size;
  }
}
