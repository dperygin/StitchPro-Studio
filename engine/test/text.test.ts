import { describe, expect, it } from 'vitest';
import {
  createDocument,
  createNativeFont,
  createObject,
  defaultTextSpec,
  layoutText,
  letterMeta,
  nativeLetterFont,
  parseSpf,
  pathNode,
  planLetters,
  serializeSpf,
  sewingOrder,
  type LetterFont,
  type NewObject,
  type Point,
  type TextSpec,
} from '../src/index';

/** An outline font: every letter a 200 x 1000 unit bar (advance 300); 'O' a box with a hole. */
const bars: LetterFont = {
  name: 'Bars',
  native: false,
  capHeight: 1000,
  glyph: (ch) => {
    if (ch === 'O')
      return {
        advance: 600,
        contours: [
          [[0, 0], [500, 0], [500, -1000], [0, -1000]],
          [[100, -100], [400, -100], [400, -900], [100, -900]],
        ],
      };
    if (!/[A-Z]/.test(ch)) return null;
    return { advance: 300, contours: [[[0, 0], [200, 0], [200, -1000], [0, -1000]]] };
  },
  kerning: (a, b) => (a + b === 'AV' ? -100 : 0),
  chars: () => [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'],
};

const lay = (o: Partial<TextSpec>) => layoutText(defaultTextSpec({ font: 'Bars', stitch: 'fill', ...o }), bars, 1);
const xsOf = (p: NewObject) => (p.points ?? []).map((n) => n.x);
const ysOf = (p: NewObject) => (p.points ?? []).map((n) => n.y);
const extent = (vals: number[]): [number, number] => [Math.min(...vals), Math.max(...vals)];
const near = (a: number[], b: number[], d = 6) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i]!, d));

describe('placing letters', () => {
  it('places letters at their advance, scaled to the capital height, centred on the layout', () => {
    const t = lay({ text: 'II', capHeight: 10, align: 'left' });
    expect(t.pieces).toHaveLength(2);
    expect(t.width).toBeCloseTo(6, 9);
    near(extent(xsOf(t.pieces[0]!)), [-3, -1]);
    near(extent(xsOf(t.pieces[1]!)), [0, 2]);
    near(extent(ysOf(t.pieces[0]!)), [-5, 5]);
  });

  it('adds letter spacing, kerning (when on) and letter width', () => {
    expect(lay({ text: 'II', letterSpacing: 2 }).width).toBeCloseTo(8, 9);
    expect(lay({ text: 'AV' }).width).toBeCloseTo(5, 9); // 6 - 1 mm of kerning
    expect(lay({ text: 'AV', kerning: false }).width).toBeCloseTo(6, 9);
    expect(lay({ text: 'II', widthPercent: 50 }).width).toBeCloseTo(3, 9);
  });

  it('counts spaces as space but not as letters', () => {
    const t = lay({ text: 'I I' });
    expect(t.letters.map((l) => l.index)).toEqual([0, 1]);
    expect(t.width).toBeCloseTo(3 + 3 + 3, 9); // a missing space glyph advances 0.3 x cap height
  });
});

describe('lines and alignment', () => {
  it('stacks lines by line spacing and aligns them', () => {
    const left = lay({ text: 'IIII\nI', align: 'left', lineSpacing: 2 });
    const second = left.pieces[4]!;
    near(extent(ysOf(second)), [5, 15]); // baseline 20 mm below, centred on the 30 mm block
    expect(Math.min(...xsOf(second))).toBeCloseTo(-6, 9);
    const right = lay({ text: 'IIII\nI', align: 'right' });
    expect(Math.max(...xsOf(right.pieces[4]!))).toBeCloseTo(6 - 1, 9);
    const centre = lay({ text: 'IIII\nI', align: 'centre' });
    expect(Math.min(...xsOf(centre.pieces[4]!))).toBeCloseTo(-1.5, 9);
  });

  it('spreads letters for full justification', () => {
    const t = lay({ text: 'IIII\nII', align: 'full' });
    expect(Math.max(...xsOf(t.pieces[5]!))).toBeCloseTo(6 - 1, 9); // the last letter ends at the right
  });
});

describe('slant, envelope and baselines', () => {
  it('slants: higher points move right', () => {
    const t = lay({ text: 'I', slant: 45 });
    const pts = t.pieces[0]!.points!;
    const top = pts.find((n) => n.y < 0)!;
    const bottom = pts.find((n) => n.y > 0 && n.x < 0)!;
    expect(top.x - bottom.x).toBeGreaterThan(9); // 10 mm tall at 45 degrees
  });

  it('bulges the middle and pinches it', () => {
    const height = (t: ReturnType<typeof lay>, i: number) => {
      const [a, b] = extent(ysOf(t.pieces[i]!));
      return b - a;
    };
    const bulge = lay({ text: 'IIIII', envelope: 'bulge', envelopeAmount: 0.5 });
    expect(height(bulge, 2)).toBeGreaterThan(height(bulge, 0));
    const pinch = lay({ text: 'IIIII', envelope: 'pinch', envelopeAmount: 0.5 });
    expect(height(pinch, 2)).toBeLessThan(height(pinch, 0));
    const arch = lay({ text: 'IIIII', envelope: 'archUp', envelopeAmount: 0.5 });
    expect(Math.min(...ysOf(arch.pieces[2]!))).toBeLessThan(Math.min(...ysOf(arch.pieces[0]!)));
  });

  it('wraps round an arc, top or bottom', () => {
    const top = lay({ text: 'IIIII', baseline: 'arcTop', arcRadius: 30, align: 'left' });
    const mid = top.pieces[2]!;
    const edge = top.pieces[0]!;
    // Outer letters bend down and lean out.
    expect(Math.max(...ysOf(edge))).toBeGreaterThan(Math.max(...ysOf(mid)));
    // Every point keeps its distance from the arc centre (0, 30) equal to R - y.
    const bottom = lay({ text: 'IIIII', baseline: 'arcBottom', arcRadius: 30 });
    expect(Math.min(...ysOf(bottom.pieces[0]!))).toBeLessThan(Math.min(...ysOf(bottom.pieces[2]!)));
  });

  it('runs along a drawn baseline', () => {
    const t = lay({ text: 'II', baseline: 'custom', customLine: [[0, -50], [0, 50]] as Point[] });
    // Walking down the screen, letters stack downwards and "up" is to the right (+x).
    expect(Math.max(...ysOf(t.pieces[1]!))).toBeGreaterThan(Math.max(...ysOf(t.pieces[0]!)));
    expect(Math.max(...xsOf(t.pieces[0]!))).toBeGreaterThan(0);
  });

  it('moves the whole text to its position', () => {
    const t = lay({ text: 'I', position: [100, 50] });
    near(extent(xsOf(t.pieces[0]!)), [98.5, 100.5]); // the 2 mm bar, centred on its 3 mm advance
  });
});

describe('letters, pieces and textMeta', () => {
  it('gives every piece textMeta to rebuild the text, and the capital height for the underlay rule', () => {
    const spec = defaultTextSpec({ text: 'AB', font: 'Bars', capHeight: 4 });
    const t = layoutText(spec, bars, 7);
    for (const p of t.pieces) {
      const m = letterMeta(p as { textMeta: never })!;
      expect(m).toMatchObject({ textId: 7, capHeight: 4, spec });
    }
    expect(t.pieces.map((p) => letterMeta(p as { textMeta: never })!.char)).toEqual(['A', 'B']);
  });

  it('moves, scales and rotates single letters without moving the others', () => {
    const plain = lay({ text: 'III' });
    const moved = lay({ text: 'III', letters: { 1: { dx: 5, dy: -2, scale: 2, rotate: 0, slant: 0 } } });
    expect(moved.pieces[0]!.points).toEqual(plain.pieces[0]!.points);
    expect(moved.pieces[2]!.points).toEqual(plain.pieces[2]!.points);
    const [a, b] = extent(ysOf(moved.pieces[1]!));
    expect(b - a).toBeCloseTo(20, 6);
  });

  it('sews outline letters as fills (holes kept), outlines or columns', () => {
    const o = lay({ text: 'O', stitch: 'fill' });
    expect(o.pieces).toHaveLength(1);
    expect(o.pieces[0]!.holes).toHaveLength(1);
    expect(lay({ text: 'O', stitch: 'satin_fill' }).pieces[0]!.stitchType).toBe('satin_fill');
    const run = lay({ text: 'O', stitch: 'running' });
    expect(run.pieces.map((p) => p.stitchType)).toEqual(['running', 'running']);
    const sat = lay({ text: 'O', stitch: 'satin_outline' });
    expect(sat.pieces.every((p) => p.stitchType === 'satin' && p.closed)).toBe(true);
  });

  it('orders letters left to right, right to left or centre out', () => {
    expect(sewingOrder([0, 1, 2, 3, 4], 'ltr')).toEqual([0, 1, 2, 3, 4]);
    expect(sewingOrder([0, 1, 2, 3, 4], 'rtl')).toEqual([4, 3, 2, 1, 0]);
    expect(sewingOrder([0, 1, 2, 3, 4], 'centreOut')).toEqual([2, 3, 4, 1, 0]);
    expect(lay({ text: 'ABC', order: 'centreOut' }).letters.map((l) => l.char)).toEqual(['B', 'C', 'A']);
  });
});

describe('native fonts', () => {
  const font = createNativeFont('Sticks', { license: 'OFL', source: 'test' });
  const doc = createDocument();
  font.glyphs.I = {
    advance: 400,
    objects: [createObject(doc, { stitchType: 'satin', points: [pathNode(200, 0, 'corner', 120), pathNode(200, -1000, 'corner', 120)] })],
  };
  font.glyphs.T = {
    advance: 600,
    objects: [
      createObject(doc, { stitchType: 'satin', points: [pathNode(300, 0, 'corner', 100), pathNode(300, -1000, 'corner', 100)] }),
      createObject(doc, { stitchType: 'satin', points: [pathNode(0, -950, 'corner', 100), pathNode(600, -950, 'corner', 100)] }),
    ],
  };
  font.kerning.TI = -50;

  it('round-trips the .spf format', () => {
    const back = parseSpf(serializeSpf(font));
    expect(back).toMatchObject({ format: 'stitchpro-font', name: 'Sticks', capHeight: 1000, kerning: { TI: -50 } });
    expect(back.glyphs.T!.objects).toHaveLength(2);
    expect(back.glyphs.I!.objects[0]!.points[0]).toMatchObject({ x: 200, y: 0, width: 120 });
    expect(() => parseSpf('{"format":"other"}')).toThrow(/not a StitchPro font/);
  });

  it('lays out native letters with node widths scaled from font units', () => {
    const t = layoutText(defaultTextSpec({ text: 'I', capHeight: 20 }), nativeLetterFont(font), 1);
    expect(t.pieces[0]!.stitchType ?? t.pieces[0]!.settings?.stitchType).toBe('satin');
    expect(t.pieces[0]!.points![0]!.width).toBeCloseTo(2.4, 9); // 120 units at 0.02 mm/unit
    expect(layoutText(defaultTextSpec({ text: 'TI' }), nativeLetterFont(font), 1).width).toBeCloseTo((600 - 50 + 400) / 100, 9);
  });
});

describe('letter planning', () => {
  const opts = { trimThreshold: 3, joinDistance: 3 };
  const col = (x0: number, y0: number, x1: number, y1: number): NewObject => ({ stitchType: 'satin', points: [pathNode(x0, y0), pathNode(x1, y1)] });

  it('sews a letter strokes in the cheapest order and direction', () => {
    // Two strokes listed far end first: planning starts nearer and sews the next from its near end.
    const letter = [col(20, 0, 30, 0), col(0, 0, 10, 0)];
    const planned = planLetters([letter], opts);
    const ends = planned.map((p) => [p.points![0]!.x, p.points![1]!.x]);
    // Whichever stroke comes first, the second must start where the first ended (no trim).
    expect(Math.abs(ends[0]![1]! - ends[1]![0]!)).toBeLessThan(10.1);
    expect(planned).toHaveLength(2);
  });

  it('chooses directions across letters (dynamic programming)', () => {
    // Letter 2 is a column to the right; sewing it from its near end saves a long move.
    const planned = planLetters([[col(0, 0, 10, 0)], [col(30, 0, 12, 0)]], opts);
    expect(planned[0]!.points![1]!.x).toBe(10);
    expect(planned[1]!.points![0]!.x).toBe(12);
  });

  it('starts closed strokes from the best of 8 points round them', () => {
    const ring: NewObject = { stitchType: 'fill', closed: true, points: [pathNode(20, -5), pathNode(30, -5), pathNode(30, 5), pathNode(20, 5)] };
    const planned = planLetters([[col(0, 0, 19, 0)], [ring]], opts);
    expect(planned[1]!.fillStart).toEqual([20, 0]); // the left edge's middle, nearest the column's end
    expect(planned[1]!.autoEntry).toBe(false);
  });
});
