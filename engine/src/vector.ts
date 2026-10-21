// SVG path data -> stitch objects, and designs -> SVG.
//
// The host reads each SVG shape's final geometry, colours and transform (it has the browser's
// CSS engine); everything here is plain data. Lengths are mm, y down.

import type { NewObject, StitchDocument, StitchObject } from './document';
import { pathNode } from './document';
import { nestRings, regionArea, type Region } from './geometry';
import { findCorners, flattenArc, flattenBezier, materializePath, polylineLength, smoothPath } from './path';
import { applyAffine, type Affine } from './transforms';
import { JUMP_MARK, defaultSettings, isAreaType, type PathNode, type Point, type RGB } from './types';
import { objectArea } from './weld';

// ---- path data ----

/** One subpath of SVG path data, flattened. */
export interface Subpath {
  points: Point[];
  closed: boolean;
}

/** Flattening tolerance after the transform, mm. */
const RESOLUTION_MM = 0.2;

class Scanner {
  private i = 0;
  constructor(private readonly s: string) {}

  private skip(): void {
    while (this.i < this.s.length && /[\s,]/.test(this.s[this.i]!)) this.i++;
  }

  /** The next command letter, or null when numbers follow (an implicit repeat). */
  command(): string | null {
    this.skip();
    const c = this.s[this.i];
    if (c && /[MmLlHhVvCcSsQqTtAaZz]/.test(c)) {
      this.i++;
      return c;
    }
    return null;
  }

  done(): boolean {
    this.skip();
    return this.i >= this.s.length;
  }

  hasNumber(): boolean {
    this.skip();
    return /[-+.\d]/.test(this.s[this.i] ?? '');
  }

  number(): number {
    this.skip();
    const m = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/.exec(this.s.slice(this.i));
    if (!m) throw new Error(`Bad SVG path data near "${this.s.slice(this.i, this.i + 12)}"`);
    this.i += m[0].length;
    return Number(m[0]);
  }

  /** Arc flags may be written without separators ("a1 1 0 01 5 5"). */
  flag(): boolean {
    this.skip();
    const c = this.s[this.i];
    if (c !== '0' && c !== '1') throw new Error('Bad arc flag in SVG path data');
    this.i++;
    return c === '1';
  }
}

/**
 * Parses SVG path data into flattened subpaths, mapped through `m` (user units -> mm).
 * Curves are transformed first and flattened in mm; arcs are flattened in user units.
 */
export function parsePathData(d: string, m: Affine = [1, 0, 0, 1, 0, 0]): Subpath[] {
  const sc = new Scanner(d);
  const scale = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;
  const T = (p: Point) => applyAffine(m, p);
  const out: Subpath[] = [];
  let cur: Point[] = [];
  let pos: Point = [0, 0];
  let start: Point = [0, 0];
  let lastCtrl: Point | null = null;
  let lastCmd = '';
  const finish = (closed: boolean) => {
    if (cur.length > 1) out.push({ points: cur, closed });
    cur = [];
  };
  const lineTo = (p: Point) => {
    if (!cur.length) cur.push(T(pos));
    cur.push(T(p));
    pos = p;
  };
  const curveTo = (ctrl: Point[]) => {
    if (!cur.length) cur.push(T(pos));
    cur.push(...flattenBezier([pos, ...ctrl].map(T), RESOLUTION_MM).slice(1));
    pos = ctrl[ctrl.length - 1]!;
  };
  let cmd: string | null = null;
  while (!sc.done()) {
    const next = sc.command();
    if (next) cmd = next;
    else if (!cmd || !sc.hasNumber()) throw new Error('Bad SVG path data');
    else if (cmd === 'M') cmd = 'L';
    else if (cmd === 'm') cmd = 'l';
    const rel = cmd === cmd.toLowerCase();
    const at = (x: number, y: number): Point => (rel ? [pos[0] + x, pos[1] + y] : [x, y]);
    const C = cmd.toUpperCase();
    let ctrl: Point | null = null;
    switch (C) {
      case 'M': {
        finish(false);
        pos = at(sc.number(), sc.number());
        start = pos;
        break;
      }
      case 'L':
        lineTo(at(sc.number(), sc.number()));
        break;
      case 'H': {
        const x = sc.number();
        lineTo([rel ? pos[0] + x : x, pos[1]]);
        break;
      }
      case 'V': {
        const y = sc.number();
        lineTo([pos[0], rel ? pos[1] + y : y]);
        break;
      }
      case 'C': {
        const c1 = at(sc.number(), sc.number());
        const c2 = at(sc.number(), sc.number());
        const p = at(sc.number(), sc.number());
        curveTo([c1, c2, p]);
        ctrl = c2;
        break;
      }
      case 'S': {
        const c1: Point = lastCtrl && /[CS]/.test(lastCmd) ? [2 * pos[0] - lastCtrl[0], 2 * pos[1] - lastCtrl[1]] : pos;
        const c2 = at(sc.number(), sc.number());
        const p = at(sc.number(), sc.number());
        curveTo([c1, c2, p]);
        ctrl = c2;
        break;
      }
      case 'Q': {
        const c = at(sc.number(), sc.number());
        const p = at(sc.number(), sc.number());
        curveTo([c, p]);
        ctrl = c;
        break;
      }
      case 'T': {
        const c: Point = lastCtrl && /[QT]/.test(lastCmd) ? [2 * pos[0] - lastCtrl[0], 2 * pos[1] - lastCtrl[1]] : pos;
        const p = at(sc.number(), sc.number());
        curveTo([c, p]);
        ctrl = c;
        break;
      }
      case 'A': {
        const rx = sc.number();
        const ry = sc.number();
        const rot = sc.number();
        const large = sc.flag();
        const sweep = sc.flag();
        const p = at(sc.number(), sc.number());
        if (!cur.length) cur.push(T(pos));
        cur.push(...flattenArc(pos, rx, ry, rot, large, sweep, p, RESOLUTION_MM / scale).slice(1).map(T));
        pos = p;
        break;
      }
      case 'Z': {
        if (cur.length) {
          const s = T(start);
          const last = cur[cur.length - 1]!;
          if (Math.hypot(last[0] - s[0], last[1] - s[1]) > 1e-9) cur.push(s);
        }
        finish(true);
        pos = start;
        break;
      }
    }
    lastCtrl = ctrl;
    lastCmd = C;
  }
  finish(false);
  return out;
}

// ---- SVG shapes -> objects ----

/** One shape as the host read it: path data, its matrix to mm, and its final paint. */
export interface VectorShape {
  d: string;
  /** User units -> design mm (the element's full transform times the unit scale). */
  matrix: Affine;
  fill: RGB | null;
  stroke: RGB | null;
  /** Stroke width in the element's user units. */
  strokeWidth: number;
}

export interface VectorOptions {
  /** Filled pieces smaller than this are skipped, mm^2. */
  minArea?: number;
  /** Strokes shorter than this are skipped, mm. */
  minLength?: number;
  /** Strokes at least this wide become satin, mm; thinner ones a run. */
  satinFrom?: number;
  /** Node smoothing tolerance, mm. */
  smoothing?: number;
}

/** Dense points as the fewest nodes within tol: sharp turns stay corners, the rest become curves. */
function smoothNodes(pts: readonly Point[], closed: boolean, tol: number): PathNode[] {
  const first = pts[0]!;
  const last = pts[pts.length - 1]!;
  const repeated = pts.length > 1 && first[0] === last[0] && first[1] === last[1];
  const ring = closed && !repeated ? [...pts, first] : pts;
  const corners = new Set(findCorners(ring, { closed }));
  const nodes = (closed ? ring.slice(0, -1) : ring).map(([x, y], i) => pathNode(x, y, corners.has(i) ? 'corner' : 'curve'));
  return smoothPath(nodes, closed, tol);
}

/**
 * Stitch objects for SVG shapes: filled shapes become tatami with holes (tiny pieces skipped);
 * strokes become satin when at least 1 mm wide, else a run. Nodes are smoothed.
 */
export function vectorObjects(shapes: readonly VectorShape[], opts: VectorOptions = {}): NewObject[] {
  const minArea = opts.minArea ?? 1;
  const minLength = opts.minLength ?? 0.5;
  const satinFrom = opts.satinFrom ?? 1;
  const tol = opts.smoothing ?? 0.1;
  const out: NewObject[] = [];
  for (const shape of shapes) {
    let subpaths: Subpath[];
    try {
      subpaths = parsePathData(shape.d, shape.matrix);
    } catch {
      continue;
    }
    if (shape.fill) {
      // Fills close every subpath.
      const region: Region = nestRings(subpaths.filter((s) => s.points.length >= 3).map((s) => s.points));
      for (const poly of region) {
        if (regionArea([poly]) < minArea) continue;
        out.push({
          settings: defaultSettings({ stitchType: 'fill' }),
          closed: true,
          color: [...shape.fill],
          points: smoothNodes(poly.outer, true, tol),
          holes: poly.holes.filter((h) => regionArea([{ outer: h, holes: [] }]) >= minArea / 4).map((h) => smoothNodes(h, true, tol)),
        });
      }
    }
    if (shape.stroke && shape.strokeWidth > 0) {
      const m = shape.matrix;
      const width = shape.strokeWidth * Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
      const satin = width >= satinFrom;
      for (const s of subpaths) {
        if (polylineLength(s.points) < minLength) continue;
        out.push({
          settings: defaultSettings(satin ? { stitchType: 'satin', satinWidth: Math.round(width * 100) / 100 } : { stitchType: 'running' }),
          closed: s.closed,
          color: [...shape.stroke],
          points: smoothNodes(s.points, s.closed, tol),
        });
      }
    }
  }
  return out;
}

// ---- design -> SVG ----

export type SvgMode = 'shapes' | 'stitches';

const hex = (c: RGB) => `#${c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
const n = (v: number) => (Math.round(v * 1000) / 1000).toString();
const escapeXml = (s: string) => s.replace(/[<>&"']/g, (ch) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[ch]!);

/** A stitch list split at jump marks (a landing point written JUMP_MARK times) into needle runs. */
export function stitchRuns(pts: readonly Point[]): Point[][] {
  const same = (a: Point | undefined, b: Point) => !!a && a[0] === b[0] && a[1] === b[1];
  const runs: Point[][] = [];
  let cur: Point[] = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    let landing = i > 0 && !same(pts[i - 1], p);
    for (let k = 1; landing && k < JUMP_MARK; k++) landing = same(pts[i + k], p);
    if (landing) {
      if (cur.length > 1) runs.push(cur);
      cur = [];
      i += JUMP_MARK - 1;
    }
    cur.push(p);
  }
  if (cur.length > 1) runs.push(cur);
  return runs;
}

const ringPath = (ring: readonly Point[]) => `M${ring.map((p) => `${n(p[0])} ${n(p[1])}`).join('L')}Z`;
const linePath = (line: readonly Point[]) => `M${line.map((p) => `${n(p[0])} ${n(p[1])}`).join('L')}`;

/**
 * The design as an SVG at real size (mm): shapes (areas and columns filled, lines stroked) or
 * stitches, in thread colours.
 */
export function designSvg(doc: StitchDocument, stitchesOf: (o: StitchObject) => Point[], mode: SvgMode = 'stitches'): string {
  const parts: string[] = [];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const grow = (pts: readonly Point[]) => {
    for (const [x, y] of pts) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  };
  for (const o of doc.objects) {
    if (!o.visible) continue;
    const colour = hex(o.color);
    if (mode === 'stitches') {
      for (const run of stitchRuns(stitchesOf(o))) {
        grow(run);
        parts.push(`<path d="${linePath(run)}" stroke="${colour}"/>`);
      }
      continue;
    }
    const area = objectArea(o);
    if (area.length) {
      for (const poly of area) grow(poly.outer);
      parts.push(`<path d="${area.map((p) => [p.outer, ...p.holes].map(ringPath).join('')).join('')}" fill="${colour}" fill-rule="evenodd" stroke="none"/>`);
    } else if (!isAreaType(o.settings.stitchType)) {
      const line = o.customStitches ?? materializePath(o.points, o.closed);
      if (line.length < 2) continue;
      grow(line);
      parts.push(`<path d="${linePath(line)}" stroke="${colour}"/>`);
    }
  }
  if (!parts.length) minX = minY = maxX = maxY = 0;
  const pad = 1;
  const x = minX - pad;
  const y = minY - pad;
  const w = maxX - minX + 2 * pad;
  const h = maxY - minY + 2 * pad;
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${n(w)}mm" height="${n(h)}mm" viewBox="${n(x)} ${n(y)} ${n(w)} ${n(h)}">`,
    `<title>${escapeXml(doc.name || 'design')}</title>`,
    `<g fill="none" stroke-width="${mode === 'stitches' ? 0.25 : 0.4}" stroke-linejoin="round" stroke-linecap="round">`,
    ...parts,
    `</g>`,
    `</svg>`,
    '',
  ].join('\n');
}
