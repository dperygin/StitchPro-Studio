// Lettering layout.
//
// Pipeline: place letters (width, spacing, kerning) -> stack and align lines -> slant ->
// envelope -> wrap round the baseline (arc or a drawn line). The text is centred on its
// unadjusted layout. Every piece carries textMeta so Edit text can rebuild it, and per-letter
// adjustments (Letters mode) are stored there so other letters never move.

import { autodigitize } from './autodigitize';
import { createDocument, createObject, pathNode, type NewObject, type StitchObject, type TextMeta } from './document';
import { fastAreaCovers, nestRings, uncoveredLength, type CoverRaster } from './geometry';
import { cumulativeLengths, distance, douglasPeucker, materializePath, pointAt, projectOntoPolyline } from './path';
import type { PathNode, Point, RGB, StitchType } from './types';
import { objectArea } from './weld';

// ---- fonts as lettering sources ----

export interface GlyphShape {
  /** Advance width, font units. */
  advance: number;
  /** Native fonts: stitch objects in font units (baseline y = 0, y down). */
  objects?: readonly StitchObject[];
  /** Outline fonts: closed contours in font units (baseline y = 0, y down). */
  contours?: readonly Point[][];
}

export interface LetterFont {
  name: string;
  /** Native (.spf) fonts carry stitch objects; outline fonts carry contours. */
  native: boolean;
  /** Capital height, font units. */
  capHeight: number;
  glyph(ch: string): GlyphShape | null;
  /** Kerning between two characters, font units. */
  kerning(a: string, b: string): number;
  /** Characters the font can sew. */
  chars(): string[];
}

// ---- the text spec ----

export type TextAlign = 'left' | 'centre' | 'right' | 'full';
export type TextBaseline = 'straight' | 'arcTop' | 'arcBottom' | 'custom';
export type TextOrder = 'ltr' | 'rtl' | 'centreOut';
export type TextEnvelope = 'none' | 'archUp' | 'archDown' | 'bulge' | 'pinch';
/** How outline (TrueType) letters are sewn. */
export type TextStitch = 'satin_fill' | 'fill' | 'satin_outline' | 'running';

/** A per-letter adjustment (Letters mode), about the letter's centre. */
export interface LetterAdjust {
  dx: number;
  dy: number;
  scale: number;
  /** Degrees, clockwise on screen. */
  rotate: number;
  /** Degrees. */
  slant: number;
}

export interface TextSpec {
  text: string;
  font: string;
  /** Capital height, mm (1-300). */
  capHeight: number;
  /** Extra space between letters, mm. */
  letterSpacing: number;
  kerning: boolean;
  align: TextAlign;
  /** Baseline to baseline, as a multiple of the capital height. */
  lineSpacing: number;
  /** Letter width, %. */
  widthPercent: number;
  /** Degrees (positive leans right). */
  slant: number;
  baseline: TextBaseline;
  /** Arc radius, mm. */
  arcRadius: number;
  /** The drawn baseline for 'custom', in design mm. */
  customLine: Point[] | null;
  order: TextOrder;
  envelope: TextEnvelope;
  /** Envelope strength, as a fraction of the capital height. */
  envelopeAmount: number;
  stitch: TextStitch;
  /** Centre of the text, mm. */
  position: Point;
  color: RGB;
  /** Adjustments by letter index (letters are counted without spaces and line breaks). */
  letters: Record<number, LetterAdjust>;
}

export const DEFAULT_LETTER: Readonly<LetterAdjust> = Object.freeze({ dx: 0, dy: 0, scale: 1, rotate: 0, slant: 0 });

export function defaultTextSpec(overrides: Partial<TextSpec> = {}): TextSpec {
  return {
    text: 'Text',
    font: '',
    capHeight: 10,
    letterSpacing: 0,
    kerning: true,
    align: 'centre',
    lineSpacing: 1.5,
    widthPercent: 100,
    slant: 0,
    baseline: 'straight',
    arcRadius: 50,
    customLine: null,
    order: 'ltr',
    envelope: 'none',
    envelopeAmount: 0.3,
    stitch: 'satin_fill',
    position: [0, 0],
    color: [0, 0, 0],
    letters: {},
    ...overrides,
  };
}

/** What every lettering piece carries in its textMeta. */
export interface LetterMeta {
  textId: number;
  /** Letter index in the text (spaces and line breaks not counted). */
  letter: number;
  char: string;
  /** Capital height, mm (the underlay rule reads this). */
  capHeight: number;
  spec: TextSpec;
}

export function letterMeta(o: { textMeta: TextMeta | null }): LetterMeta | null {
  const m = o.textMeta as unknown as LetterMeta | null;
  return m && typeof m.textId === 'number' && m.spec ? m : null;
}

// ---- layout ----

interface PlacedLetter {
  index: number;
  char: string;
  line: number;
  /** Pen position, mm (before alignment offsets). */
  x: number;
  width: number;
  glyph: GlyphShape;
}

export interface TextLayout {
  /** Pieces in sewing order, each with textMeta. Not yet added to any document. */
  pieces: NewObject[];
  /** Letters in sewing order (pieces grouped by letter). */
  letters: { index: number; char: string; pieces: NewObject[] }[];
  /** Width of the widest line and the text's height, mm (unadjusted). */
  width: number;
  height: number;
}

const deg = Math.PI / 180;

/**
 * The mapping from a glyph's font units to design mm for one letter: letter width and scale,
 * the letter's own adjustment, its place in the layout, centring on the unadjusted layout,
 * slant, envelope and baseline.
 */
function letterMapping(spec: TextSpec, scale: number, wScale: number, letter: PlacedLetter, lineX: number, baselineY: number, centre: Point, width: number) {
  const adj = { ...DEFAULT_LETTER, ...(spec.letters[letter.index] ?? {}) };
  const lc: Point = [letter.width / 2, -spec.capHeight / 2];
  const sinR = Math.sin(adj.rotate * deg);
  const cosR = Math.cos(adj.rotate * deg);
  const tanLetter = Math.tan(adj.slant * deg);
  const tanText = Math.tan(spec.slant * deg);
  const W = Math.max(width, 1e-6);
  const A = spec.envelopeAmount * spec.capHeight;
  const R = Math.max(1, spec.arcRadius);
  const line = spec.customLine && spec.customLine.length >= 2 ? spec.customLine : null;
  const lineCum = line ? cumulativeLengths(line) : null;
  return ([u, v]: Point): Point => {
    // Font units -> letter mm, then the letter's own adjustment about its centre.
    let x = u * wScale - lc[0];
    let y = v * scale - lc[1];
    x -= tanLetter * y;
    x *= adj.scale;
    y *= adj.scale;
    [x, y] = [x * cosR - y * sinR, x * sinR + y * cosR];
    x += lc[0] + adj.dx;
    y += lc[1] + adj.dy;
    // Into the layout, centred on the unadjusted layout.
    x += letter.x + lineX - centre[0];
    y += baselineY - centre[1];
    // Slant (lean right for positive angles: higher points move right).
    x -= tanText * y;
    // Envelope across the width.
    const t = Math.min(1, Math.max(0, (x + W / 2) / W));
    const bump = Math.sin(Math.PI * t);
    if (spec.envelope === 'archUp') y -= A * bump;
    else if (spec.envelope === 'archDown') y += A * bump;
    else if (spec.envelope === 'bulge') y *= 1 + spec.envelopeAmount * bump;
    else if (spec.envelope === 'pinch') y *= 1 - spec.envelopeAmount * bump;
    // Baseline.
    if (spec.baseline === 'arcTop') {
      const a = x / R;
      const r = R - y;
      return [spec.position[0] + r * Math.sin(a), spec.position[1] + R - r * Math.cos(a)];
    }
    if (spec.baseline === 'arcBottom') {
      const a = x / R;
      const r = R + y;
      return [spec.position[0] + r * Math.sin(a), spec.position[1] - R + r * Math.cos(a)];
    }
    if (spec.baseline === 'custom' && line && lineCum) {
      const total = lineCum[lineCum.length - 1]!;
      const s = x + total / 2;
      const p = pointAt(line, s, lineCum);
      const a = pointAt(line, s - 0.1, lineCum);
      const b = pointAt(line, s + 0.1, lineCum);
      const l = distance(a, b) || 1;
      // Up is screen-left of the line's direction: (dy, -dx).
      const up: Point = [(b[1] - a[1]) / l, -(b[0] - a[0]) / l];
      return [p[0] - up[0] * y, p[1] - up[1] * y];
    }
    return [x + spec.position[0], y + spec.position[1]];
  };
}

const mapNode = (f: (p: Point) => Point, k: number) => (n: PathNode): PathNode => {
  const [x, y] = f([n.x, n.y]);
  return { ...n, x, y, width: n.width === null ? null : n.width * k };
};

const digitizedCache = new WeakMap<readonly Point[][], { capHeight: number; objects: NewObject[] }>();

/** Auto-digitized drafts of a glyph outline, cached per outline. */
function digitized(contours: readonly Point[][], capHeight: number): NewObject[] {
  const hit = digitizedCache.get(contours);
  if (hit && hit.capHeight === capHeight) return hit.objects;
  const objects = autodigitize(contours, capHeight);
  digitizedCache.set(contours, { capHeight, objects });
  return objects;
}

/** Pieces for one outline (TrueType) letter. */
function outlinePieces(contours: readonly Point[][], f: (p: Point) => Point, spec: TextSpec, capHeight: number, scale: number): NewObject[] {
  const rings = contours.map((c) => c.map(f)).filter((r) => r.length >= 3);
  const nodes = (ring: Point[]) => douglasPeucker([...ring, ring[0]!], 0.03).slice(0, -1).map(([x, y]) => pathNode(x, y));
  if (spec.stitch === 'running' || spec.stitch === 'satin_outline') {
    const type: StitchType = spec.stitch === 'running' ? 'running' : 'satin';
    return rings.map((r) => {
      const o: NewObject = { stitchType: type, closed: true, points: nodes(r) };
      if (type === 'satin') o.settings = { ...createObject(createDocument(), { stitchType: 'satin' }).settings, satinWidth: Math.max(0.6, Math.min(2, spec.capHeight * 0.08)) };
      return o;
    });
  }
  // Satin columns: the auto-digitizer's drafts (in font units), mapped into place.
  if (spec.stitch === 'satin_fill') {
    const node = mapNode(f, scale);
    return digitized(contours, capHeight).map((o) => ({
      ...o,
      settings: o.settings ? { ...o.settings } : undefined,
      points: (o.points ?? []).map(node),
      rail2: (o.rail2 ?? []).map(node),
      holes: (o.holes ?? []).map((h) => h.map(node)),
    }));
  }
  // Fills: rings nested into outlines with holes.
  return nestRings(rings).map((poly) => ({
    stitchType: 'fill' as StitchType,
    closed: true,
    points: nodes(poly.outer.slice(0, -1)),
    holes: poly.holes.map((h) => nodes(h.slice(0, -1))),
  }));
}

/** Pieces for one native letter: its objects mapped into place. */
function nativePieces(objects: readonly StitchObject[], f: (p: Point) => Point, widthScale: number): NewObject[] {
  return objects.map((o) => {
    const node = mapNode(f, widthScale);
    const pt = (p: Point | null) => (p ? f(p) : null);
    return {
      name: o.name,
      settings: { ...o.settings },
      closed: o.closed,
      points: o.points.map(node),
      holes: o.holes.map((h) => h.map(node)),
      rail2: o.rail2.map(node),
      fillStart: pt(o.fillStart),
      fillEnd: pt(o.fillEnd),
      autoEntry: o.autoEntry,
      stitchAngles: o.stitchAngles.map(([a, b]) => [f(a), f(b)] as [Point, Point]),
    };
  });
}

/** Lays out a text in a font. Pieces come in sewing order (letters by spec.order, strokes unplanned). */
export function layoutText(spec: TextSpec, font: LetterFont, textId: number): TextLayout {
  const scale = spec.capHeight / font.capHeight;
  const wScale = scale * (spec.widthPercent / 100);
  const spaceAdvance = font.glyph(' ')?.advance ?? font.capHeight * 0.3;

  // 1. Place letters on each line.
  const lines = spec.text.split(/\r?\n/);
  const placed: PlacedLetter[][] = [];
  const widths: number[] = [];
  let index = 0;
  for (let li = 0; li < lines.length; li++) {
    const row: PlacedLetter[] = [];
    let pen = 0;
    let prev: string | null = null;
    for (const ch of [...lines[li]!]) {
      if (prev !== null) {
        pen += spec.letterSpacing;
        if (spec.kerning) pen += font.kerning(prev, ch) * wScale;
      }
      const g = ch === ' ' ? null : font.glyph(ch);
      if (!g) {
        pen += spaceAdvance * wScale;
        prev = ch;
        continue;
      }
      row.push({ index: index++, char: ch, line: li, x: pen, width: g.advance * wScale, glyph: g });
      pen += g.advance * wScale;
      prev = ch;
    }
    placed.push(row);
    widths.push(pen);
  }

  // 2. Stack and align lines.
  const width = Math.max(0, ...widths);
  const step = spec.lineSpacing * spec.capHeight;
  const height = spec.capHeight + step * (lines.length - 1);
  const centre: Point = [width / 2, (-spec.capHeight + step * (lines.length - 1)) / 2];
  const lineOffsets = widths.map((w) => (spec.align === 'centre' ? (width - w) / 2 : spec.align === 'right' ? width - w : 0));

  const letters: TextLayout['letters'] = [];
  placed.forEach((row, li) => {
    // Full justification: spread the spare width between the letters.
    if (spec.align === 'full' && row.length > 1) {
      const extra = (width - widths[li]!) / (row.length - 1);
      row.forEach((l, i) => (l.x += i * extra));
    }
    const built = row.map((l) => {
      const f = letterMapping(spec, scale, wScale, l, lineOffsets[li]!, li * step, centre, width);
      const adjScale = spec.letters[l.index]?.scale ?? 1;
      const pieces = l.glyph.objects ? nativePieces(l.glyph.objects, f, scale * adjScale) : outlinePieces(l.glyph.contours ?? [], f, spec, font.capHeight, scale * adjScale);
      const meta: LetterMeta = { textId, letter: l.index, char: l.char, capHeight: spec.capHeight, spec };
      pieces.forEach((p, k) => {
        p.textMeta = meta as unknown as TextMeta;
        p.color = [...spec.color];
        p.name = pieces.length > 1 ? `${l.char} ${k + 1}` : l.char;
      });
      return { index: l.index, char: l.char, pieces };
    });
    letters.push(...sewingOrder(built, spec.order));
  });
  return { pieces: letters.flatMap((l) => l.pieces), letters, width, height };
}

/** Letters of one line in sewing order: left to right, right to left, or centre out. */
export function sewingOrder<T>(row: readonly T[], order: TextOrder): T[] {
  if (order === 'rtl') return [...row].reverse();
  if (order === 'centreOut' && row.length > 2) {
    // The middle letter, the right half going right, back to the middle, the left half going left.
    const m = Math.floor((row.length - 1) / 2);
    return [...row.slice(m), ...row.slice(0, m).reverse()];
  }
  return [...row];
}

// ---- letter planning ----

export interface PlanOptions {
  trimThreshold: number;
  joinDistance: number;
}

interface StrokeChoice {
  start: Point;
  end: Point;
  /** Open strokes: sew reversed. Closed strokes: the entry point. */
  reversed: boolean;
  entry: Point | null;
}

interface Stroke {
  path: Point[];
  cum: number[];
  closed: boolean;
  choices: StrokeChoice[];
  raster: CoverRaster;
}

function strokeOf(o: StitchObject): Stroke {
  const path = materializePath(o.points, o.closed);
  const cum = cumulativeLengths(path);
  const total = cum[cum.length - 1] ?? 0;
  let choices: StrokeChoice[];
  if (o.closed && path.length > 2) {
    // Closed strokes may start from 8 points round them.
    choices = Array.from({ length: 8 }, (_, k) => {
      const p = pointAt(path, (total * k) / 8, cum);
      return { start: p, end: p, reversed: false, entry: p };
    });
  } else {
    const a = path[0] ?? [0, 0];
    const b = path[path.length - 1] ?? a;
    choices = [
      { start: a, end: b, reversed: false, entry: null },
      { start: b, end: a, reversed: true, entry: null },
    ];
  }
  return { path, cum, closed: o.closed, choices, raster: fastAreaCovers(objectArea(o)) };
}

/**
 * The cost of moving from `a` to stroke `to`'s start: the distance when under the trim distance
 * or covered by strokes still to come; a closest-join step plus 1.3 x the run inside the stroke
 * when it comes within the join distance; otherwise the distance plus 100 (a trim).
 */
function moveCost(a: Point, to: Stroke, choice: StrokeChoice, coming: readonly Stroke[], opts: PlanOptions): number {
  const d = distance(a, choice.start);
  if (d < opts.trimThreshold) return d;
  if (coming.length && uncoveredLength(coming.map((s) => s.raster), a, choice.start) <= 0.1) return d;
  const near = projectOntoPolyline(to.path, a);
  if (near.dist <= opts.joinDistance) {
    const total = to.cum[to.cum.length - 1] ?? 0;
    const startAt = projectOntoPolyline(to.path, choice.start).d;
    let run = Math.abs(startAt - near.d);
    if (to.closed) run = Math.min(run, total - run);
    return near.dist + 1.3 * run;
  }
  return d + 100;
}

interface Variant {
  order: number[];
  choices: number[];
  cost: number;
  start: Point;
  end: Point;
}

const BEAM = 40;

/** The cheapest ways (up to 40) to sew one letter's strokes: every order and direction, beam-pruned. */
function letterVariants(strokes: Stroke[], opts: PlanOptions): Variant[] {
  const n = strokes.length;
  if (!n) return [];
  if (n > 5) {
    // Too many strokes to try every order: keep the order, pick each direction greedily.
    const choices: number[] = [];
    let pos: Point | null = null;
    let cost = 0;
    strokes.forEach((s, i) => {
      let best = 0;
      if (pos) s.choices.forEach((c, k) => (distance(pos!, c.start) < distance(pos!, s.choices[best]!.start) ? (best = k) : 0));
      if (pos) cost += moveCost(pos, s, s.choices[best]!, strokes.slice(i), opts);
      choices.push(best);
      pos = s.choices[best]!.end;
    });
    return [{ order: strokes.map((_, i) => i), choices, cost, start: strokes[0]!.choices[choices[0]!]!.start, end: pos! }];
  }
  let beam: Variant[] = [];
  strokes.forEach((s, i) => s.choices.forEach((c, k) => beam.push({ order: [i], choices: [k], cost: 0, start: c.start, end: c.end })));
  for (let depth = 1; depth < n; depth++) {
    const next: Variant[] = [];
    for (const v of beam) {
      const left = strokes.map((_, i) => i).filter((i) => !v.order.includes(i));
      for (const i of left) {
        const s = strokes[i]!;
        const coming = left.map((j) => strokes[j]!);
        s.choices.forEach((c, k) => {
          next.push({ order: [...v.order, i], choices: [...v.choices, k], cost: v.cost + moveCost(v.end, s, c, coming, opts), start: v.start, end: c.end });
        });
      }
    }
    next.sort((a, b) => a.cost - b.cost);
    beam = next.slice(0, BEAM);
  }
  beam.sort((a, b) => a.cost - b.cost);
  return beam.slice(0, BEAM);
}

/**
 * Letter planning: for each letter, every order and direction of its strokes (up to 5; open
 * columns from either end, closed strokes from 8 points round them), keeping the 40 cheapest;
 * then the cheapest path across all letters by dynamic programming (Viterbi). Returns the pieces
 * in planned order with directions and entry points applied.
 */
export function planLetters(letters: readonly (readonly NewObject[])[], opts: PlanOptions): NewObject[] {
  const scratch = createDocument();
  const objs = letters.map((ps) => ps.map((p) => createObject(scratch, p)));
  const strokes = objs.map((os) => os.map(strokeOf));
  const variants = strokes.map((ss) => letterVariants(ss, opts));
  // Viterbi over the letters.
  const best: { cost: number; from: number }[][] = [];
  variants.forEach((vs, k) => {
    best[k] = vs.map((v) => {
      if (k === 0 || !variants[k - 1]!.length) return { cost: v.cost, from: -1 };
      let min = { cost: Infinity, from: -1 };
      variants[k - 1]!.forEach((u, j) => {
        const first = strokes[k]![v.order[0]!]!;
        const c = best[k - 1]![j]!.cost + moveCost(u.end, first, first.choices[v.choices[0]!]!, strokes[k]!, opts) + v.cost;
        if (c < min.cost) min = { cost: c, from: j };
      });
      return min;
    });
  });
  // Walk back from the cheapest last variant.
  const pick: number[] = new Array(variants.length).fill(-1);
  let k = variants.length - 1;
  while (k >= 0 && !variants[k]!.length) k--;
  if (k >= 0) {
    let j = best[k]!.reduce((bi, b, i) => (b.cost < best[k]![bi]!.cost ? i : bi), 0);
    for (; k >= 0; k--) {
      if (!variants[k]!.length) continue;
      pick[k] = j;
      j = best[k]![j]!.from;
      if (j < 0) {
        // Earlier letters (after an empty one) take their own cheapest variant.
        for (let e = k - 1; e >= 0; e--) pick[e] = variants[e]!.length ? 0 : -1;
        break;
      }
    }
  }
  const out: NewObject[] = [];
  letters.forEach((ps, li) => {
    const v = variants[li]![pick[li]!];
    if (!v) {
      out.push(...ps);
      return;
    }
    v.order.forEach((i, n) => {
      const p = ps[i]!;
      const c = strokes[li]![i]!.choices[v.choices[n]!]!;
      if (c.reversed) out.push({ ...p, points: [...(p.points ?? [])].reverse(), rail2: [...(p.rail2 ?? [])].reverse() });
      else if (c.entry) out.push({ ...p, fillStart: c.entry, autoEntry: false });
      else out.push(p);
    });
  });
  return out;
}

/** Lays out a text and plans its sewing; pieces ready to add to a document. */
export function buildText(spec: TextSpec, font: LetterFont, textId: number, opts: PlanOptions): NewObject[] {
  const layout = layoutText(spec, font, textId);
  return planLetters(
    layout.letters.map((l) => l.pieces),
    opts,
  );
}
