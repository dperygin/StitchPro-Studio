// The Editor class: tools, selection, commands, undo. All editing logic lives here; a UI shell
// only calls this API and re-renders when the editor says it changed.

import {
  StitchCache,
  applyClosestJoin,
  DEFAULT_LETTER,
  POOR_MATCH_DELTA_E,
  allocateId,
  arrayOffsets,
  appliquePieces,
  buildText,
  cutObject,
  enclosedArea,
  fillHoleObjects,
  knockoutPlan,
  laydownObjects,
  partialAppliquePlan,
  regionRings,
  weldObjects,
  type AppliqueOptions,
  type LaydownShape,
  layoutText,
  letterMeta,
  type LetterAdjust,
  type TextSpec,
  circleTransforms,
  fitsHoop,
  nearestThread,
  type Thread,
  offsetObjectOutlines,
  pathNode,
  pointInRegion,
  buildExportPlan,
  createDocument,
  createObject,
  findHoop,
  mirror,
  planDesign,
  reversedObject,
  rotation,
  sameColor,
  scaling,
  skewX,
  smoothPath,
  syncPalette,
  transformObject,
  translateObject,
  translation,
  type Affine,
  type ExportPlan,
  type MachineMark,
  type NewObject,
  type PaletteSlot,
  type Point,
  type RGB,
  type ShapeKind,
  type Artwork,
  type StitchDocument,
  type StitchObject,
  type StitchSettings,
  type StitchType,
  type ThreadRef,
} from '@stitchpro/engine';
import { COMMANDS, keyCombo, type CommandId } from './commands';
import { COMMIT_SOON_MS, NUDGE_BIG_FACTOR, NUDGE_MM, OBJECT_PICK_PX, PASTE_OFFSET_MM, RULER_PX, SNAP_PX } from './constants';
import { moveByColourBlock, optimizeColourChanges, sequenceByColour } from './sequence';
import { FontLibrary } from './fonts';
import { History, type Snapshot } from './history';
import { ShapeCache, pickObject, unionBox, type Box } from './hittest';
import { createTool, setPickMode, type PickMode, type Tool, type ToolName } from './tools';
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

/** Things only the host app can do (file pickers, downloads, dialogs). */
export type HostAction =
  | 'new'
  | 'open'
  | 'save'
  | 'saveAs'
  | 'export'
  | 'settings'
  | 'dialog'
  | 'text'
  | 'fontEditor'
  | 'importMachine'
  | 'importArtwork'
  | 'importSvg'
  | 'exportSvg'
  | 'print';
export type ActionListener = (action: HostAction, arg?: unknown) => void;

/** Copied objects, shared between the tabs of one app. */
export class Clipboard {
  objects: StitchObject[] = [];
  /** How many times the current contents were pasted (each paste is offset a bit more). */
  pastes = 0;
}

export interface EditorOptions {
  fonts?: FontLibrary;
  clipboard?: Clipboard;
}

/** What drawing tools create. */
export interface DrawMode {
  stitchType: StitchType;
  closed: boolean;
  /** Column tool: the two rails' nodes pair up. */
  paired?: boolean;
  /** The next closed shape becomes a hole in the selected area. */
  hole?: boolean;
}

export const OUTLINE_TYPES: readonly StitchType[] = ['running', 'satin', 'zigzag', 'e_stitch', 'motif_line'];
export const FILL_TYPES: readonly StitchType[] = ['fill', 'satin_fill', 'outline', 'motif_fill', 'contour', 'stipple', 'cross_stitch'];

export interface PlayerState {
  /** How many stitches are shown (null = player off: everything is shown). */
  index: number | null;
  playing: boolean;
  /** Stitches per second. */
  speed: number;
}

/** Decoded pixels of an artwork picture (RGBA rows), supplied by the host. */
export interface ArtworkPixels {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export interface ChartMatchReport {
  /** Worst ΔE 2000 between a colour and its thread. */
  worst: number;
  /** Colours whose best thread is further than ΔE 5. */
  poor: number;
}

/** Copied properties: stitch settings and colour. */
interface CopiedProperties {
  settings: StitchSettings;
  color: RGB;
  thread: ThreadRef | null;
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
  showGrid = false;
  gridSpacing = 10;
  snap = false;
  showRulers = true;
  showMarks = false;
  stitchListOpen = false;
  hideUnusedColours = false;
  /** Canvas size in CSS pixels. */
  viewport = { width: 0, height: 0 };
  drawMode: DrawMode = { stitchType: 'running', closed: false };
  shapeKind: ShapeKind = 'rectangle';
  /** Selection handles: resize, or (after clicking the selection again) rotate and skew. */
  handleMode: 'scale' | 'rotate' = 'scale';
  currentColor: RGB = [0, 0, 0];
  /** Pointer position in design mm (null when off the canvas). */
  pointer: Point | null = null;
  /** Objects being changed live: drawn every frame, left off the base layer. */
  readonly live = new Set<number>();
  /** Bumped whenever what the base layer shows changes. */
  baseRevision = 0;
  readonly player: PlayerState = { index: null, playing: false, speed: 400 };
  /** Decoded artwork pictures by artwork id (the host decodes images; Pick Color reads them). */
  readonly artworkPixels = new Map<number, ArtworkPixels>();

  tool: Tool;
  private listeners = new Set<ChangeListener>();
  private actionListeners = new Set<ActionListener>();
  private changeCounter = 0;
  private order: number[] = [];
  private maxVersion = new Map<number, number>();
  private soon: ReturnType<typeof setTimeout> | null = null;
  private playTimer: ReturnType<typeof setInterval> | null = null;
  private copied: CopiedProperties | null = null;
  private marksCache: { revision: number; marks: MachineMark[] } | null = null;
  private fitted = false;
  private nextGroupId = 1;

  constructor(doc: StitchDocument = createDocument(), opts: EditorOptions = {}) {
    this.doc = doc;
    this.fonts = opts.fonts ?? new FontLibrary();
    this.clipboard = opts.clipboard ?? new Clipboard();
    for (const o of doc.objects) {
      this.noteVersion(o);
      if (o.groupId !== null) this.nextGroupId = Math.max(this.nextGroupId, o.groupId + 1);
    }
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

  /** Listen for things only the host can do (file pickers, downloads, dialogs). */
  onAction(listener: ActionListener): () => void {
    this.actionListeners.add(listener);
    return () => this.actionListeners.delete(listener);
  }

  requestAction(action: HostAction, arg?: unknown): void {
    for (const l of this.actionListeners) l(action, arg);
  }

  setStatus(message: string): void {
    if (message === this.status) return;
    this.status = message;
    this.changed('state');
  }

  /** Display units for lengths (stitch settings always show mm). */
  setUnits(units: Units): void {
    if (units === this.units) return;
    this.units = units;
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

  stitchCount(o: StitchObject): number {
    return this.stitches(o).length;
  }

  /** Stitches of every visible object. */
  totalStitches(): number {
    return this.doc.objects.reduce((sum, o) => sum + (o.visible ? this.stitchCount(o) : 0), 0);
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
    const o = createObject(this.doc, { stitchType: this.drawMode.stitchType, closed: this.drawMode.closed, color: [...this.currentColor], ...init });
    if (this.drawMode.paired && o.settings.stitchType === 'radial_satin') o.settings.pairedRails = true;
    return o;
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

  /** Ids of the whole groups that the given objects belong to. */
  private withGroups(ids: readonly number[]): number[] {
    const groups = new Set(ids.map((id) => this.object(id)?.groupId).filter((g): g is number => g !== null && g !== undefined));
    if (!groups.size) return [...ids];
    const extra = this.doc.objects.filter((o) => o.groupId !== null && groups.has(o.groupId)).map((o) => o.id);
    return [...new Set([...ids, ...extra])];
  }

  /** Selects an object (and its group), adding to the selection with `add`. */
  select(id: number, add = false): void {
    const ids = this.withGroups([id]);
    this.order = add ? [...new Set([...this.order, ...ids])] : ids;
    this.changed('overlay');
  }

  setSelection(ids: Iterable<number>): void {
    this.order = [...new Set(ids)].filter((id) => this.object(id));
    this.changed('overlay');
  }

  toggleSelected(id: number): void {
    const ids = this.withGroups([id]);
    this.order = this.order.includes(id) ? this.order.filter((x) => !ids.includes(x)) : [...new Set([...this.order, ...ids])];
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

  /** Tab / Shift+Tab: the next or previous object in sewing order. */
  selectNext(step: 1 | -1 = 1): void {
    const objs = this.doc.objects.filter((o) => o.visible);
    if (!objs.length) return;
    const last = this.order[this.order.length - 1];
    const i = objs.findIndex((o) => o.id === last);
    const next = i < 0 ? (step === 1 ? 0 : objs.length - 1) : (i + step + objs.length) % objs.length;
    this.setSelection([objs[next]!.id]);
  }

  /** Bounding box of the selection (or of the given objects). */
  selectionBox(objects = this.selectedObjects()): Box | null {
    let box: Box | null = null;
    for (const o of objects) box = unionBox(box, this.shapes.get(o).box);
    return box;
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
        this.doc.objects = joined.map((o, i) => (o === this.doc.objects[i] ? o : { ...o, version: this.freshVersion(o.id) }));
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

  // ---- commands (the registry in commands.ts) ----

  /** Runs a command by id (the toolbars, menus and shortcuts all come here). */
  run(id: CommandId, arg?: unknown): boolean {
    const cmd = COMMANDS.find((c) => c.id === id);
    if (!cmd || !cmd.ready || (cmd.enabled && !cmd.enabled(this))) return false;
    cmd.run(this, arg);
    return true;
  }

  isEnabled(id: CommandId): boolean {
    const cmd = COMMANDS.find((c) => c.id === id);
    return !!cmd && cmd.ready && (!cmd.enabled || cmd.enabled(this));
  }

  isChecked(id: CommandId): boolean {
    const cmd = COMMANDS.find((c) => c.id === id);
    return !!cmd?.checked?.(this);
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

  /** The pick tool for entry, exit, colour or hoop-out points. */
  pick(mode: PickMode): void {
    this.setTool('pick');
    setPickMode(this.tool, mode);
    const what = { entry: 'the entry point', exit: 'the exit point', colour: 'an object to take its colour', hoop: 'the hoop-out point' }[mode];
    this.setStatus(`Click ${what}`);
  }

  /** Starts digitizing in a mode. */
  startDrawing(mode: Partial<DrawMode>): void {
    this.drawMode = { ...this.drawMode, hole: false, paired: false, ...mode };
    this.setTool('draw');
    this.tool.cancel();
    this.changed('overlay');
  }

  startShape(kind: ShapeKind): void {
    this.shapeKind = kind;
    if (!this.drawMode.closed) this.drawMode = { ...this.drawMode, closed: true, stitchType: 'fill' };
    this.setTool('shape');
    this.tool.cancel();
    this.setStatus(`Drag a box for the ${kind} (Ctrl keeps proportions)`);
  }

  /** Outline or fill mode: what closed shapes are sewn with. */
  setFillMode(fill: boolean): void {
    this.drawMode = { ...this.drawMode, closed: fill, stitchType: fill ? 'fill' : 'running' };
    this.changed('state');
  }

  /** The stitch type for new objects; also applied to the selected objects. */
  setStitchType(type: StitchType): void {
    this.drawMode = { ...this.drawMode, stitchType: type, closed: FILL_TYPES.includes(type) ? true : this.drawMode.closed };
    const sel = this.selectedObjects();
    if (sel.length) {
      for (const o of sel) this.replace({ ...o, settings: { ...o.settings, stitchType: type } });
      this.commit('Stitch type');
    } else this.changed('state');
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

  /** Returns true when the key was handled. Tools see keys first (Letters mode keys win). */
  keyDown(e: KeyInput): boolean {
    if (this.tool.keyDown(e)) return true;
    const k = e.key;
    if (k.startsWith('Arrow') && !e.ctrl) {
      const step = NUDGE_MM * (e.shift ? NUDGE_BIG_FACTOR : 1);
      const d: Record<string, Point> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      const v = d[k];
      if (!v || !this.order.length) return false;
      // Alt + arrows: continuous copy (a copy left behind at each step).
      if (e.alt) this.duplicate([0, 0]);
      this.moveSelection(v[0], v[1]);
      this.commit(e.alt ? 'Continuous copy' : 'Nudge');
      return true;
    }
    if (k === 'Escape') {
      if (this.player.index !== null) this.playerStop();
      else if (this.tool.name !== 'select') this.setTool('select');
      else this.clearSelection();
      return true;
    }
    const combo = keyCombo(e);
    const cmd = COMMANDS.find((c) => c.keys?.includes(combo));
    if (!cmd) return false;
    return this.run(cmd.id);
  }

  // ---- view ----

  setViewport(width: number, height: number): void {
    if (width === this.viewport.width && height === this.viewport.height) return;
    this.viewport = { width, height };
    if (!this.fitted && width > 0 && height > 0) {
      this.fitted = true;
      this.fit();
    } else this.changed('base');
  }

  /** The hoop and the design together, mm. */
  contentBox(): Box {
    const d = this.doc;
    const hoop: Box = { minX: -d.hoopWidth / 2, minY: -d.hoopHeight / 2, maxX: d.hoopWidth / 2, maxY: d.hoopHeight / 2 };
    const design = this.selectionBox(d.objects.filter((o) => o.visible));
    return design ? unionBox(hoop, design) : hoop;
  }

  /** Zooms to show the hoop and the whole design. */
  fit(): void {
    const { width, height } = this.viewport;
    if (!(width > 0 && height > 0)) return;
    const box = this.contentBox();
    const ruler = this.showRulers ? RULER_PX : 0;
    const w = Math.max(1, width - ruler - 40);
    const h = Math.max(1, height - ruler - 40);
    const zoom = Math.min(w / (box.maxX - box.minX || 1), h / (box.maxY - box.minY || 1));
    this.view.zoom = Math.min(400, Math.max(0.05, zoom));
    this.view.panX = ruler + (width - ruler) / 2 - ((box.minX + box.maxX) / 2) * this.view.zoom;
    this.view.panY = ruler + (height - ruler) / 2 - ((box.minY + box.maxY) / 2) * this.view.zoom;
    this.changed('base');
  }

  zoomAt(screen: Point, factor: number): void {
    const before = this.view.toDesign(screen);
    this.view.zoom = Math.min(400, Math.max(0.05, this.view.zoom * factor));
    this.view.panX = screen[0] - before[0] * this.view.zoom;
    this.view.panY = screen[1] - before[1] * this.view.zoom;
    this.changed('base');
  }

  /** Zoom about the centre of the canvas. */
  zoomBy(factor: number): void {
    this.zoomAt([this.viewport.width / 2, this.viewport.height / 2], factor);
  }

  panBy(dx: number, dy: number): void {
    this.view.panX += dx;
    this.view.panY += dy;
    this.changed('base');
  }

  setPan(panX: number, panY: number): void {
    this.view.panX = panX;
    this.view.panY = panY;
    this.changed('base');
  }

  toggle(flag: 'simStitch' | 'showGrid' | 'snap' | 'showRulers' | 'showMarks' | 'stitchListOpen' | 'hideUnusedColours'): void {
    this[flag] = !this[flag];
    this.changed(flag === 'stitchListOpen' || flag === 'hideUnusedColours' || flag === 'snap' ? 'state' : 'base');
  }

  setGridSpacing(mm: number): void {
    if (!(mm > 0)) return;
    this.gridSpacing = mm;
    this.changed('base');
  }

  // ---- document ----

  /** Design settings (name, hoop, jumps and trims, ...), as one undo step. */
  updateDoc(patch: Partial<Omit<StitchDocument, 'objects' | 'artwork' | 'palette' | 'nextObjectId'>>): void {
    Object.assign(this.doc, patch);
    this.commit('Design settings');
  }

  setHoop(id: string): void {
    const h = findHoop(id);
    if (!h) return;
    this.updateDoc({ hoopId: h.id, hoopWidth: h.width, hoopHeight: h.height, hoopShape: h.shape, hoopCorner: h.corner });
  }

  toggleClosestJoin(): void {
    this.updateDoc({ closestJoin: !this.doc.closestJoin });
    this.setStatus(`Closest join ${this.doc.closestJoin ? 'on' : 'off'}`);
  }

  /** The export plan for the server. */
  exportPlan(): ExportPlan {
    return buildExportPlan(this.doc, (o) => this.stitches(o));
  }

  /** Machine marks for the canvas (start, trims, stops, ...), cached until the design changes. */
  machineMarks(): MachineMark[] {
    if (this.marksCache?.revision !== this.baseRevision) {
      this.marksCache = { revision: this.baseRevision, marks: planDesign(this.doc, (o) => this.stitches(o)).marks };
    }
    return this.marksCache.marks;
  }

  // ---- clipboard and copies ----

  copy(): void {
    const sel = this.selectedObjects();
    if (!sel.length) return;
    this.clipboard.objects = structuredClone(sel);
    this.clipboard.pastes = 0;
    this.setStatus(`Copied ${sel.length} object${sel.length === 1 ? '' : 's'}`);
  }

  cut(): void {
    this.copy();
    this.deleteSelection('Cut');
  }

  /** Pastes the clipboard (from any tab), each paste offset 2 mm further. */
  paste(): void {
    const src = this.clipboard.objects;
    if (!src.length) return;
    this.clipboard.pastes++;
    const off = PASTE_OFFSET_MM * this.clipboard.pastes;
    this.setSelection(this.addCopies(src, [off, off]));
    this.commit('Paste');
  }

  /** Copies of objects added at the end, moved by offset; returns their ids. */
  private addCopies(src: readonly StitchObject[], offset: Point, modify: (o: StitchObject) => StitchObject = (o) => o): number[] {
    const groups = new Map<number, number>();
    return src.map((o) => {
      let groupId: number | null = null;
      if (o.groupId !== null) {
        if (!groups.has(o.groupId)) groups.set(o.groupId, this.nextGroupId++);
        groupId = groups.get(o.groupId)!;
      }
      const moved = modify(translateObject(o, offset[0], offset[1]));
      const { id: _id, version: _v, ...rest } = structuredClone(moved);
      return this.addObject(createObject(this.doc, { ...rest, groupId })).id;
    });
  }

  duplicate(offset: Point = [PASTE_OFFSET_MM, PASTE_OFFSET_MM]): void {
    const sel = this.selectedObjects();
    if (!sel.length) return;
    const ids = this.addCopies(sel, offset);
    this.setSelection(ids);
    if (offset[0] || offset[1]) this.commit('Duplicate');
  }

  /** Backtrack: a copy sewn the other way (reversed nodes), underlay off. */
  backtrack(): void {
    this.copyInPlace((o) => reversedObject(o), 'Backtrack');
  }

  /** Repeat: a copy sewn the same way, underlay off. */
  repeat(): void {
    this.copyInPlace((o) => o, 'Repeat');
  }

  private copyInPlace(modify: (o: StitchObject) => StitchObject, label: string): void {
    const sel = this.selectedObjects();
    if (!sel.length) return;
    const ids = this.addCopies(sel, [0, 0], (o) => {
      const m = modify(o);
      return { ...m, settings: { ...m.settings, underlayEnabled: false } };
    });
    this.setSelection(ids);
    this.commit(label);
  }

  copyProperties(): void {
    const o = this.selectedObjects()[0];
    if (!o) return;
    this.copied = { settings: structuredClone(o.settings), color: [...o.color], thread: o.thread };
    this.setStatus(`Copied the properties of ${o.name}`);
  }

  applyProperties(): void {
    const c = this.copied;
    if (!c) return;
    for (const o of this.selectedObjects()) this.replace({ ...o, settings: structuredClone(c.settings), color: [...c.color], thread: c.thread });
    this.commit('Apply properties');
  }

  get hasCopiedProperties(): boolean {
    return this.copied !== null;
  }

  // ---- groups, lock, visibility ----

  group(): void {
    const sel = this.selectedObjects();
    if (sel.length < 2) return;
    const g = this.nextGroupId++;
    for (const o of sel) this.replace({ ...o, groupId: g });
    this.commit('Group');
  }

  ungroup(): void {
    const sel = this.selectedObjects().filter((o) => o.groupId !== null);
    if (!sel.length) return;
    for (const o of sel) this.replace({ ...o, groupId: null });
    this.commit('Ungroup');
  }

  setLocked(locked: boolean, ids: readonly number[] = this.order): void {
    for (const id of ids) {
      const o = this.object(id);
      if (o && o.locked !== locked) this.replace({ ...o, locked });
    }
    this.commit(locked ? 'Lock' : 'Unlock');
  }

  setVisible(id: number, visible: boolean): void {
    const o = this.object(id);
    if (!o || o.visible === visible) return;
    this.replace({ ...o, visible });
    this.commit(visible ? 'Show' : 'Hide');
  }

  // ---- sequencing ----

  /** Moves objects (kept in their order) so the first lands at `index` of the remaining list. */
  moveObjects(ids: readonly number[], index: number): void {
    const moving = this.doc.objects.filter((o) => ids.includes(o.id));
    if (!moving.length) return;
    const rest = this.doc.objects.filter((o) => !ids.includes(o.id));
    const at = Math.max(0, Math.min(rest.length, index));
    this.doc.objects = [...rest.slice(0, at), ...moving, ...rest.slice(at)];
    this.commit('Sequence');
  }

  /** Number box: puts an object (and its group) at sewing position n (1-based). */
  setSequenceNumber(id: number, n: number): void {
    this.moveObjects(this.withGroups([id]), Math.round(n) - 1);
  }

  /** Move the selection to the start, up one, down one or to the end (past whole groups). */
  moveSelectionIn(where: 'start' | 'up' | 'down' | 'end'): void {
    const ids = this.withGroups(this.order);
    if (!ids.length) return;
    const objs = this.doc.objects;
    const first = objs.findIndex((o) => ids.includes(o.id));
    const last = objs.length - 1 - [...objs].reverse().findIndex((o) => ids.includes(o.id));
    const rest = objs.filter((o) => !ids.includes(o.id));
    let at: number;
    if (where === 'start') at = 0;
    else if (where === 'end') at = rest.length;
    else if (where === 'up') {
      const before = objs.slice(0, first).filter((o) => !ids.includes(o.id));
      const neighbour = before[before.length - 1];
      if (!neighbour) return;
      const block = neighbour.groupId === null ? [neighbour] : before.filter((o) => o.groupId === neighbour.groupId);
      at = rest.indexOf(block[0]!);
    } else {
      const after = objs.slice(last + 1).filter((o) => !ids.includes(o.id));
      const neighbour = after[0];
      if (!neighbour) return;
      const block = neighbour.groupId === null ? [neighbour] : after.filter((o) => o.groupId === neighbour.groupId);
      at = rest.indexOf(block[block.length - 1]!) + 1;
    }
    this.moveObjects(ids, at);
  }

  /** Sequence by selection: the selected objects in the order they were picked, where the first one was. */
  sequenceBySelection(): void {
    const picked = this.order.map((id) => this.object(id)).filter((o): o is StitchObject => !!o);
    if (picked.length < 2) return;
    const first = Math.min(...picked.map((o) => this.doc.objects.indexOf(o)));
    const rest = this.doc.objects.filter((o) => !picked.includes(o));
    const at = rest.filter((o) => this.doc.objects.indexOf(o) < first).length;
    this.doc.objects = [...rest.slice(0, at), ...picked, ...rest.slice(at)];
    this.commit('Sequence by selection');
  }

  // ---- transforms ----

  /** Applies an affine transform to the selected (unlocked) objects as one undo step. */
  transformSelection(m: Affine, label: string): void {
    const sel = this.selectedObjects().filter((o) => !o.locked);
    if (!sel.length) return;
    for (const o of sel) this.replace(transformObject(o, m));
    this.commit(label);
  }

  private selectionCentre(): Point | null {
    const box = this.selectionBox();
    return box ? [(box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2] : null;
  }

  rotateSelection(deg: number): void {
    const c = this.selectionCentre();
    if (c) this.transformSelection(rotation(deg, c[0], c[1]), `Rotate ${deg}°`);
  }

  flipSelection(vertical = false): void {
    const c = this.selectionCentre();
    if (c) this.transformSelection(mirror(c[0], c[1], vertical), 'Flip');
  }

  /** Skews about the selection's centre line: x' = x - tan(a) (y - centreY). */
  skewSelection(deg: number): void {
    const c = this.selectionCentre();
    if (c) this.transformSelection(skewX(deg, c[1]), `Skew ${deg}°`);
  }

  /** Size and position fields: puts the selection's box at (x, y) with size (w, h), mm. */
  setSelectionBox(next: { x?: number; y?: number; width?: number; height?: number }): void {
    const box = this.selectionBox();
    if (!box) return;
    const w = box.maxX - box.minX;
    const h = box.maxY - box.minY;
    const sx = next.width !== undefined && w > 0 ? next.width / w : 1;
    const sy = next.height !== undefined && h > 0 ? next.height / h : 1;
    const m = scaling(sx, sy, box.minX, box.minY);
    const tx = next.x !== undefined ? next.x - box.minX : 0;
    const ty = next.y !== undefined ? next.y - box.minY : 0;
    this.transformSelection([m[0], m[1], m[2], m[3], m[4] + tx, m[5] + ty], 'Size and position');
  }

  /** Centres the selection (or the whole design) in the hoop. */
  centerInHoop(): void {
    if (!this.order.length) this.selectAll();
    const c = this.selectionCentre();
    if (c) this.transformSelection(translation(-c[0], -c[1]), 'Centre in hoop');
  }

  /** Moves the selected objects by (dx, dy) mm (call commit afterwards). */
  moveSelection(dx: number, dy: number): void {
    for (const o of this.selectedObjects()) if (!o.locked) this.replace(translateObject(o, dx, dy));
  }

  /** Smooth curves: the fewest nodes keeping the line within 0.2 mm (prompt 5). */
  smoothSelection(precision = 0.2): void {
    const sel = this.selectedObjects().filter((o) => !o.locked);
    let saved = 0;
    for (const o of sel) {
      const points = smoothPath(o.points, o.closed, precision);
      if (points !== o.points) {
        saved += o.points.length - points.length;
        this.replace({ ...o, points });
      }
    }
    if (saved) this.commit('Smooth curves');
    this.setStatus(saved ? `Removed ${saved} node${saved === 1 ? '' : 's'}` : 'Nothing to smooth');
  }

  deleteSelection(label = 'Delete'): void {
    if (!this.order.length) return;
    this.removeObjects(this.withGroups(this.order));
    this.commit(label);
  }

  // ---- snapping and guides ----

  /** Snaps a design point to guides, then grid lines, within 8 px (when snap is on; Alt holds it free). */
  snapPoint(p: Point, e: { alt?: boolean } = {}): Point {
    if (!this.snap || e.alt) return p;
    const tol = this.pxToMm(SNAP_PX);
    const nearest = (v: number, lines: number[]) => {
      let best: number | null = null;
      for (const l of lines) if (Math.abs(l - v) <= tol && (best === null || Math.abs(l - v) < Math.abs(best - v))) best = l;
      return best;
    };
    const g = this.gridSpacing;
    const axis = (v: number, guideAxis: 'h' | 'v') => {
      const guide = nearest(v, this.doc.guides.filter((x) => x.axis === guideAxis).map((x) => x.pos));
      if (guide !== null) return guide;
      const grid = Math.round(v / g) * g;
      return Math.abs(grid - v) <= tol ? grid : v;
    };
    return [axis(p[0], 'v'), axis(p[1], 'h')];
  }

  /** Adds a guide line (axis 'v' = vertical at x = pos, 'h' = horizontal at y = pos); returns its index. */
  addGuide(axis: 'h' | 'v', pos: number): number {
    this.doc.guides = [...this.doc.guides, { axis, pos }];
    this.changed('base');
    return this.doc.guides.length - 1;
  }

  moveGuide(index: number, pos: number): void {
    this.doc.guides = this.doc.guides.map((g, i) => (i === index ? { ...g, pos } : g));
    this.changed('base');
  }

  removeGuide(index: number): void {
    this.doc.guides = this.doc.guides.filter((_, i) => i !== index);
    this.changed('base');
  }

  setHandleMode(mode: 'scale' | 'rotate'): void {
    if (mode === this.handleMode) return;
    this.handleMode = mode;
    this.changed('overlay');
  }

  // ---- polygon select ----

  /**
   * Polygon select: objects with every outline, hole, rail and stitch point inside the polygon
   * (even-odd ray-casting test).
   */
  polygonSelect(polygon: readonly Point[], add = false): void {
    if (polygon.length < 3) return;
    const ring: Point[] = [...polygon, polygon[0]!];
    const region = [{ outer: ring, holes: [] }];
    const inside = (p: Point) => pointInRegion(region, p) !== 'outside';
    const hits = this.doc.objects.filter((o) => {
      if (!o.visible || o.locked) return false;
      const s = this.shapes.get(o);
      const pts = [...s.outline, ...s.holes.flat(), ...s.rail2, ...this.stitches(o)];
      return pts.length > 0 && pts.every(inside);
    });
    this.setSelection(add ? [...this.order, ...hits.map((o) => o.id)] : hits.map((o) => o.id));
  }

  // ---- align and space ----

  /** Aligns the selection with the last selected object. */
  alignSelection(side: 'left' | 'centre' | 'right' | 'top' | 'middle' | 'bottom'): void {
    const sel = this.selectedObjects();
    const ref = sel[sel.length - 1];
    if (sel.length < 2 || !ref) return;
    const r = this.shapes.get(ref).box;
    for (const o of sel.slice(0, -1)) {
      if (o.locked) continue;
      const b = this.shapes.get(o).box;
      const dx =
        side === 'left' ? r.minX - b.minX : side === 'right' ? r.maxX - b.maxX : side === 'centre' ? (r.minX + r.maxX - b.minX - b.maxX) / 2 : 0;
      const dy =
        side === 'top' ? r.minY - b.minY : side === 'bottom' ? r.maxY - b.maxY : side === 'middle' ? (r.minY + r.maxY - b.minY - b.maxY) / 2 : 0;
      if (dx || dy) this.replace(translateObject(o, dx, dy));
    }
    this.commit(`Align ${side}`);
  }

  /** Spaces the selected objects' centres evenly between the outermost two. */
  spaceEvenly(axis: 'x' | 'y' = 'x'): void {
    const sel = this.selectedObjects();
    if (sel.length < 3) return;
    const centre = (o: StitchObject) => {
      const b = this.shapes.get(o).box;
      return axis === 'x' ? (b.minX + b.maxX) / 2 : (b.minY + b.maxY) / 2;
    };
    const sorted = [...sel].sort((a, b) => centre(a) - centre(b));
    const first = centre(sorted[0]!);
    const step = (centre(sorted[sorted.length - 1]!) - first) / (sorted.length - 1);
    sorted.forEach((o, i) => {
      const d = first + i * step - centre(o);
      if (Math.abs(d) > 1e-9 && !o.locked) this.replace(translateObject(o, axis === 'x' ? d : 0, axis === 'y' ? d : 0));
    });
    this.commit('Space evenly');
  }

  // ---- copy tools ----

  /** Copies of the selection under each transform (the first transform is the original's own place). */
  private placeCopies(transforms: readonly Affine[], label: string): void {
    const sel = this.selectedObjects();
    if (!sel.length || transforms.length < 2) return;
    const ids = transforms.slice(1).flatMap((m) => this.addCopies(sel, [0, 0], (o) => transformObject(o, m)));
    this.setSelection([...sel.map((o) => o.id), ...ids]);
    this.commit(label);
  }

  /** Array: rows x cols copies, dx and dy mm apart. */
  arrayCopies(rows: number, cols: number, dx: number, dy: number): void {
    this.placeCopies(arrayOffsets(rows, cols, dx, dy), 'Array');
  }

  /** Mirror: a mirrored copy beside the selection (across its right edge, or its bottom edge). */
  mirrorCopy(vertical = false, gap = 0): void {
    const box = this.selectionBox();
    if (!box) return;
    const m = vertical ? mirror(0, box.maxY + gap / 2, true) : mirror(box.maxX + gap / 2, 0);
    this.placeCopies([translation(0, 0), m], 'Mirror');
  }

  /** Circle / kaleidoscope: n placements round a centre, every other one reflected with `reflect`. */
  circleCopies(n: number, centre: Point, reflect = false): void {
    this.placeCopies(circleTransforms(n, centre[0], centre[1], reflect), reflect ? 'Kaleidoscope' : 'Circle');
  }

  /** New outline objects offset from what the selection covers (negative distance insets). */
  private offsetCopies(distance: number, init: (o: StitchObject) => NewObject, label: string): number {
    const made: number[] = [];
    for (const o of this.selectedObjects()) {
      for (const ring of offsetObjectOutlines(o, distance)) {
        const points = ring.slice(0, -1).map(([x, y]) => pathNode(x, y));
        if (points.length < 3) continue;
        made.push(this.addObject(createObject(this.doc, { color: [...o.color], thread: o.thread, closed: true, points, ...init(o) })).id);
      }
    }
    if (made.length) {
      this.setSelection(made);
      this.commit(label);
    } else this.setStatus('Nothing to offset (select a closed shape)');
    return made.length;
  }

  /** Insert offset: a running outline offset from the selection. */
  insertOffset(distance: number): number {
    return this.offsetCopies(distance, () => ({ stitchType: 'running' }), 'Insert offset');
  }

  /** Add border: a motif line along an offset of the selection. */
  addBorder(distance: number, motifName = 'wave'): number {
    return this.offsetCopies(
      distance,
      (o) => {
        const settings = { ...o.settings, stitchType: 'motif_line' as const, motifName };
        return { settings, name: `Border ${motifName}` };
      },
      'Add border',
    );
  }

  // ---- shape tools (prompt 22) ----

  /** Puts each planned object's pieces in its place in the sequence ([] removes it); returns the new ids. */
  private applyPieces(plan: ReadonlyMap<number, readonly NewObject[]>): number[] {
    const made: number[] = [];
    this.doc.objects = this.doc.objects.flatMap((o) => {
      const pieces = plan.get(o.id);
      if (!pieces) return [o];
      return pieces.map((p) => {
        const n = createObject(this.doc, p);
        this.noteVersion(n);
        made.push(n.id);
        return n;
      });
    });
    this.order = this.order.filter((id) => !plan.has(id));
    this.changed('base');
    return made;
  }

  /** Drops plan entries for locked objects. */
  private unlockedOnly(plan: Map<number, NewObject[]>): Map<number, NewObject[]> {
    for (const id of [...plan.keys()]) if (this.object(id)?.locked) plan.delete(id);
    return plan;
  }

  /**
   * Cut shapes (knife): cuts the selected objects, or with nothing selected every visible
   * object, along a line. The pieces are selected. Returns how many pieces were made.
   */
  cutWithLine(line: Point[]): number {
    const targets = (this.order.length ? this.selectedObjects() : this.doc.objects.filter((o) => o.visible)).filter((o) => !o.locked);
    const plan = new Map<number, NewObject[]>();
    for (const o of targets) {
      const pieces = cutObject(o, line);
      if (pieces) plan.set(o.id, pieces);
    }
    if (!plan.size) {
      this.setStatus('The line cuts nothing');
      return 0;
    }
    const made = this.applyPieces(plan);
    this.setSelection(made);
    this.commit('Cut shapes');
    this.setStatus(`Cut ${plan.size} object${plan.size === 1 ? '' : 's'} into ${made.length} pieces`);
    return made.length;
  }

  /** Knockout overlaps: the selected objects cut away the parts of earlier objects under them. */
  knockoutOverlaps(): number {
    const cutters = [...this.order];
    const plan = this.unlockedOnly(knockoutPlan(this.doc.objects, cutters));
    if (!plan.size) {
      this.setStatus('Nothing under the selection to knock out');
      return 0;
    }
    this.applyPieces(plan);
    this.setSelection(cutters);
    this.commit('Knockout overlaps');
    this.setStatus(`Knocked out ${plan.size} object${plan.size === 1 ? '' : 's'}`);
    return plan.size;
  }

  /** Partial applique: in the selected applique pieces, later fabrics cut earlier cover satins. */
  partialApplique(): number {
    const ids = new Set(this.withGroups(this.order));
    const plan = this.unlockedOnly(partialAppliquePlan(this.doc.objects.filter((o) => ids.has(o.id))));
    if (!plan.size) {
      this.setStatus('No earlier applique cover lies under a later fabric');
      return 0;
    }
    const made = this.applyPieces(plan);
    this.setSelection([...this.order, ...made]);
    this.commit('Partial applique');
    return plan.size;
  }

  /** Auto applique: each selected shape becomes a grouped placement, tack-down and cover. */
  autoApplique(opts: Partial<AppliqueOptions> = {}): number {
    const plan = new Map<number, NewObject[]>();
    for (const o of this.selectedObjects()) {
      if (o.locked) continue;
      const rings = regionRings(enclosedArea(o));
      if (!rings.length) continue;
      plan.set(o.id, appliquePieces(rings, { color: [...o.color], thread: o.thread, groupId: this.nextGroupId++ }, opts));
    }
    if (!plan.size) {
      this.setStatus('Select a closed shape for the applique');
      return 0;
    }
    const made = this.applyPieces(plan);
    this.setSelection(made);
    this.commit('Auto applique');
    return plan.size;
  }

  /** Laydown: a laydown object under the whole design, sewn first. */
  addLaydown(shape: LaydownShape = 'outline', offset = 2): number {
    const pieces = laydownObjects(this.doc.objects, shape, offset).map((p) => createObject(this.doc, p));
    if (!pieces.length) {
      this.setStatus('Nothing to lay down under');
      return 0;
    }
    pieces.forEach((p) => this.noteVersion(p));
    this.doc.objects = [...pieces, ...this.doc.objects];
    this.setSelection(pieces.map((p) => p.id));
    this.commit('Laydown');
    return pieces.length;
  }

  /** Weld: the union of the selected areas as new objects with the first selected object's settings. */
  weldSelection(): number {
    const sel = this.selectedObjects().filter((o) => !o.locked);
    if (sel.length < 2) return 0;
    const pieces = weldObjects(sel);
    if (!pieces.length) {
      this.setStatus('Nothing to weld (select areas, columns or closed shapes)');
      return 0;
    }
    // The welded objects take the place of the earliest selected one.
    const ids = new Set(sel.map((o) => o.id));
    const first = this.doc.objects.find((o) => ids.has(o.id))!;
    const plan = new Map<number, NewObject[]>(sel.map((o) => [o.id, o === first ? pieces : []]));
    const made = this.applyPieces(plan);
    this.setSelection(made);
    this.commit('Weld');
    return made.length;
  }

  /** Fill holes: each hole of the selected objects becomes a new object (same settings) right after it. */
  fillHoles(margin = 0.3): number {
    const made: number[] = [];
    this.doc.objects = this.doc.objects.flatMap((o) => {
      if (!this.order.includes(o.id) || !o.holes.length || o.locked) return [o];
      const fills = fillHoleObjects(o, margin).map((p) => createObject(this.doc, p));
      fills.forEach((f) => {
        this.noteVersion(f);
        made.push(f.id);
      });
      return [o, ...fills];
    });
    if (!made.length) {
      this.setStatus('The selection has no holes');
      return 0;
    }
    this.setSelection(made);
    this.commit('Fill holes');
    return made.length;
  }

  // ---- sequencing by colour ----

  /** Back (-1) or forward (+1) one colour block. */
  moveByColour(dir: 1 | -1): void {
    const ids = this.withGroups(this.order);
    if (!ids.length) return;
    this.doc.objects = moveByColourBlock(this.doc.objects, ids, dir);
    this.commit(dir < 0 ? 'Back 1 colour' : 'Forward 1 colour');
  }

  sequenceByColour(): void {
    this.doc.objects = sequenceByColour(this.doc.objects);
    this.commit('Sequence by colour');
  }

  /** Optimize colour changes: objects join earlier runs of their colour where nothing in between overlaps. */
  optimizeColourChanges(): void {
    const before = this.doc.objects;
    this.doc.objects = optimizeColourChanges(before, (o) => this.shapes.get(o).box);
    this.commit('Optimize colour changes');
  }

  // ---- reshape ----

  /** Inserts a node where the outline passes nearest p (on the segment between two nodes). */
  insertNode(id: number, p: Point): boolean {
    const o = this.object(id);
    if (!o || o.locked || o.points.length < 2) return false;
    const n = o.points.length;
    const segs = o.closed ? n : n - 1;
    let best = { i: -1, d: Infinity };
    for (let i = 0; i < segs; i++) {
      const a = o.points[i]!;
      const b = o.points[(i + 1) % n]!;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len2 = dx * dx + dy * dy;
      const t = len2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a.x) * dx + (p[1] - a.y) * dy) / len2)) : 0;
      const d = Math.hypot(a.x + dx * t - p[0], a.y + dy * t - p[1]);
      if (d < best.d) best = { i, d };
    }
    if (best.i < 0) return false;
    const a = o.points[best.i]!;
    const b = o.points[(best.i + 1) % n]!;
    const type = a.type === 'curve' && b.type === 'curve' ? 'curve' : 'corner';
    const points = [...o.points.slice(0, best.i + 1), pathNode(p[0], p[1], type), ...o.points.slice(best.i + 1)];
    this.replace({ ...o, points });
    this.commit('Insert node');
    return true;
  }

  /** Deletes a node (keeping at least 2 nodes, 3 for closed shapes). */
  deleteNode(id: number, index: number): boolean {
    const o = this.object(id);
    if (!o || o.locked) return false;
    const onRail1 = index < o.points.length;
    const list = onRail1 ? o.points : o.rail2;
    const i = onRail1 ? index : index - o.points.length;
    if (list.length <= (o.closed && onRail1 ? 3 : 2) || !list[i]) return false;
    const next = list.filter((_, j) => j !== i);
    this.replace(onRail1 ? { ...o, points: next } : { ...o, rail2: next });
    this.commit('Delete node');
    return true;
  }

  // ---- lettering ----

  /** The text a piece belongs to (its textId), or null. */
  textIdOf(o: StitchObject | undefined): number | null {
    return o ? (letterMeta(o)?.textId ?? null) : null;
  }

  /** The text of the selection (the first selected lettering piece). */
  selectedTextId(): number | null {
    for (const o of this.selectedObjects()) {
      const id = this.textIdOf(o);
      if (id !== null) return id;
    }
    return null;
  }

  textPieces(textId: number): StitchObject[] {
    return this.doc.objects.filter((o) => this.textIdOf(o) === textId);
  }

  textSpec(textId: number): TextSpec | null {
    const o = this.textPieces(textId)[0];
    return o ? structuredClone(letterMeta(o)!.spec) : null;
  }

  /** Lays out and plans a text, giving each piece a fresh id; the pieces are grouped. */
  private buildTextObjects(spec: TextSpec, textId: number): StitchObject[] {
    const font = this.fonts.get(spec.font);
    if (!font) throw new Error(`The font "${spec.font}" is not loaded`);
    const opts = { trimThreshold: this.doc.trimThreshold, joinDistance: this.doc.joinDistance };
    return buildText(spec, font, textId, opts).map((p) => createObject(this.doc, { ...p, groupId: textId }));
  }

  /** Adds lettering (one undo step); returns its textId. */
  addText(spec: TextSpec): number {
    const textId = allocateId(this.doc);
    this.nextGroupId = Math.max(this.nextGroupId, textId + 1);
    const objs = this.buildTextObjects(spec, textId);
    for (const o of objs) this.addObject(o);
    this.setSelection(objs.map((o) => o.id));
    this.commit('Add text');
    this.setStatus(`Added "${spec.text}" (${objs.length} piece${objs.length === 1 ? '' : 's'})`);
    return textId;
  }

  /**
   * Rebuilds a text from a new spec in the same place in the sewing order. If the pieces were
   * moved since they were built, the text keeps that move.
   */
  editText(textId: number, spec: TextSpec, label = 'Edit text'): void {
    const old = this.textPieces(textId);
    if (!old.length) return;
    const oldSpec = letterMeta(old[0]!)!.spec;
    const next = structuredClone(spec);
    if (oldSpec.baseline !== 'custom') {
      const font = this.fonts.get(oldSpec.font);
      if (font) {
        const was = layoutText(oldSpec, font, textId).pieces.flatMap((p) => (p.points ?? []).map((n): Point => [n.x, n.y]));
        const now = old.flatMap((o) => o.points.map((n): Point => [n.x, n.y]));
        if (was.length && now.length) {
          const centre = (pts: Point[]) => {
            const xs = pts.map((p) => p[0]);
            const ys = pts.map((p) => p[1]);
            return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
          };
          const [ax, ay] = centre(was);
          const [bx, by] = centre(now);
          if (oldSpec.position[0] === spec.position[0] && oldSpec.position[1] === spec.position[1]) {
            next.position = [spec.position[0] + bx! - ax!, spec.position[1] + by! - ay!];
          }
        }
      }
    }
    const at = this.doc.objects.indexOf(old[0]!);
    const objs = this.buildTextObjects(next, textId);
    this.removeObjects(old.map((o) => o.id));
    this.doc.objects.splice(Math.min(at, this.doc.objects.length), 0, ...objs);
    for (const o of objs) this.noteVersion(o);
    this.setSelection(objs.map((o) => o.id));
    this.commit(label);
  }

  /** Letters mode: the letter being adjusted. */
  activeLetter: { textId: number; letter: number } | null = null;

  /** Changes one letter's adjustment (Letters mode); the others never move. */
  adjustLetter(textId: number, letter: number, change: (a: LetterAdjust) => LetterAdjust | null): void {
    const spec = this.textSpec(textId);
    if (!spec) return;
    const current = { ...DEFAULT_LETTER, ...(spec.letters[letter] ?? {}) };
    const next = change(current);
    if (next) spec.letters[letter] = next;
    else delete spec.letters[letter];
    this.editText(textId, spec, 'Adjust letter');
    this.activeLetter = { textId, letter };
  }

  /** Number of letters in a text (spaces and line breaks not counted). */
  letterCount(textId: number): number {
    const spec = this.textSpec(textId);
    return spec ? [...spec.text].filter((c) => c !== ' ' && c !== '\n' && c !== '\r').length : 0;
  }

  // ---- properties ----

  /** Changes fields of the selected objects (commitSoon while typing). */
  updateSelected(patch: Partial<Omit<StitchObject, 'id' | 'version' | 'settings'>>, soon = false): void {
    const sel = this.selectedObjects();
    if (!sel.length) return;
    for (const o of sel) this.replace({ ...o, ...patch });
    if (soon) this.commitSoon('Properties');
    else this.commit('Properties');
  }

  /** Changes stitch settings of the selected objects (commitSoon while typing). */
  updateSelectedSettings(patch: Partial<StitchSettings>, soon = false): void {
    const sel = this.selectedObjects();
    if (!sel.length) return;
    for (const o of sel) this.replace({ ...o, settings: { ...o.settings, ...patch } });
    if (soon) this.commitSoon('Properties');
    else this.commit('Properties');
  }

  // ---- colour ----

  /** Makes a colour current and gives it to the selected objects. */
  useColour(color: RGB, thread: ThreadRef | null = null): void {
    this.currentColor = [...color];
    const sel = this.selectedObjects();
    if (sel.length) {
      for (const o of sel) this.replace({ ...o, color: [...color], thread });
      this.commit('Colour');
    } else this.changed('state');
  }

  addPaletteSlot(color: RGB, thread: ThreadRef | null = null): void {
    this.doc.palette = [...this.doc.palette, { color: [...color], thread }];
    this.commit('Add colour');
  }

  /** Editing a slot recolours every object that used its colour. */
  setPaletteSlot(index: number, slot: PaletteSlot): void {
    const old = this.doc.palette[index];
    if (!old) return;
    this.doc.palette = this.doc.palette.map((s, i) => (i === index ? { color: [...slot.color], thread: slot.thread } : s));
    for (const o of this.doc.objects) if (sameColor(o.color, old.color)) this.replace({ ...o, color: [...slot.color], thread: slot.thread });
    if (sameColor(this.currentColor, old.color)) this.currentColor = [...slot.color];
    this.commit('Edit colour');
  }

  /** Makes a colour current, picking the palette slot that has it or adding one. */
  useOrAddColour(color: RGB, thread: ThreadRef | null = null): void {
    const slot = this.doc.palette.find((s) => sameColor(s.color, color));
    if (!slot) {
      this.doc.palette = [...this.doc.palette, { color: [...color], thread }];
      this.commit('Add colour');
    }
    this.useColour(color, slot?.thread ?? thread);
  }

  /**
   * Adds a tracing picture (an image data URL of pxWidth x pxHeight pixels) centred in the
   * hoop at 96 pixels per inch, shrunk to fit the hoop. Returns its id.
   */
  addArtwork(name: string, src: string, pxWidth: number, pxHeight: number): number {
    const mmPerPx = 25.4 / 96;
    const fit = Math.min(1, this.doc.hoopWidth / (pxWidth * mmPerPx), this.doc.hoopHeight / (pxHeight * mmPerPx));
    const width = pxWidth * mmPerPx * fit;
    const height = pxHeight * mmPerPx * fit;
    const id = this.doc.artwork.reduce((m, a) => Math.max(m, a.id), 0) + 1;
    this.doc.artwork = [...this.doc.artwork, { id, name, src, x: -width / 2, y: -height / 2, width, height, opacity: 0.5, visible: true, locked: false }];
    this.commit('Import artwork');
    return id;
  }

  /** Changes a picture's placement, opacity, lock or visibility. */
  updateArtwork(id: number, patch: Partial<Omit<Artwork, 'id' | 'src'>>): void {
    const i = this.doc.artwork.findIndex((a) => a.id === id);
    if (i < 0) return;
    this.doc.artwork = this.doc.artwork.map((a) => (a.id === id ? { ...a, ...patch } : a));
    this.commit('Artwork');
  }

  removeArtwork(id: number): void {
    if (!this.doc.artwork.some((a) => a.id === id)) return;
    this.doc.artwork = this.doc.artwork.filter((a) => a.id !== id);
    this.artworkPixels.delete(id);
    this.commit('Remove artwork');
  }

  /** Adds new objects at the end of the sequence and selects them (imports). Returns their ids. */
  insertObjects(news: readonly NewObject[], label: string): number[] {
    const made = news.map((n) => this.addObject(createObject(this.doc, n)).id);
    if (made.length) {
      this.setSelection(made);
      this.commit(label);
    }
    return made;
  }

  setArtworkPixels(id: number, pixels: ArtworkPixels | null): void {
    if (pixels) this.artworkPixels.set(id, pixels);
    else this.artworkPixels.delete(id);
  }

  /**
   * The average colour of a 5 x 5 pixel area of the topmost visible picture under a design
   * point, or null when there is no (decoded) picture there.
   */
  artworkColourAt(p: Point): RGB | null {
    for (let i = this.doc.artwork.length - 1; i >= 0; i--) {
      const a = this.doc.artwork[i]!;
      if (!a.visible || p[0] < a.x || p[1] < a.y || p[0] > a.x + a.width || p[1] > a.y + a.height) continue;
      const px = this.artworkPixels.get(a.id);
      if (!px || a.width <= 0 || a.height <= 0) continue;
      const cx = Math.floor(((p[0] - a.x) / a.width) * px.width);
      const cy = Math.floor(((p[1] - a.y) / a.height) * px.height);
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let y = cy - 2; y <= cy + 2; y++) {
        for (let x = cx - 2; x <= cx + 2; x++) {
          if (x < 0 || y < 0 || x >= px.width || y >= px.height) continue;
          const k = (y * px.width + x) * 4;
          r += px.data[k]!;
          g += px.data[k + 1]!;
          b += px.data[k + 2]!;
          n++;
        }
      }
      if (!n) continue;
      return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
    }
    return null;
  }

  /**
   * Gives every palette colour (and its objects) the nearest thread of a chart (CIEDE2000), as
   * one undo step. Reports the worst ΔE in the status when it is above 5.
   */
  matchColoursToChart(chart: string, threads: readonly Thread[]): ChartMatchReport {
    let worst = 0;
    let poor = 0;
    const palette = this.doc.palette.map((slot) => {
      const m = nearestThread(slot.color, threads);
      if (!m) return slot;
      worst = Math.max(worst, m.deltaE);
      if (m.deltaE > POOR_MATCH_DELTA_E) poor++;
      const next = { color: [...m.thread.rgb] as RGB, thread: { chart, code: m.thread.code, name: m.thread.name } };
      for (const o of this.doc.objects) if (sameColor(o.color, slot.color)) this.replace({ ...o, color: [...next.color], thread: next.thread });
      if (sameColor(this.currentColor, slot.color)) this.currentColor = [...next.color];
      return next;
    });
    this.doc.palette = palette;
    this.doc.threadChart = chart;
    this.commit(`Match to ${chart}`);
    this.setStatus(
      worst > POOR_MATCH_DELTA_E
        ? `Matched to ${chart}: ${poor} colour${poor === 1 ? '' : 's'} not close (worst ΔE ${worst.toFixed(1)})`
        : `Matched to ${chart} (worst ΔE ${worst.toFixed(1)})`,
    );
    return { worst, poor };
  }

  /** Whether every stitch of the visible design lies inside the hoop's sewing field. */
  hoopFits(): boolean {
    const d = this.doc;
    const pts = d.objects.filter((o) => o.visible).flatMap((o) => this.stitches(o));
    return fitsHoop(pts, d.hoopWidth, d.hoopHeight, d.hoopShape, d.hoopCorner);
  }

  /** Removes a palette slot (not while an object still uses it). */
  removePaletteSlot(index: number): boolean {
    const slot = this.doc.palette[index];
    if (!slot || this.isColourUsed(slot.color)) return false;
    this.doc.palette = this.doc.palette.filter((_, i) => i !== index);
    this.commit('Remove colour');
    return true;
  }

  isColourUsed(color: RGB): boolean {
    return this.doc.objects.some((o) => sameColor(o.color, color));
  }

  removeUnusedColours(): void {
    const before = this.doc.palette.length;
    this.doc.palette = this.doc.palette.filter((s) => this.isColourUsed(s.color));
    if (this.doc.palette.length !== before) this.commit('Remove unused colours');
  }

  // ---- stitch player ----

  /** All visible objects in sewing order, with where their stitches start in the whole sequence. */
  sewingOrder(): { object: StitchObject; start: number; count: number }[] {
    let start = 0;
    return this.doc.objects
      .filter((o) => o.visible)
      .map((o) => {
        const count = this.stitchCount(o);
        const entry = { object: o, start, count };
        start += count;
        return entry;
      });
  }

  playerSeek(index: number): void {
    this.player.index = Math.max(0, Math.min(this.totalStitches(), Math.round(index)));
    this.changed('base');
  }

  playerStep(n: number): void {
    this.playerSeek((this.player.index ?? this.totalStitches()) + n);
  }

  /** Object-by-object: to the end of the current object (+1) or the start of the previous one (-1). */
  playerStepObject(dir: 1 | -1): void {
    const order = this.sewingOrder();
    const at = this.player.index ?? this.totalStitches();
    if (dir > 0) {
      const next = order.find((e) => e.start + e.count > at);
      this.playerSeek(next ? next.start + next.count : this.totalStitches());
    } else {
      const prev = [...order].reverse().find((e) => e.start < at);
      this.playerSeek(prev ? prev.start : 0);
    }
  }

  playerPlay(): void {
    if (this.player.index === null || this.player.index >= this.totalStitches()) this.player.index = 0;
    this.player.playing = true;
    const fps = 30;
    if (this.playTimer) clearInterval(this.playTimer);
    this.playTimer = setInterval(() => {
      const total = this.totalStitches();
      const next = (this.player.index ?? 0) + Math.max(1, Math.round(this.player.speed / fps));
      if (next >= total) {
        this.player.index = total;
        this.playerPause();
      } else this.player.index = next;
      this.changed('base');
    }, 1000 / fps);
    this.changed('base');
  }

  playerPause(): void {
    this.player.playing = false;
    if (this.playTimer) clearInterval(this.playTimer);
    this.playTimer = null;
    this.changed('state');
  }

  playerToggle(): void {
    if (this.player.playing) this.playerPause();
    else this.playerPlay();
  }

  playerStop(): void {
    this.playerPause();
    this.player.index = null;
    this.changed('base');
  }

  setPlayerSpeed(stitchesPerSecond: number): void {
    this.player.speed = Math.max(10, stitchesPerSecond);
    this.changed('state');
  }

  dispose(): void {
    this.playerPause();
    this.cancelCommitSoon();
    this.listeners.clear();
    this.actionListeners.clear();
  }
}
