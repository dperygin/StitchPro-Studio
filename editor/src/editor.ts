// The Editor class: tools, selection, commands, undo. All editing logic lives here.

import { StitchCache, createDocument, type Point, type StitchDocument } from '@stitchpro/engine';
import { History } from './history';
import { View } from './view';
import type { Units } from './units';

export type ChangeListener = () => void;

export class Editor {
  doc: StitchDocument = createDocument();
  readonly view = new View();
  readonly history = new History();
  readonly stitchCache = new StitchCache();
  units: Units = 'mm';

  private listeners = new Set<ChangeListener>();
  private changeCounter = 0;

  /** Subscribe to changes; returns an unsubscribe function. */
  subscribe(listener: ChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Increments on every change; lets React detect updates cheaply. */
  get revision(): number {
    return this.changeCounter;
  }

  setUnits(units: Units): void {
    if (units === this.units) return;
    this.units = units;
    this.changed();
  }

  // Pointer/keyboard entry points, fed by input.ts (or by tests with fake events).
  pointerDown(_p: Point): void {}
  pointerMove(_p: Point): void {}
  pointerUp(_p: Point): void {}
  keyDown(_key: string): void {}

  zoomAt(screen: Point, factor: number): void {
    const before = this.view.toDesign(screen);
    this.view.zoom = Math.min(400, Math.max(0.05, this.view.zoom * factor));
    this.view.panX = screen[0] - before[0] * this.view.zoom;
    this.view.panY = screen[1] - before[1] * this.view.zoom;
    this.changed();
  }

  protected changed(): void {
    this.changeCounter++;
    for (const l of this.listeners) l();
  }
}
