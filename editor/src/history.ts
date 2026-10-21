// Undo/redo snapshots with structural sharing: an object is deep-copied only when its version
// changed since the last snapshot; artwork image data (src strings) is shared, never copied.

import type { Artwork, StitchDocument, StitchObject } from '@stitchpro/engine';

export interface Snapshot {
  /** Everything but objects and artwork. */
  doc: Omit<StitchDocument, 'objects' | 'artwork'>;
  objects: StitchObject[];
  artwork: Artwork[];
  selection: number[];
  label: string;
}

const clone = <T>(v: T): T => structuredClone(v);

export class History {
  private stack: Snapshot[] = [];
  private index = -1;
  /** Copies in the newest snapshot, by object id, for sharing. */
  private copies = new Map<number, StitchObject>();

  constructor(private readonly limit = 200) {}

  /** Records the document as one undo step. */
  record(doc: StitchDocument, selection: readonly number[], label = ''): Snapshot {
    const objects = doc.objects.map((o) => {
      const prev = this.copies.get(o.id);
      return prev && prev.version === o.version ? prev : clone(o);
    });
    this.copies = new Map(objects.map((o) => [o.id, o]));
    const { objects: _o, artwork, ...rest } = doc;
    const snap: Snapshot = {
      doc: clone(rest),
      objects,
      // Artwork image data is a (possibly huge) string: shared, not copied.
      artwork: artwork.map((a) => ({ ...a })),
      selection: [...selection],
      label,
    };
    this.stack.splice(this.index + 1);
    this.stack.push(snap);
    if (this.stack.length > this.limit) this.stack.shift();
    this.index = this.stack.length - 1;
    return snap;
  }

  canUndo(): boolean {
    return this.index > 0;
  }

  canRedo(): boolean {
    return this.index < this.stack.length - 1;
  }

  /** The snapshot to go back to, or null. */
  undo(): Snapshot | null {
    if (!this.canUndo()) return null;
    this.index--;
    return this.current();
  }

  redo(): Snapshot | null {
    if (!this.canRedo()) return null;
    this.index++;
    return this.current();
  }

  current(): Snapshot {
    const snap = this.stack[this.index]!;
    this.copies = new Map(snap.objects.map((o) => [o.id, o]));
    return snap;
  }

  /** Label of the step undo would revert (for the UI). */
  get undoLabel(): string {
    return this.canUndo() ? this.stack[this.index]!.label : '';
  }

  get size(): number {
    return this.stack.length;
  }
}
