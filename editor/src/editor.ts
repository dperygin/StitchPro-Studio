// The Editor class: tools, selection, commands, undo. All editing logic lives here; a UI shell
// only calls this API and re-renders when the editor says it changed.

import {
  StitchCache,
  applyClosestJoin,
  createDocument,
  createObject,
  syncPalette,
  translateObject,
  type NewObject,
  type Point,
  type RGB,
  type StitchDocument,
  type StitchObject,
  type StitchType,
} from '@stitchpro/engine';
import { COMMIT_SOON_MS, NUDGE_BIG_FACTOR, NUDGE_MM, OBJECT_PICK_PX } from './constants';
import { FontLibrary } from './fonts';
import { History, type Snapshot } from './history';
import { ShapeCache, pickObject } from './hittest';
import { createTool, type Tool, type ToolName } from './tools';
import type { Units } from './units';
import { View } from './view';

export type { ToolName } from './tools';

/** A pointer event in canvas CSS pixels (as input.ts or a test produces it). */
export interface PointerInput {
  x: number;
  y: number;
  /** 0 = left, 1 = middle, 2 = right. */
  button?: 0 | 1 | 2;
  shift?: boolean;
  ctrl?: boolean;
  alt?: boolean;
  /** Milliseconds, for double clicks. */
  time?: number;
}

export interface KeyInput {
  key: string;
  shift?: boolean;
  ctrl?: boolean;
  alt?: boolean;
}

/** What changed, so the renderer can skip work: the base layer, only live objects, or only the overlay/state. */
export type ChangeKind = 'base' | 'live' | 'overlay' | 'state';
export type ChangeListener = (kind: ChangeKind) => void;

/** Copied objects, shared between the tabs of one app. */
export class Clipboard {
  objects: StitchObject[] = [];
}

export interface EditorOptions {
  fonts?: FontLibrary;
  clipboard?: Clipboard;
}

/** What drawing tools create. */
export interface DrawMode {
  stitchType: StitchType;
  closed: boolean;
}

export class Editor {
  doc: StitchDocument;
  readonly view = new View();
  readonly history = new History();
  readonly stitchCache = new StitchCache();
  readonly shapes = new ShapeCache();
  readonly fonts: FontLibrary;
  readonly clipboard: Clipboard;

  units: Units = 'mm';
  status = '';
  simStitch = false;
  drawMode: DrawMode = { stitchType: 'running', closed: false };
  currentColor: RGB = [0, 0, 0];
  /** Pointer position in design mm (null when off the canvas). */
  pointer: Point | null = null;
  /** Objects being changed live: drawn every frame, left off the base layer. */
  readonly live = new Set<number>();
  /** Bumped whenever what the base layer shows changes. */
  baseRevision = 0;

  tool: Tool;
  private listeners = new Set<ChangeListener>();
  private changeCounter = 0;
  private order: number[] = [];
  private maxVersion = new Map<number, number>();
  private soon: ReturnType<typeof setTimeout> | null = null;

  constructor(doc: StitchDocument = createDocument(), opts: EditorOptions = {}) {
    this.doc = doc;
    this.fonts = opts.fonts ?? new FontLibrary();
    this.clipboard = opts.clipboard ?? new Clipboard();
    for (const o of doc.objects) this.noteVersion(o);
    this.history.record(this.doc, [], 'Open');
    this.tool = createTool('select', this);
  }

  // ---- change notification ----

  /** Subscribe to changes; returns an unsubscribe function. */
  subscribe(listener: ChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Increments on every change; lets React detect updates cheaply. */
  get revision(): number {
    return this.changeCounter;
  }

  /** Tell subscribers something changed. 'base' also invalidates the renderer's base layer. */
  changed(kind: ChangeKind = 'state'): void {
    if (kind === 'base') this.baseRevision++;
    this.changeCounter++;
    for (const l of this.listeners) l(kind);
  }

  /** Display units for lengths (stitch settings always show mm). */
  setUnits(units: Units): void {
    if (units === this.units) return;
    this.units = units;
    this.changed('state');
  }

  setStatus(message: string): void {
    if (message === this.status) return;
    this.status = message;
    this.changed('state');
  }

  // ---- objects ----

  object(id: number): StitchObject | undefined {
    return this.doc.objects.find((o) => o.id === id);
  }

  /** An object's stitches, cached by (id, version). */
  stitches(o: StitchObject): ReturnType<StitchCache['get']> {
    return this.stitchCache.get(o, this.doc.motifs);
  }

  private noteVersion(o: StitchObject): void {
    this.maxVersion.set(o.id, Math.max(this.maxVersion.get(o.id) ?? 0, o.version));
  }

  /** A version number never used before for this object (so cached stitches can't go stale). */
  private freshVersion(id: number): number {
    const v = (this.maxVersion.get(id) ?? 0) + 1;
    this.maxVersion.set(id, v);
    return v;
  }

  /** Marks an object edited in place: bumps its version. */
  touch(o: StitchObject): void {
    o.version = this.freshVersion(o.id);
    this.changed(this.live.has(o.id) ? 'live' : 'base');
  }

  /** Puts a changed copy in place of the object with the same id (giving it a fresh version). */
  replace(o: StitchObject): StitchObject {
    const i = this.doc.objects.findIndex((x) => x.id === o.id);
    if (i < 0) return o;
    const next = { ...o, version: this.freshVersion(o.id) };
    this.doc.objects[i] = next;
    this.changed(this.live.has(o.id) ? 'live' : 'base');
    return next;
  }

  /** A new object in the current draw mode and colour (not yet added). */
  newObject(init: NewObject = {}): StitchObject {
    return createObject(this.doc, { stitchType: this.drawMode.stitchType, closed: this.drawMode.closed, color: [...this.currentColor], ...init });
  }

  addObject(o: StitchObject, index = this.doc.objects.length): StitchObject {
    this.doc.objects.splice(index, 0, o);
    this.noteVersion(o);
    this.changed('base');
    return o;
  }

  removeObjects(ids: Iterable<number>): void {
    const gone = new Set(ids);
    this.doc.objects = this.doc.objects.filter((o) => !gone.has(o.id));
    this.order = this.order.filter((id) => !gone.has(id));
    this.changed('base');
  }

  /** Starts changing objects live (dragging): they leave the base layer. */
  beginLive(ids: Iterable<number>): void {
    for (const id of ids) this.live.add(id);
    this.changed('base');
  }

  endLive(): void {
    if (!this.live.size) return;
    this.live.clear();
    this.changed('base');
  }

  // ---- selection ----

  get selection(): ReadonlySet<number> {
    return new Set(this.order);
  }

  /** Selected ids in the order they were picked. */
  get selectionOrder(): readonly number[] {
    return this.order;
  }

  selectedObjects(): StitchObject[] {
    return this.order.map((id) => this.object(id)).filter((o): o is StitchObject => !!o);
  }

  isSelected(id: number): boolean {
    return this.order.includes(id);
  }

  /** Selects an object (adding to the selection with `add`). */
  select(id: number, add = false): void {
    if (add) {
      if (!this.order.includes(id)) this.order = [...this.order, id];
    } else this.order = [id];
    this.changed('overlay');
  }

  setSelection(ids: Iterable<number>): void {
    this.order = [...new Set(ids)].filter((id) => this.object(id));
    this.changed('overlay');
  }

  toggleSelected(id: number): void {
    this.order = this.order.includes(id) ? this.order.filter((x) => x !== id) : [...this.order, id];
    this.changed('overlay');
  }

  selectAll(): void {
    this.setSelection(this.doc.objects.filter((o) => o.visible && !o.locked).map((o) => o.id));
  }

  clearSelection(): void {
    if (!this.order.length) return;
    this.order = [];
    this.changed('overlay');
  }

  // ---- commit / undo ----

  /**
   * One undo step: re-plans lettering, applies closest join, syncs the palette and records
   * history. Call after every finished edit.
   */
  commit(label = ''): void {
    this.cancelCommitSoon();
    this.replanLettering();
    if (this.doc.closestJoin) {
      const joined = applyClosestJoin(this.doc, (o) => this.stitches(o));
      if (joined !== this.doc.objects) {
        this.doc.objects = joined.map((o, i) => {
          if (o === this.doc.objects[i]) return o;
          return { ...o, version: this.freshVersion(o.id) };
        });
      }
    }
    this.doc.palette = syncPalette(this.doc.palette, this.doc.objects);
    this.stitchCache.prune(this.doc.objects);
    this.shapes.prune(this.doc.objects);
    this.history.record(this.doc, this.order, label);
    this.changed('base');
  }

  /** Commits after a short pause (while a property field is being typed into). */
  commitSoon(label = '', ms = COMMIT_SOON_MS): void {
    this.cancelCommitSoon();
    this.soon = setTimeout(() => {
      this.soon = null;
      this.commit(label);
    }, ms);
  }

  private cancelCommitSoon(): void {
    if (this.soon) clearTimeout(this.soon);
    this.soon = null;
  }

  /** Lettering pieces are rebuilt from their textMeta here (prompt 20). */
  protected replanLettering(): void {}

  undo(): boolean {
    if (this.soon) this.commit();
    const snap = this.history.undo();
    if (!snap) return false;
    this.restore(snap);
    return true;
  }

  redo(): boolean {
    const snap = this.history.redo();
    if (!snap) return false;
    this.restore(snap);
    return true;
  }

  private restore(snap: Snapshot): void {
    this.tool.cancel();
    this.endLive();
    const current = new Map(this.doc.objects.map((o) => [o.id, o]));
    const objects = snap.objects.map((saved) => {
      const cur = current.get(saved.id);
      // Unchanged objects are kept as they are (their cached stitches stay valid).
      if (cur && cur.version === saved.version) return cur;
      const copy = structuredClone(saved);
      copy.version = this.freshVersion(saved.id);
      return copy;
    });
    this.doc = { ...structuredClone(snap.doc), objects, artwork: snap.artwork.map((a) => ({ ...a })) };
    // The snapshot now matches the restored versions only where they were kept.
    this.order = snap.selection.filter((id) => objects.some((o) => o.id === id));
    this.stitchCache.prune(objects);
    this.shapes.prune(objects);
    this.changed('base');
  }

  get canUndo(): boolean {
    return this.history.canUndo();
  }

  get canRedo(): boolean {
    return this.history.canRedo();
  }

  // ---- tools and input ----

  get toolName(): ToolName {
    return this.tool.name;
  }

  setTool(name: ToolName): void {
    if (name === this.tool.name) return;
    this.tool.cancel();
    this.tool = createTool(name, this);
    this.changed('overlay');
  }

  /** Design mm under a screen point. */
  toDesign(e: { x: number; y: number }): Point {
    return this.view.toDesign([e.x, e.y]);
  }

  /** Screen pixels as design mm at the current zoom. */
  pxToMm(px: number): number {
    return px / this.view.zoom;
  }

  /** The topmost object under a screen point. */
  objectAt(e: { x: number; y: number }): StitchObject | null {
    return pickObject(this.doc, this.shapes, this.toDesign(e), this.pxToMm(OBJECT_PICK_PX));
  }

  pointerDown(e: PointerInput): void {
    this.pointer = this.toDesign(e);
    this.tool.pointerDown(e);
  }

  pointerMove(e: PointerInput): void {
    this.pointer = this.toDesign(e);
    this.tool.pointerMove(e);
    this.changed('overlay');
  }

  pointerUp(e: PointerInput): void {
    this.pointer = this.toDesign(e);
    this.tool.pointerUp(e);
  }

  /** Returns true when the key was handled. Tools see keys first. */
  keyDown(e: KeyInput): boolean {
    if (this.tool.keyDown(e)) return true;
    const k = e.key;
    if (e.ctrl && !e.alt) {
      const lower = k.toLowerCase();
      if (lower === 'z' && !e.shift) return this.undo() || true;
      if (lower === 'y' || (lower === 'z' && e.shift)) return this.redo() || true;
      if (lower === 'a') {
        this.selectAll();
        return true;
      }
      return false;
    }
    if (k === 'Delete' || k === 'Backspace') {
      if (!this.order.length) return false;
      this.deleteSelection();
      return true;
    }
    if (k.startsWith('Arrow')) {
      const step = NUDGE_MM * (e.shift ? NUDGE_BIG_FACTOR : 1);
      const d: Record<string, Point> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      const v = d[k];
      if (!v || !this.order.length) return false;
      this.moveSelection(v[0], v[1]);
      this.commit('Nudge');
      return true;
    }
    if (k === 'Escape') {
      if (this.tool.name !== 'select') this.setTool('select');
      else this.clearSelection();
      return true;
    }
    const tools: Record<string, ToolName> = { o: 'select', r: 'reshape', g: 'angle', e: 'stitches', m: 'measure' };
    const t = tools[k.toLowerCase()];
    if (t && !e.alt) {
      this.setTool(t);
      return true;
    }
    if (k.toLowerCase() === 's') {
      this.simStitch = !this.simStitch;
      this.changed('base');
      return true;
    }
    return false;
  }

  zoomAt(screen: Point, factor: number): void {
    const before = this.view.toDesign(screen);
    this.view.zoom = Math.min(400, Math.max(0.05, this.view.zoom * factor));
    this.view.panX = screen[0] - before[0] * this.view.zoom;
    this.view.panY = screen[1] - before[1] * this.view.zoom;
    this.changed('base');
  }

  panBy(dx: number, dy: number): void {
    this.view.panX += dx;
    this.view.panY += dy;
    this.changed('base');
  }

  // ---- commands ----

  /** Moves the selected objects by (dx, dy) mm (call commit afterwards). */
  moveSelection(dx: number, dy: number): void {
    for (const o of this.selectedObjects()) if (!o.locked) this.replace(translateObject(o, dx, dy));
  }

  deleteSelection(): void {
    if (!this.order.length) return;
    this.removeObjects(this.order);
    this.commit('Delete');
  }
}
