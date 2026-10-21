// Canvas 2D renderer.
//
// Two layers: a BASE layer in an offscreen canvas holding every object not being changed,
// redrawn only when those objects or the view change; and, every frame, the base copied in,
// then the live objects (being dragged) and the overlay (selection, nodes, tool feedback,
// rulers). Each object's stitches become a Path2D once per version. At most one redraw per
// animation frame.

import { JUMP_MARK, type Point, type StitchObject } from '@stitchpro/engine';
import { RULER_PX, SIM_THREAD_MM } from './constants';
import type { ChangeKind, Editor } from './editor';
import { unionBox, type Box } from './hittest';

/** The parts of Path2D the renderer uses (a fake can stand in for tests). */
export interface PathLike {
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
}

export interface CanvasLike {
  width: number;
  height: number;
  getContext(kind: '2d'): CanvasRenderingContext2D | null;
}

export interface RendererOptions {
  /** CSS-to-device pixel ratio. */
  pixelRatio?: number;
  createCanvas?: (width: number, height: number) => CanvasLike;
  createPath?: () => PathLike;
  requestFrame?: (draw: () => void) => void;
}

export interface Theme {
  background: string;
  hoop: string;
  grid: string;
  selection: string;
  node: string;
  ruler: string;
  rulerText: string;
}

const LIGHT: Theme = {
  background: '#ffffff',
  hoop: '#9aa3ad',
  grid: '#eef0f3',
  selection: '#1a73e8',
  node: '#1a73e8',
  ruler: '#f4f5f7',
  rulerText: '#5f6670',
};

const css = (c: readonly number[], k = 1) =>
  `rgb(${Math.round(Math.min(255, c[0]! * k))}, ${Math.round(Math.min(255, c[1]! * k))}, ${Math.round(Math.min(255, c[2]! * k))})`;

export class Renderer {
  theme: Theme = LIGHT;
  showRulers = true;
  showGrid = false;
  gridSpacing = 10;

  private readonly ctx: CanvasRenderingContext2D;
  private base: CanvasLike | null = null;
  private baseKey = '';
  private pending = false;
  private paths = new Map<number, { version: number; path: PathLike }>();
  private readonly ratio: number;
  private readonly createCanvas: (w: number, h: number) => CanvasLike;
  private readonly createPath: () => PathLike;
  private readonly requestFrame: (draw: () => void) => void;
  private readonly unsubscribe: () => void;
  /** Counters, for tests and diagnostics. */
  readonly stats = { frames: 0, baseDraws: 0, pathsBuilt: 0 };

  constructor(
    private readonly editor: Editor,
    private readonly canvas: CanvasLike,
    opts: RendererOptions = {},
  ) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D is not available');
    this.ctx = ctx;
    this.ratio = opts.pixelRatio ?? (typeof devicePixelRatio === 'number' ? devicePixelRatio : 1);
    this.createCanvas =
      opts.createCanvas ??
      ((w, h) => (typeof OffscreenCanvas !== 'undefined' ? (new OffscreenCanvas(w, h) as unknown as CanvasLike) : Object.assign(document.createElement('canvas'), { width: w, height: h })));
    this.createPath = opts.createPath ?? (() => new Path2D());
    this.requestFrame = opts.requestFrame ?? ((f) => requestAnimationFrame(() => f()));
    this.unsubscribe = editor.subscribe((kind: ChangeKind) => this.requestRedraw(kind));
  }

  dispose(): void {
    this.unsubscribe();
  }

  /** Schedules one redraw on the next animation frame (repeated requests coalesce). */
  requestRedraw(_kind: ChangeKind = 'state'): void {
    if (this.pending) return;
    this.pending = true;
    this.requestFrame(() => {
      this.pending = false;
      this.draw();
    });
  }

  /** The stitches of an object as a path, built once per version. */
  pathFor(o: StitchObject): PathLike {
    const hit = this.paths.get(o.id);
    if (hit && hit.version === o.version) return hit.path;
    const path = this.createPath();
    const pts = this.editor.stitches(o);
    let jump = 0;
    pts.forEach((p, i) => {
      // A jump mark (the landing point repeated) is drawn as a move, not a stitch.
      const repeat = i > 0 && p[0] === pts[i - 1]![0] && p[1] === pts[i - 1]![1];
      jump = repeat ? jump + 1 : 0;
      if (i === 0) path.moveTo(p[0], p[1]);
      else if (jump === JUMP_MARK - 1) path.moveTo(p[0], p[1]);
      else path.lineTo(p[0], p[1]);
    });
    this.paths.set(o.id, { version: o.version, path });
    this.stats.pathsBuilt++;
    return path;
  }

  /** Draws a frame now. */
  draw(): void {
    this.stats.frames++;
    const { canvas, ctx, editor } = this;
    const w = canvas.width;
    const h = canvas.height;
    const v = editor.view;
    const key = `${editor.baseRevision}|${v.zoom}|${v.panX}|${v.panY}|${w}x${h}|${editor.simStitch}|${this.showGrid}|${this.gridSpacing}`;
    if (!this.base || this.base.width !== w || this.base.height !== h) {
      this.base = this.createCanvas(w, h);
      this.baseKey = '';
    }
    if (key !== this.baseKey) {
      this.drawBase(this.base);
      this.baseKey = key;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(this.base as unknown as CanvasImageSource, 0, 0);
    this.designTransform(ctx);
    for (const id of editor.live) {
      const o = editor.object(id);
      if (o?.visible) this.drawObject(ctx, o);
    }
    this.drawOverlay(ctx);
    if (this.showRulers) this.drawRulers(ctx);
  }

  private designTransform(ctx: CanvasRenderingContext2D): void {
    const v = this.editor.view;
    const r = this.ratio;
    ctx.setTransform(r * v.zoom, 0, 0, r * v.zoom, r * v.panX, r * v.panY);
  }

  /** One device pixel, in design mm. */
  private get px(): number {
    return 1 / (this.editor.view.zoom * this.ratio);
  }

  private drawBase(target: CanvasLike): void {
    this.stats.baseDraws++;
    const ctx = target.getContext('2d')!;
    const { editor, theme } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = theme.background;
    ctx.fillRect(0, 0, target.width, target.height);
    this.designTransform(ctx);
    if (this.showGrid) this.drawGrid(ctx, target);
    this.drawHoop(ctx);
    for (const o of editor.doc.objects) if (o.visible && !editor.live.has(o.id)) this.drawObject(ctx, o);
  }

  private drawObject(ctx: CanvasRenderingContext2D, o: StitchObject): void {
    const path = this.pathFor(o) as Path2D;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    if (this.editor.simStitch) {
      // SimStitch: thread 0.4 mm thick with simple shading (dark body, light highlight).
      ctx.strokeStyle = css(o.color, 0.7);
      ctx.lineWidth = SIM_THREAD_MM;
      ctx.stroke(path);
      ctx.strokeStyle = css(o.color.map((c) => c + (255 - c) * 0.35));
      ctx.lineWidth = SIM_THREAD_MM * 0.45;
      ctx.stroke(path);
    } else {
      ctx.strokeStyle = css(o.color);
      ctx.lineWidth = this.px;
      ctx.stroke(path);
    }
  }

  private drawHoop(ctx: CanvasRenderingContext2D): void {
    const d = this.editor.doc;
    ctx.strokeStyle = this.theme.hoop;
    ctx.lineWidth = this.px;
    ctx.setLineDash([6 * this.px, 4 * this.px]);
    ctx.beginPath();
    if (d.hoopShape === 'circle') ctx.ellipse(0, 0, d.hoopWidth / 2, d.hoopHeight / 2, 0, 0, Math.PI * 2);
    else ctx.rect(-d.hoopWidth / 2, -d.hoopHeight / 2, d.hoopWidth, d.hoopHeight);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  private drawGrid(ctx: CanvasRenderingContext2D, target: CanvasLike): void {
    const v = this.editor.view;
    const [x0, y0] = v.toDesign([0, 0]);
    const [x1, y1] = v.toDesign([target.width / this.ratio, target.height / this.ratio]);
    const g = this.gridSpacing;
    ctx.strokeStyle = this.theme.grid;
    ctx.lineWidth = this.px;
    ctx.beginPath();
    for (let x = Math.ceil(x0 / g) * g; x <= x1; x += g) {
      ctx.moveTo(x, y0);
      ctx.lineTo(x, y1);
    }
    for (let y = Math.ceil(y0 / g) * g; y <= y1; y += g) {
      ctx.moveTo(x0, y);
      ctx.lineTo(x1, y);
    }
    ctx.stroke();
  }

  private drawOverlay(ctx: CanvasRenderingContext2D): void {
    const { editor, theme } = this;
    const px = this.px;
    let box: Box | null = null;
    for (const o of editor.selectedObjects()) box = unionBox(box, editor.shapes.get(o).box);
    ctx.strokeStyle = theme.selection;
    ctx.lineWidth = px;
    if (box) {
      ctx.setLineDash([4 * px, 3 * px]);
      ctx.strokeRect(box.minX, box.minY, box.maxX - box.minX, box.maxY - box.minY);
      ctx.setLineDash([]);
    }
    // Nodes of the selected objects.
    const size = 3 * this.ratio * px;
    ctx.fillStyle = theme.node;
    for (const o of editor.selectedObjects()) {
      for (const n of [...o.points, ...o.rail2]) {
        ctx.beginPath();
        if (n.type === 'curve') ctx.arc(n.x, n.y, size, 0, Math.PI * 2);
        else ctx.rect(n.x - size, n.y - size, 2 * size, 2 * size);
        ctx.fill();
      }
    }
    const t = editor.tool.overlay();
    if (t.box) {
      ctx.setLineDash([3 * px, 3 * px]);
      ctx.strokeRect(t.box.minX, t.box.minY, t.box.maxX - t.box.minX, t.box.maxY - t.box.minY);
      ctx.setLineDash([]);
    }
    const line = (pts: readonly Point[]) => {
      if (pts.length < 2) return;
      ctx.beginPath();
      ctx.moveTo(pts[0]![0], pts[0]![1]);
      for (const p of pts.slice(1)) ctx.lineTo(p[0], p[1]);
      ctx.stroke();
    };
    if (t.line) line(t.line);
    if (t.nodes?.length) {
      const pts: Point[] = t.nodes.map((n) => [n.x, n.y]);
      line(t.cursor ? [...pts, t.cursor] : pts);
      for (const n of t.nodes) {
        ctx.beginPath();
        ctx.rect(n.x - size, n.y - size, 2 * size, 2 * size);
        ctx.fill();
      }
    }
  }

  private drawRulers(ctx: CanvasRenderingContext2D): void {
    const { editor, theme, ratio } = this;
    const v = editor.view;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const R = RULER_PX * ratio;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = theme.ruler;
    ctx.fillRect(0, 0, w, R);
    ctx.fillRect(0, 0, R, h);
    // Ticks every 1, 5 or 10 mm depending on zoom (at least 6 px apart).
    const step = [1, 5, 10, 50, 100].find((s) => s * v.zoom >= 6) ?? 100;
    ctx.strokeStyle = theme.rulerText;
    ctx.fillStyle = theme.rulerText;
    ctx.lineWidth = 1;
    ctx.font = `${10 * ratio}px sans-serif`;
    ctx.beginPath();
    const [x0, y0] = v.toDesign([0, 0]);
    const [x1, y1] = v.toDesign([w / ratio, h / ratio]);
    for (let x = Math.ceil(x0 / step) * step; x <= x1; x += step) {
      const sx = (x * v.zoom + v.panX) * ratio;
      const major = Math.round(x / step) % 5 === 0;
      ctx.moveTo(sx, R);
      ctx.lineTo(sx, R - (major ? R / 2 : R / 4));
      if (major) ctx.fillText(String(Math.round(x)), sx + 2, 10 * ratio);
    }
    for (let y = Math.ceil(y0 / step) * step; y <= y1; y += step) {
      const sy = (y * v.zoom + v.panY) * ratio;
      const major = Math.round(y / step) % 5 === 0;
      ctx.moveTo(R, sy);
      ctx.lineTo(R - (major ? R / 2 : R / 4), sy);
      if (major) ctx.fillText(String(Math.round(y)), 2, sy - 2);
    }
    ctx.stroke();
  }
}
