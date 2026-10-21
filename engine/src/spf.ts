// Native .spf font format (JSON):
// { format "stitchpro-font", version, name, license, source, capHeight 1000, sizeRange [min, max]
//   mm, glyphs { char: { advance, objects } }, kerning { pair: units } }.
// Glyph objects are in font units (baseline y = 0, y down; capital height 1000); node widths are
// in font units, every other setting in mm.

import type { StitchObject } from './document';
import { defaultSettings } from './types';
import { objectFromJson, objectToJson, ProjectError, type Json } from './project';
import type { GlyphShape, LetterFont } from './text';

export const SPF_FORMAT = 'stitchpro-font';
export const SPF_VERSION = 1;
export const SPF_CAP_HEIGHT = 1000;

export interface SpfGlyph {
  /** Advance width, font units. */
  advance: number;
  /** Objects in font units. */
  objects: StitchObject[];
}

export interface NativeFont {
  format: typeof SPF_FORMAT;
  version: number;
  name: string;
  license: string;
  source: string;
  capHeight: number;
  /** Capital heights the font sews well at, mm. */
  sizeRange: [number, number];
  glyphs: Record<string, SpfGlyph>;
  /** Pair (two characters) -> adjustment in font units. */
  kerning: Record<string, number>;
}

export function createNativeFont(name: string, init: Partial<Omit<NativeFont, 'format'>> = {}): NativeFont {
  return {
    format: SPF_FORMAT,
    version: SPF_VERSION,
    name,
    license: '',
    source: '',
    capHeight: SPF_CAP_HEIGHT,
    sizeRange: [5, 50],
    glyphs: {},
    kerning: {},
    ...init,
  };
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, def: number) => (typeof v === 'number' && Number.isFinite(v) ? v : def);

/** Parses .spf text (or its parsed JSON). Throws ProjectError with a readable message. */
export function parseSpf(input: string | unknown): NativeFont {
  let data: unknown = input;
  if (typeof input === 'string') {
    try {
      data = JSON.parse(input);
    } catch (e) {
      throw new ProjectError(`This is not a valid StitchPro font (${(e as Error).message}).`);
    }
  }
  if (!isObj(data) || data.format !== SPF_FORMAT) throw new ProjectError('This is not a StitchPro font (format must be "stitchpro-font").');
  const glyphs: Record<string, SpfGlyph> = {};
  if (isObj(data.glyphs)) {
    for (const [ch, g] of Object.entries(data.glyphs)) {
      if (!isObj(g) || [...ch].length !== 1) continue;
      glyphs[ch] = {
        advance: num(g.advance, 0),
        objects: (Array.isArray(g.objects) ? g.objects : []).map((o, i) => objectFromJson(o, `Glyph "${ch}" object ${i + 1}`)),
      };
    }
  }
  const kerning: Record<string, number> = {};
  if (isObj(data.kerning)) for (const [pair, v] of Object.entries(data.kerning)) if ([...pair].length === 2 && typeof v === 'number') kerning[pair] = v;
  const range = Array.isArray(data.sizeRange) && data.sizeRange.length === 2 ? data.sizeRange : [5, 50];
  return {
    format: SPF_FORMAT,
    version: num(data.version, SPF_VERSION),
    name: typeof data.name === 'string' ? data.name : 'Untitled font',
    license: typeof data.license === 'string' ? data.license : '',
    source: typeof data.source === 'string' ? data.source : '',
    capHeight: num(data.capHeight, SPF_CAP_HEIGHT),
    sizeRange: [num(range[0], 5), num(range[1], 50)],
    glyphs,
    kerning,
  };
}

/**
 * A glyph object as compact JSON: settings equal to the defaults are left out (loading fills
 * them back in) and coordinates are rounded to 0.01 font units.
 */
function glyphObjectJson(o: StitchObject): Json {
  const full = objectToJson(o) as Record<string, Json>;
  const defaults = objectToJson({ ...o, settings: defaultSettings() }) as Record<string, Record<string, Json>>;
  const settings = full.settings as Record<string, Json>;
  full.settings = Object.fromEntries(Object.entries(settings).filter(([k, v]) => v !== defaults.settings![k]));
  const round = (v: Json): Json =>
    typeof v === 'number' ? Math.round(v * 100) / 100 : Array.isArray(v) ? v.map(round) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, round(x)])) : v;
  for (const key of ['points', 'holes', 'rail2', 'fill_start', 'fill_end', 'stitch_angles', 'custom_stitches']) full[key] = round(full[key] ?? null);
  // Ids mean nothing inside a font (loading assigns new ones).
  delete full.id;
  return full;
}

/** The font as .spf JSON text. */
export function serializeSpf(font: NativeFont): string {
  const glyphs: Record<string, Json> = {};
  for (const [ch, g] of Object.entries(font.glyphs)) glyphs[ch] = { advance: g.advance, objects: g.objects.map(glyphObjectJson) };
  const head = {
    format: SPF_FORMAT,
    version: font.version,
    name: font.name,
    license: font.license,
    source: font.source,
    capHeight: font.capHeight,
    sizeRange: font.sizeRange,
  };
  // Readable at the top level; one compact line per glyph.
  const lines = Object.entries(head).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`);
  const glyphLines = Object.entries(glyphs).map(([ch, g]) => `    ${JSON.stringify(ch)}: ${JSON.stringify(g)}`);
  lines.push(`  "glyphs": {\n${glyphLines.join(',\n')}\n  }`);
  lines.push(`  "kerning": ${JSON.stringify(font.kerning)}`);
  return `{\n${lines.join(',\n')}\n}\n`;
}

/** A native font as a lettering source. */
export function nativeLetterFont(font: NativeFont): LetterFont {
  return {
    name: font.name,
    native: true,
    capHeight: font.capHeight,
    glyph: (ch): GlyphShape | null => {
      const g = font.glyphs[ch];
      return g ? { advance: g.advance, objects: g.objects } : null;
    },
    kerning: (a, b) => font.kerning[a + b] ?? 0,
    chars: () => Object.keys(font.glyphs),
  };
}
