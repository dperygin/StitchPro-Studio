/// <reference path="./opentype.d.ts" />
// Font library: TrueType/OpenType/WOFF fonts via opentype.js plus native .spf fonts. One
// library is shared by every open design tab.

import * as opentype from 'opentype.js';
import type { Font } from 'opentype.js';
import { flattenBezier, nativeLetterFont, parseSpf, type LetterFont, type NativeFont, type Point } from '@stitchpro/engine';

/** opentype.js parse, whichever build was loaded (ES module in the browser, CommonJS in Node). */
const parseFont = (buffer: ArrayBuffer): Font => {
  const ns = opentype as unknown as { parse?: typeof opentype.parse; default?: { parse: typeof opentype.parse } };
  return (ns.parse ?? ns.default!.parse)(buffer);
};

/**
 * A TrueType/OpenType font as a lettering source: glyph outlines as closed contours in font
 * units (baseline y = 0, y down), flattened once per character.
 */
export function outlineLetterFont(name: string, font: Font): LetterFont {
  const cache = new Map<string, ReturnType<LetterFont['glyph']>>();
  const os2 = (font as unknown as { tables?: { os2?: { sCapHeight?: number } } }).tables?.os2;
  let capHeight = os2?.sCapHeight ?? 0;
  if (!(capHeight > 0)) {
    // Measure the H.
    const ys = font.charToGlyph('H').getPath(0, 0, font.unitsPerEm).commands.map((c) => c.y ?? 0);
    capHeight = Math.max(1, -Math.min(0, ...ys)) || font.unitsPerEm * 0.7;
  }
  const resolution = font.unitsPerEm / 400;
  const glyph = (ch: string) => {
    if (cache.has(ch)) return cache.get(ch)!;
    const g = font.charToGlyph(ch);
    let result: ReturnType<LetterFont['glyph']> = null;
    if (g && (g as unknown as { index: number }).index !== 0) {
      const contours: Point[][] = [];
      let cur: Point[] = [];
      let at: Point = [0, 0];
      for (const c of g.getPath(0, 0, font.unitsPerEm).commands) {
        if (c.type === 'M') {
          if (cur.length > 2) contours.push(cur);
          at = [c.x!, c.y!];
          cur = [at];
        } else if (c.type === 'L') {
          at = [c.x!, c.y!];
          cur.push(at);
        } else if (c.type === 'Q') {
          const pts = flattenBezier([at, [c.x1!, c.y1!], [c.x!, c.y!]], resolution);
          cur.push(...pts.slice(1));
          at = [c.x!, c.y!];
        } else if (c.type === 'C') {
          const pts = flattenBezier([at, [c.x1!, c.y1!], [c.x2!, c.y2!], [c.x!, c.y!]], resolution);
          cur.push(...pts.slice(1));
          at = [c.x!, c.y!];
        } else if (c.type === 'Z') {
          if (cur.length > 2) contours.push(cur);
          cur = [];
        }
      }
      if (cur.length > 2) contours.push(cur);
      result = { advance: g.advanceWidth ?? font.unitsPerEm * 0.5, contours };
    }
    cache.set(ch, result);
    return result;
  };
  return {
    name,
    native: false,
    capHeight,
    glyph,
    kerning: (a, b) => font.getKerningValue(font.charToGlyph(a), font.charToGlyph(b)) || 0,
    chars: () => {
      const out: string[] = [];
      const glyphs = (font as unknown as { glyphs: { length: number; get(i: number): { unicode?: number } } }).glyphs;
      for (let i = 0; i < glyphs.length; i++) {
        const u = glyphs.get(i).unicode;
        if (u !== undefined && u > 32) out.push(String.fromCodePoint(u));
      }
      return out;
    },
  };
}

/** Reads a font file: .spf (native), .ttf, .otf or .woff (WOFF2 cannot be read). */
export function readFontFile(buffer: ArrayBuffer, fileName = ''): { name: string; letterFont: LetterFont; native: NativeFont | null } {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.woff2')) throw new Error('WOFF2 fonts cannot be read; use a .ttf, .otf or .woff file');
  if (lower.endsWith('.spf')) {
    const native = parseSpf(new TextDecoder().decode(buffer));
    return { name: native.name, letterFont: nativeLetterFont(native), native };
  }
  const font = parseFont(buffer);
  const name = font.names.fontFamily?.en ?? fileName.replace(/\.(ttf|otf|woff)$/i, '') ?? 'Font';
  return { name, letterFont: outlineLetterFont(name, font), native: null };
}

export class FontLibrary {
  private fonts = new Map<string, LetterFont>();
  /** Native fonts' data (for the font editor). */
  readonly native = new Map<string, NativeFont>();
  private listeners = new Set<() => void>();

  /** Adds (or replaces) a lettering source. */
  add(font: LetterFont): void {
    this.fonts.set(font.name, font);
    for (const l of this.listeners) l();
  }

  addNative(font: NativeFont): void {
    this.native.set(font.name, font);
    this.add(nativeLetterFont(font));
  }

  addOutlineFont(name: string, font: Font): void {
    this.add(outlineLetterFont(name, font));
  }

  get(name: string): LetterFont | undefined {
    return this.fonts.get(name);
  }

  /** Native fonts first, then outline fonts, each alphabetical. */
  names(): string[] {
    const all = [...this.fonts.values()];
    const sort = (a: LetterFont, b: LetterFont) => a.name.localeCompare(b.name);
    return [...all.filter((f) => f.native).sort(sort), ...all.filter((f) => !f.native).sort(sort)].map((f) => f.name);
  }

  /** Notified when fonts are added (font lists re-render). */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
