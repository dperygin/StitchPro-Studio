// Tools: how pointer and key input becomes edits. Each tool works on the Editor's public API.

import { formatLength } from './units';
import { DOUBLE_CLICK_MS, DRAG_THRESHOLD_PX, NODE_PICK_PX, NODE_WIDTH_STEP_MM, OBJECT_PICK_PX, RULER_PX } from './constants';
import { handleAt, handleTransform, type HandleKind } from './handles';
import { objectsInBox, pickNode, type Box } from './hittest';
import { naturalAspect, pathNode, standardShape, transformObject, translateObject, type LetterAdjust, type PathNode, type Point, type StitchObject } from '@stitchpro/engine';
import type { Editor, KeyInput, PointerInput } from './editor';

export type ToolName = 'select' | 'draw' | 'shape' | 'polygon' | 'reshape' | 'stitches' | 'pick' | 'angle' | 'measure' | 'cut' | 'letters';

/** What a tool wants drawn on the overlay (in design mm). */
export interface ToolOverlay {
  /** A rubber-band or measured line. */
  line?: [Point, Point];
  /** A selection box being dragged. */
  box?: Box;
  /** Nodes of a shape being digitized. */
  nodes?: PathNode[];
  /** Where the next node would go. */
  cursor?: Point;
  /** Rail 1 of a two-rail satin, while rail 2 is being digitized. */
  rail?: PathNode[];
  /** Draw `nodes` as a closed outline. */
  closed?: boolean;
}

export interface Tool {
  readonly name: ToolName;
  pointerDown(e: PointerInput): void;
  pointerMove(e: PointerInput): void;
  pointerUp(e: PointerInput): void;
  /** True when handled. */
  keyDown(e: KeyInput): boolean;
  /** Abandons whatever is in progress. */
  cancel(): void;
  overlay(): ToolOverlay;
}

abstract class BaseTool implements Tool {
  abstract readonly name: ToolName;
  constructor(protected readonly editor: Editor) {}
  pointerDown(_e: PointerInput): void {}
  pointerMove(_e: PointerInput): void {}
  pointerUp(_e: PointerInput): void {}
  keyDown(_e: KeyInput): boolean {
    return false;
  }
  cancel(): void {}
  overlay(): ToolOverlay {
    return {};
  }
}

/** True once a press has moved far enough (in screen pixels) to count as a drag. */
export const isDrag = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(b.x - a.x, b.y - a.y) > DRAG_THRESHOLD_PX;

/** Remembers a press and the objects as they were, for drags that may be cancelled. */
interface Press {
  at: PointerInput;
  start: Point;
  dragging: boolean;
}

// ---- select ----

type SelectPress =
  | { mode: 'move' | 'box'; at: PointerInput; start: Point; dragging: boolean; originals: StitchObject[]; wasSelected: boolean }
  | { mode: 'handle'; kind: HandleKind; at: PointerInput; start: Point; dragging: boolean; originals: StitchObject[]; box: Box }
  | { mode: 'guide'; at: PointerInput; start: Point; dragging: boolean; index: number; axis: 'h' | 'v'; created: boolean };

class SelectTool extends BaseTool {
  readonly name = 'select';
  private press: SelectPress | null = null;
  private current: Point | null = null;

  override pointerDown(e: PointerInput): void {
    if (e.button !== undefined && e.button !== 0) return;
    const ed = this.editor;
    const start = ed.toDesign(e);
    this.current = start;

    // Guides: drag a new one out of a ruler, or grab an existing one.
    if (ed.showRulers && (e.y < RULER_PX || e.x < RULER_PX)) {
      const axis = e.y < RULER_PX ? 'h' : 'v';
      const index = ed.addGuide(axis, axis === 'h' ? start[1] : start[0]);
      this.press = { mode: 'guide', at: e, start, dragging: true, index, axis, created: true };
      return;
    }
    const tol = ed.pxToMm(4);
    const g = ed.doc.guides.findIndex((x) => Math.abs((x.axis === 'h' ? start[1] : start[0]) - x.pos) <= tol);
    if (g >= 0 && !ed.objectAt(e)) {
      const guide = ed.doc.guides[g]!;
      this.press = { mode: 'guide', at: e, start, dragging: false, index: g, axis: guide.axis, created: false };
      return;
    }

    // Selection handles.
    const handle = handleAt(ed, e);
    if (handle) {
      const originals = ed.selectedObjects().filter((o) => !o.locked);
      this.press = { mode: 'handle', kind: handle.kind, at: e, start, dragging: false, originals, box: ed.selectionBox(originals)! };
      return;
    }

    const hit = ed.objectAt(e);
    const wasSelected = !!hit && ed.isSelected(hit.id);
    if (hit) {
      if (e.ctrl || e.shift) ed.toggleSelected(hit.id);
      else if (!wasSelected) {
        ed.select(hit.id);
        ed.setHandleMode('scale');
      }
    }
    const mode = hit && ed.isSelected(hit.id) ? 'move' : 'box';
    this.press = { mode, at: e, start, dragging: false, wasSelected, originals: mode === 'move' ? ed.selectedObjects().filter((o) => !o.locked) : [] };
  }

  override pointerMove(e: PointerInput): void {
    const p = this.press;
    if (!p) return;
    const ed = this.editor;
    if (!p.dragging) {
      if (!isDrag(p.at, e)) return;
      p.dragging = true;
      if (p.mode === 'move' || p.mode === 'handle') ed.beginLive(p.originals.map((o) => o.id));
    }
    this.current = ed.toDesign(e);
    if (p.mode === 'guide') {
      const pos = p.axis === 'h' ? this.current[1] : this.current[0];
      ed.moveGuide(p.index, pos);
    } else if (p.mode === 'move') {
      const dx = this.current[0] - p.start[0];
      const dy = this.current[1] - p.start[1];
      for (const o of p.originals) ed.replace(translateObject(o, dx, dy));
    } else if (p.mode === 'handle') {
      const { m } = handleTransform(p.kind, p.box, p.start, this.current, !!e.shift);
      for (const o of p.originals) ed.replace(transformObject(o, m));
    }
  }

  override pointerUp(e: PointerInput): void {
    const p = this.press;
    if (!p) return;
    const ed = this.editor;
    this.press = null;
    this.current = null;
    if (p.mode === 'guide') {
      // Dropped back on a ruler: the guide goes away.
      const onRuler = p.axis === 'h' ? e.y < RULER_PX : e.x < RULER_PX;
      if (onRuler) ed.removeGuide(p.index);
      if (p.dragging || p.created) ed.commit(onRuler ? 'Remove guide' : 'Guide');
      return;
    }
    if (p.mode === 'handle') {
      if (p.dragging) {
        const { label } = handleTransform(p.kind, p.box, p.start, ed.toDesign(e), !!e.shift);
        ed.endLive();
        ed.commit(label);
      } else if (p.kind === 'move') {
        // A click (no drag) on the middle of the selection switches resize / rotate handles.
        ed.setHandleMode(ed.handleMode === 'scale' ? 'rotate' : 'scale');
      }
      return;
    }
    if (p.dragging && p.mode === 'move') {
      ed.endLive();
      ed.commit('Move');
    } else if (p.dragging && p.mode === 'box') {
      const box = this.boxFrom(p.start, ed.toDesign(e));
      const inside = objectsInBox(ed.doc, ed.shapes, box).map((o) => o.id);
      ed.setSelection(e.ctrl || e.shift ? [...ed.selectionOrder, ...inside] : inside);
    } else if (p.mode === 'move' && p.wasSelected && !e.ctrl && !e.shift) {
      // Clicking the selection again switches between resize and rotate/skew handles.
      ed.setHandleMode(ed.handleMode === 'scale' ? 'rotate' : 'scale');
    } else if (!ed.objectAt(e) && !e.ctrl && !e.shift) {
      ed.clearSelection();
    }
    ed.changed('overlay');
  }

  override keyDown(e: KeyInput): boolean {
    if (e.key === 'Escape' && this.press) {
      this.cancel();
      return true;
    }
    return false;
  }

  override cancel(): void {
    const p = this.press;
    this.press = null;
    if (!p) return;
    if ((p.mode === 'move' || p.mode === 'handle') && p.dragging) {
      for (const o of p.originals) this.editor.replace(o);
      this.editor.endLive();
    }
    if (p.mode === 'guide' && p.created) this.editor.removeGuide(p.index);
  }

  private boxFrom(a: Point, b: Point): Box {
    return { minX: Math.min(a[0], b[0]), minY: Math.min(a[1], b[1]), maxX: Math.max(a[0], b[0]), maxY: Math.max(a[1], b[1]) };
  }

  override overlay(): ToolOverlay {
    const p = this.press;
    if (p?.dragging && p.mode === 'box' && this.current) return { box: this.boxFrom(p.start, this.current) };
    return {};
  }
}

// ---- draw ----

class DrawTool extends BaseTool {
  readonly name = 'draw';
  private nodes: PathNode[] = [];
  private last: PointerInput | null = null;
  /** Two-rail satin / Column: rail 1, kept while rail 2 is digitized. */
  private rail1: PathNode[] | null = null;
  private cursor: Point | null = null;

  override pointerDown(e: PointerInput): void {
    const ed = this.editor;
    const prev = this.last;
    this.last = e;
    // Double click finishes (without adding a node).
    if (prev && e.time !== undefined && prev.time !== undefined && e.time - prev.time <= DOUBLE_CLICK_MS && Math.hypot(e.x - prev.x, e.y - prev.y) <= NODE_PICK_PX) {
      this.last = null;
      this.finish(ed.drawMode.closed);
      return;
    }
    if (e.button === 1) return;
    const [x, y] = this.place(e);
    this.nodes.push(pathNode(x, y, e.button === 2 ? 'curve' : 'corner'));
    ed.setStatus(`${this.nodes.length} node${this.nodes.length === 1 ? '' : 's'} - Enter or double click to finish, Esc to cancel`);
    ed.changed('overlay');
  }

  override keyDown(e: KeyInput): boolean {
    const ed = this.editor;
    if (e.key === 'Enter') {
      this.finish(e.shift ? !ed.drawMode.closed : ed.drawMode.closed);
      return true;
    }
    if (e.key === 'Escape') {
      if (!this.nodes.length) return false;
      this.cancel();
      ed.setStatus('Cancelled');
      return true;
    }
    if (e.key === 'Backspace' && this.nodes.length) {
      this.nodes.pop();
      ed.changed('overlay');
      return true;
    }
    if (e.key === ' ' && this.nodes.length) {
      const n = this.nodes[this.nodes.length - 1]!;
      n.type = n.type === 'corner' ? 'curve' : 'corner';
      ed.changed('overlay');
      return true;
    }
    return false;
  }

  /**
   * Where a click puts the next node: Ctrl constrains the line from the previous node to
   * 15 degree steps; otherwise the point snaps to guides and the grid (Alt holds it free).
   */
  private place(e: PointerInput): Point {
    const ed = this.editor;
    const p = ed.toDesign(e);
    const prev = this.nodes[this.nodes.length - 1];
    if (e.ctrl && prev) {
      const dx = p[0] - prev.x;
      const dy = p[1] - prev.y;
      const len = Math.hypot(dx, dy);
      const a = (Math.round((Math.atan2(dy, dx) * 180) / Math.PI / 15) * 15 * Math.PI) / 180;
      return [prev.x + len * Math.cos(a), prev.y + len * Math.sin(a)];
    }
    return ed.snapPoint(p, e);
  }

  override pointerMove(e: PointerInput): void {
    this.cursor = this.nodes.length ? this.place(e) : this.editor.snapPoint(this.editor.toDesign(e), e);
  }

  /** Finishes the shape being digitized (closed or open). */
  finish(closed: boolean): StitchObject | null {
    const ed = this.editor;
    const nodes = this.nodes;
    this.nodes = [];
    const mode = ed.drawMode;
    if (mode.stitchType === 'radial_satin' && !mode.hole) return this.finishRail(nodes);
    if (mode.hole) return this.finishHole(nodes);
    if (nodes.length < (closed ? 3 : 2)) {
      ed.setStatus(closed ? 'A closed shape needs at least 3 nodes' : 'A line needs at least 2 nodes');
      ed.changed('overlay');
      return null;
    }
    const o = ed.addObject(ed.newObject({ points: nodes, closed }));
    ed.select(o.id);
    ed.commit('Draw');
    ed.setStatus(`Added ${o.name}`);
    return o;
  }

  /** Two-rail satin and Column: the first Enter ends rail 1, the second makes the object. */
  private finishRail(nodes: PathNode[]): StitchObject | null {
    const ed = this.editor;
    if (nodes.length < 2) {
      ed.setStatus('A rail needs at least 2 nodes');
      return null;
    }
    if (!this.rail1) {
      this.rail1 = nodes;
      ed.setStatus(`Now digitize rail 2${ed.drawMode.paired ? ' (one node per rail-1 node)' : ''}, then Enter`);
      ed.changed('overlay');
      return null;
    }
    const o = ed.addObject(ed.newObject({ points: this.rail1, rail2: nodes, closed: false }));
    this.rail1 = null;
    ed.select(o.id);
    ed.commit('Draw');
    ed.setStatus(`Added ${o.name}`);
    return o;
  }

  /** Add hole: the closed shape becomes a hole of the selected area. */
  private finishHole(nodes: PathNode[]): StitchObject | null {
    const ed = this.editor;
    const target = ed.selectedObjects().find((o) => o.closed);
    if (!target || nodes.length < 3) {
      ed.setStatus(target ? 'A hole needs at least 3 nodes' : 'Select a closed shape first');
      return null;
    }
    const o = ed.replace({ ...target, holes: [...target.holes, nodes] });
    ed.commit('Add hole');
    ed.drawMode = { ...ed.drawMode, hole: false };
    ed.setTool('select');
    ed.setStatus(`Added a hole to ${o.name}`);
    return o;
  }

  override cancel(): void {
    this.nodes = [];
    this.rail1 = null;
    this.last = null;
    this.editor.changed('overlay');
  }

  override overlay(): ToolOverlay {
    return { nodes: this.nodes, cursor: this.cursor ?? this.editor.pointer ?? undefined, rail: this.rail1 ?? undefined };
  }
}

// ---- standard shapes: drag a box ----

class ShapeTool extends BaseTool {
  readonly name = 'shape';
  private start: Point | null = null;
  private end: Point | null = null;
  private square = false;

  override pointerDown(e: PointerInput): void {
    if (e.button !== undefined && e.button !== 0) return;
    this.start = this.editor.snapPoint(this.editor.toDesign(e), e);
    this.end = this.start;
  }

  override pointerMove(e: PointerInput): void {
    if (!this.start) return;
    this.end = this.editor.snapPoint(this.editor.toDesign(e), e);
    this.square = !!e.ctrl;
  }

  override pointerUp(e: PointerInput): void {
    const ed = this.editor;
    const a = this.start;
    if (!a) return;
    this.end = ed.snapPoint(ed.toDesign(e), e);
    this.square = !!e.ctrl;
    const box = this.box()!;
    this.start = null;
    if (Math.abs(box.x1 - box.x0) < 0.5 || Math.abs(box.y1 - box.y0) < 0.5) return;
    const closedType = ed.drawMode.closed ? ed.drawMode.stitchType : 'running';
    const o = ed.addObject(ed.newObject({ points: standardShape(ed.shapeKind, box), closed: true, stitchType: closedType }));
    ed.select(o.id);
    ed.commit('Shape');
    ed.setStatus(`Added ${o.name}`);
  }

  /** The dragged box (Ctrl keeps the shape's proportions). */
  private box(): { x0: number; y0: number; x1: number; y1: number } | null {
    if (!this.start || !this.end) return null;
    const [x0, y0] = this.start;
    let [x1, y1] = this.end;
    if (this.square) {
      // Ctrl: the shape's natural proportions (a circle stays round, a hexagon regular).
      const aspect = naturalAspect(this.editor.shapeKind);
      const h = Math.max(Math.abs(y1 - y0), Math.abs(x1 - x0) / aspect);
      x1 = x0 + Math.sign(x1 - x0 || 1) * h * aspect;
      y1 = y0 + Math.sign(y1 - y0 || 1) * h;
    }
    return { x0, y0, x1, y1 };
  }

  override cancel(): void {
    this.start = null;
  }

  override overlay(): ToolOverlay {
    const b = this.box();
    if (!b) return {};
    return { nodes: standardShape(this.editor.shapeKind, b), closed: true };
  }
}

// ---- polygon select ----

class PolygonTool extends BaseTool {
  readonly name = 'polygon';
  private points: Point[] = [];
  private last: PointerInput | null = null;
  private additive = false;

  override pointerDown(e: PointerInput): void {
    const prev = this.last;
    this.last = e;
    if (prev && e.time !== undefined && prev.time !== undefined && e.time - prev.time <= DOUBLE_CLICK_MS && Math.hypot(e.x - prev.x, e.y - prev.y) <= NODE_PICK_PX) {
      this.finish();
      return;
    }
    this.additive = this.additive || !!e.ctrl || !!e.shift;
    this.points.push(this.editor.toDesign(e));
    this.editor.setStatus('Click round the objects; Enter or double click selects');
  }

  override keyDown(e: KeyInput): boolean {
    if (e.key === 'Enter') {
      this.finish();
      return true;
    }
    if (e.key === 'Escape' && this.points.length) {
      this.cancel();
      return true;
    }
    if (e.key === 'Backspace' && this.points.length) {
      this.points.pop();
      this.editor.changed('overlay');
      return true;
    }
    return false;
  }

  private finish(): void {
    const pts = this.points;
    const add = this.additive;
    this.cancel();
    if (pts.length >= 3) this.editor.polygonSelect(pts, add);
  }

  override cancel(): void {
    this.points = [];
    this.last = null;
    this.additive = false;
    this.editor.changed('overlay');
  }

  override overlay(): ToolOverlay {
    return { nodes: this.points.map(([x, y]) => pathNode(x, y)), cursor: this.editor.pointer ?? undefined };
  }
}

// ---- reshape: drag nodes ----

class ReshapeTool extends BaseTool {
  readonly name = 'reshape';
  private drag: { object: StitchObject; node: number; at: PointerInput; start: Point; dragging: boolean } | null = null;
  /** The last node clicked: Space toggles its type, [ and ] change its width, Delete removes it. */
  active: { id: number; node: number } | null = null;
  private lastClick: PointerInput | null = null;

  override pointerDown(e: PointerInput): void {
    const ed = this.editor;
    const p = ed.toDesign(e);
    // Double click on a selected outline (not on a node): insert a node there.
    const prev = this.lastClick;
    this.lastClick = e;
    const double = prev && e.time !== undefined && prev.time !== undefined && e.time - prev.time <= DOUBLE_CLICK_MS && Math.hypot(e.x - prev.x, e.y - prev.y) <= NODE_PICK_PX;
    if (double) {
      const target = ed.selectedObjects().find((o) => pickNode(o, p, ed.pxToMm(NODE_PICK_PX)) < 0 && ed.objectAt(e)?.id === o.id);
      if (target && ed.insertNode(target.id, p)) {
        this.lastClick = null;
        return;
      }
    }
    for (const o of ed.selectedObjects()) {
      const node = pickNode(o, p, ed.pxToMm(NODE_PICK_PX));
      if (node >= 0 && !o.locked) {
        this.drag = { object: o, node, at: e, start: p, dragging: false };
        this.active = { id: o.id, node };
        return;
      }
    }
    const hit = ed.objectAt(e);
    if (hit) ed.select(hit.id);
  }

  override pointerMove(e: PointerInput): void {
    const d = this.drag;
    if (!d) return;
    const ed = this.editor;
    if (!d.dragging) {
      if (!isDrag(d.at, e)) return;
      d.dragging = true;
      ed.beginLive([d.object.id]);
    }
    const [x, y] = ed.toDesign(e);
    const o = d.object;
    const n = o.points.length;
    const points = o.points.map((nd, i) => (i === d.node ? { ...nd, x, y } : nd));
    const rail2 = o.rail2.map((nd, i) => (i + n === d.node ? { ...nd, x, y } : nd));
    ed.replace({ ...o, points, rail2 });
  }

  override pointerUp(): void {
    const d = this.drag;
    this.drag = null;
    if (d?.dragging) {
      this.editor.endLive();
      this.editor.commit('Reshape');
    }
  }

  override keyDown(e: KeyInput): boolean {
    const ed = this.editor;
    const a = this.active;
    const o = a ? ed.object(a.id) : undefined;
    // Delete / Backspace edit nodes here; they never delete whole objects while reshaping.
    const deleting = e.key === 'Delete' || e.key === 'Backspace';
    if (!a || !o) return deleting;
    const onRail1 = a.node < o.points.length;
    const list = onRail1 ? o.points : o.rail2;
    const i = onRail1 ? a.node : a.node - o.points.length;
    const nd = list[i];
    if (!nd) return false;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (ed.deleteNode(a.id, a.node)) this.active = null;
      return true;
    }
    let next: PathNode | null = null;
    if (e.key === ' ') next = { ...nd, type: nd.type === 'corner' ? 'curve' : 'corner' };
    else if (e.key === '[' || e.key === ']') {
      const w = nd.width ?? o.settings.satinWidth;
      next = { ...nd, width: Math.max(0.1, Math.round((w + (e.key === ']' ? NODE_WIDTH_STEP_MM : -NODE_WIDTH_STEP_MM)) * 1000) / 1000) };
    }
    if (!next) return false;
    const updated = list.map((x, j) => (j === i ? next! : x));
    ed.replace(onRail1 ? { ...o, points: updated } : { ...o, rail2: updated });
    ed.commit(e.key === ' ' ? 'Node type' : 'Node width');
    return true;
  }

  override cancel(): void {
    const d = this.drag;
    this.drag = null;
    if (d?.dragging) {
      this.editor.replace(d.object);
      this.editor.endLive();
    }
  }
}

// ---- stitches: drag needle points (hand edits) ----

class StitchesTool extends BaseTool {
  readonly name = 'stitches';
  private drag: { object: StitchObject; index: number; stitches: Point[]; at: PointerInput; dragging: boolean } | null = null;

  override pointerDown(e: PointerInput): void {
    const ed = this.editor;
    const p = ed.toDesign(e);
    const tol = ed.pxToMm(NODE_PICK_PX);
    for (const o of ed.selectedObjects()) {
      const pts = ed.stitches(o);
      let best = -1;
      let bestD = tol;
      pts.forEach((q, i) => {
        const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
        if (d <= bestD) {
          bestD = d;
          best = i;
        }
      });
      if (best >= 0 && !o.locked) {
        this.drag = { object: o, index: best, stitches: pts.map((q): Point => [q[0], q[1]]), at: e, dragging: false };
        return;
      }
    }
  }

  override pointerMove(e: PointerInput): void {
    const d = this.drag;
    if (!d) return;
    const ed = this.editor;
    if (!d.dragging) {
      if (!isDrag(d.at, e)) return;
      d.dragging = true;
      ed.beginLive([d.object.id]);
    }
    const customStitches = d.stitches.map((q, i): Point => (i === d.index ? ed.toDesign(e) : q));
    ed.replace({ ...d.object, customStitches });
  }

  override pointerUp(): void {
    const d = this.drag;
    this.drag = null;
    if (d?.dragging) {
      this.editor.endLive();
      this.editor.commit('Edit stitches');
    }
  }

  override cancel(): void {
    const d = this.drag;
    this.drag = null;
    if (d?.dragging) {
      this.editor.replace(d.object);
      this.editor.endLive();
    }
  }
}

// ---- pick: entry, exit, colour ----

export type PickMode = 'entry' | 'exit' | 'colour' | 'hoop';

class PickTool extends BaseTool {
  readonly name = 'pick';
  mode: PickMode = 'entry';

  override pointerDown(e: PointerInput): void {
    const ed = this.editor;
    const p = ed.toDesign(e);
    if (this.mode === 'colour') {
      // On a picture: the average of a 5 x 5 pixel area, as a new (or the matching) slot.
      const fromArt = ed.artworkColourAt(p);
      if (fromArt) {
        ed.useOrAddColour(fromArt);
        ed.setStatus(`Colour picked from the picture: rgb(${fromArt.join(', ')})`);
        return;
      }
      const hit = ed.objectAt(e);
      if (hit) {
        ed.currentColor = [...hit.color];
        ed.changed('state');
        ed.setStatus(`Colour picked from ${hit.name}`);
      }
      return;
    }
    const target = ed.selectedObjects()[0] ?? ed.objectAt(e);
    if (!target) return;
    if (this.mode === 'hoop') {
      ed.replace({ ...target, hoopOut: p });
      ed.commit('Hoop out');
      ed.setTool('select');
      return;
    }
    ed.replace(this.mode === 'entry' ? { ...target, fillStart: p, autoEntry: false } : { ...target, fillEnd: p, autoEntry: false });
    ed.commit(this.mode === 'entry' ? 'Set entry' : 'Set exit');
  }
}

// ---- angle: draw stitch angle lines ----

class AngleTool extends BaseTool {
  readonly name = 'angle';
  private start: Point | null = null;
  private end: Point | null = null;

  override pointerDown(e: PointerInput): void {
    this.start = this.editor.toDesign(e);
    this.end = this.start;
  }

  override pointerMove(e: PointerInput): void {
    if (this.start) this.end = this.editor.toDesign(e);
  }

  override pointerUp(e: PointerInput): void {
    const ed = this.editor;
    const a = this.start;
    this.start = null;
    if (!a) return;
    const b = ed.toDesign(e);
    const target = ed.selectedObjects()[0];
    if (!target || Math.hypot(b[0] - a[0], b[1] - a[1]) < 1) return;
    ed.replace({ ...target, stitchAngles: [...target.stitchAngles, [a, b]] });
    ed.commit('Stitch angle');
  }

  override cancel(): void {
    this.start = null;
  }

  override overlay(): ToolOverlay {
    return this.start && this.end ? { line: [this.start, this.end] } : {};
  }
}

// ---- measure ----

class MeasureTool extends BaseTool {
  readonly name = 'measure';
  private start: Point | null = null;
  private end: Point | null = null;

  override pointerDown(e: PointerInput): void {
    this.start = this.editor.toDesign(e);
    this.end = this.start;
  }

  override pointerMove(e: PointerInput): void {
    if (!this.start) return;
    this.end = this.editor.toDesign(e);
    this.report();
  }

  override pointerUp(e: PointerInput): void {
    if (!this.start) return;
    this.end = this.editor.toDesign(e);
    this.report();
    this.start = null;
  }

  private report(): void {
    const a = this.start!;
    const b = this.end!;
    const ed = this.editor;
    const angle = (Math.atan2(-(b[1] - a[1]), b[0] - a[0]) * 180) / Math.PI;
    ed.setStatus(`Distance ${formatLength(Math.hypot(b[0] - a[0], b[1] - a[1]), ed.units)}, angle ${angle.toFixed(1)}°`);
  }

  override overlay(): ToolOverlay {
    return this.start && this.end ? { line: [this.start, this.end] } : {};
  }
}

// ---- cut shapes: a knife line ----

/** Drag a line; on release the selected objects (or, with none selected, every object it crosses) are cut. */
class CutTool extends BaseTool {
  readonly name = 'cut';
  private start: Point | null = null;
  private end: Point | null = null;

  constructor(editor: Editor) {
    super(editor);
    editor.setStatus('Cut shapes: drag a line across the objects to cut');
  }

  override pointerDown(e: PointerInput): void {
    this.start = this.editor.snapPoint(this.editor.toDesign(e), e);
    this.end = this.start;
  }

  override pointerMove(e: PointerInput): void {
    if (!this.start) return;
    this.end = this.editor.snapPoint(this.editor.toDesign(e), e);
    this.editor.changed('overlay');
  }

  override pointerUp(e: PointerInput): void {
    if (!this.start) return;
    const a = this.start;
    const b = this.editor.snapPoint(this.editor.toDesign(e), e);
    this.start = this.end = null;
    this.editor.changed('overlay');
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) < this.editor.pxToMm(3)) return;
    this.editor.cutWithLine([a, b]);
  }

  override cancel(): void {
    this.start = this.end = null;
  }

  override overlay(): ToolOverlay {
    return this.start && this.end ? { line: [this.start, this.end] } : {};
  }
}

// ---- letters: adjust single letters of a text ----

/** Letters mode steps (Shift x 10 for moves). */
const LETTER_MOVE_MM = 0.5;
const LETTER_SCALE = 0.05;
const LETTER_TURN_DEG = 5;

class LettersTool extends BaseTool {
  readonly name = 'letters';

  constructor(editor: Editor) {
    super(editor);
    // Start on the first letter of the selected text.
    const id = editor.selectedTextId();
    if (id !== null && editor.activeLetter?.textId !== id) editor.activeLetter = { textId: id, letter: 0 };
    editor.setStatus('Letters: A/D, W/S move · Z/X size · Q/E turn · C/V slant · R reset letter · B reset all · Tab next letter · Esc done');
  }

  override pointerDown(e: PointerInput): void {
    const ed = this.editor;
    const hit = ed.objectAt(e);
    const meta = hit ? (hit.textMeta as unknown as { textId?: number; letter?: number } | null) : null;
    if (meta && typeof meta.textId === 'number' && typeof meta.letter === 'number') {
      ed.activeLetter = { textId: meta.textId, letter: meta.letter };
      ed.setSelection(ed.textPieces(meta.textId).map((o) => o.id));
    }
  }

  override keyDown(e: KeyInput): boolean {
    const ed = this.editor;
    const a = ed.activeLetter;
    if (!a || e.ctrl) return false;
    const k = e.key.toLowerCase();
    const move = LETTER_MOVE_MM * (e.shift ? 10 : 1);
    const changes: Record<string, (l: LetterAdjust) => LetterAdjust | null> = {
      a: (l) => ({ ...l, dx: l.dx - move }),
      d: (l) => ({ ...l, dx: l.dx + move }),
      w: (l) => ({ ...l, dy: l.dy - move }),
      s: (l) => ({ ...l, dy: l.dy + move }),
      z: (l) => ({ ...l, scale: Math.max(0.1, l.scale - LETTER_SCALE) }),
      x: (l) => ({ ...l, scale: l.scale + LETTER_SCALE }),
      q: (l) => ({ ...l, rotate: l.rotate - LETTER_TURN_DEG }),
      e: (l) => ({ ...l, rotate: l.rotate + LETTER_TURN_DEG }),
      c: (l) => ({ ...l, slant: l.slant - LETTER_TURN_DEG }),
      v: (l) => ({ ...l, slant: l.slant + LETTER_TURN_DEG }),
      r: () => null,
    };
    if (changes[k]) {
      ed.adjustLetter(a.textId, a.letter, changes[k]!);
      return true;
    }
    if (k === 'b') {
      const spec = ed.textSpec(a.textId);
      if (spec) {
        spec.letters = {};
        ed.editText(a.textId, spec, 'Reset letters');
      }
      return true;
    }
    if (e.key === 'Tab') {
      const n = ed.letterCount(a.textId);
      if (n) ed.activeLetter = { textId: a.textId, letter: (a.letter + (e.shift ? n - 1 : 1)) % n };
      ed.changed('overlay');
      return true;
    }
    if (e.key === 'Escape') {
      ed.setTool('select');
      return true;
    }
    return false;
  }

  override overlay(): ToolOverlay {
    const ed = this.editor;
    const a = ed.activeLetter;
    if (!a) return {};
    const pieces = ed.textPieces(a.textId).filter((o) => (o.textMeta as unknown as { letter?: number } | null)?.letter === a.letter);
    const box = ed.selectionBox(pieces);
    return box ? { box } : {};
  }
}

export function createTool(name: ToolName, editor: Editor): Tool {
  switch (name) {
    case 'draw':
      return new DrawTool(editor);
    case 'shape':
      return new ShapeTool(editor);
    case 'polygon':
      return new PolygonTool(editor);
    case 'reshape':
      return new ReshapeTool(editor);
    case 'stitches':
      return new StitchesTool(editor);
    case 'pick':
      return new PickTool(editor);
    case 'angle':
      return new AngleTool(editor);
    case 'measure':
      return new MeasureTool(editor);
    case 'cut':
      return new CutTool(editor);
    case 'letters':
      return new LettersTool(editor);
    default:
      return new SelectTool(editor);
  }
}

/** The pick tool's mode (entry, exit or colour), if it is the active tool. */
export function setPickMode(tool: Tool, mode: PickMode): void {
  if (tool instanceof PickTool) tool.mode = mode;
}
