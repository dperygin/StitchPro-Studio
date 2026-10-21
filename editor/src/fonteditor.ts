// Font editing session: edit a native font letter by letter at 40 mm capital height, with guide
// lines (baseline, x-height, capital height, descender, advance), kerning, a test line, and
// drafts from a TrueType font.

import {
  autodigitize,
  createDocument,
  createNativeFont,
  createObject,
  defaultTextSpec,
  douglasPeucker,
  layoutText,
  nativeLetterFont,
  nestRings,
  pathNode,
  serializeSpf,
  type AutoDigitizeOptions,
  type LetterFont,
  type NativeFont,
  type NewObject,
  type PathNode,
  type StitchObject,
} from '@stitchpro/engine';
import { Clipboard, Editor } from './editor';
import type { FontLibrary } from './fonts';

/** Letters are edited at this capital height, mm. */
export const FONT_EDIT_CAP_MM = 40;

/** The characters a new font offers. */
export const FONT_CHARS = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789&!?.,:;\'"-()@#'];

export class FontEditorSession {
  readonly font: NativeFont;
  char: string;
  /** The editor showing the current letter (a new one for each letter). */
  editor: Editor;
  private listeners = new Set<() => void>();

  constructor(
    font: NativeFont = createNativeFont('New font'),
    private readonly opts: { fonts?: FontLibrary; clipboard?: Clipboard } = {},
  ) {
    this.font = font;
    this.char = Object.keys(font.glyphs)[0] ?? 'A';
    this.editor = this.makeEditor(this.char);
  }

  /** mm per font unit while editing. */
  get k(): number {
    return FONT_EDIT_CAP_MM / this.font.capHeight;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const l of this.listeners) l();
  }

  advance(ch = this.char): number {
    return this.font.glyphs[ch]?.advance ?? Math.round(this.font.capHeight * 0.6);
  }

  private makeEditor(ch: string): Editor {
    const k = this.k;
    const cap = FONT_EDIT_CAP_MM;
    const adv = this.advance(ch) * k;
    const doc = createDocument({
      name: `${this.font.name} - ${ch}`,
      hoopWidth: Math.max(120, adv * 2 + 40),
      hoopHeight: 100,
      closestJoin: false,
      guides: [
        { axis: 'h', pos: 0 }, // baseline
        { axis: 'h', pos: -cap }, // capital height
        { axis: 'h', pos: -cap * 0.7 }, // x-height
        { axis: 'h', pos: cap * 0.25 }, // descender
        { axis: 'v', pos: 0 },
        { axis: 'v', pos: adv }, // advance
      ],
    });
    const scale = (n: PathNode): PathNode => ({ ...n, x: n.x * k, y: n.y * k, width: n.width === null ? null : n.width * k });
    for (const o of this.font.glyphs[ch]?.objects ?? []) {
      doc.objects.push(
        createObject(doc, {
          ...structuredClone(o),
          points: o.points.map(scale),
          holes: o.holes.map((h) => h.map(scale)),
          rail2: o.rail2.map(scale),
          fillStart: o.fillStart ? [o.fillStart[0] * k, o.fillStart[1] * k] : null,
          fillEnd: o.fillEnd ? [o.fillEnd[0] * k, o.fillEnd[1] * k] : null,
        }),
      );
    }
    const ed = new Editor(doc, { fonts: this.opts.fonts, clipboard: this.opts.clipboard });
    ed.subscribe(() => this.notify());
    return ed;
  }

  /** Writes the letter being edited back into the font (font units). */
  store(): void {
    const k = this.k;
    const unscale = (n: PathNode): PathNode => ({ ...n, x: n.x / k, y: n.y / k, width: n.width === null ? null : n.width / k });
    const objects: StitchObject[] = this.editor.doc.objects.map((o) => ({
      ...structuredClone(o),
      points: o.points.map(unscale),
      holes: o.holes.map((h) => h.map(unscale)),
      rail2: o.rail2.map(unscale),
      fillStart: o.fillStart ? [o.fillStart[0] / k, o.fillStart[1] / k] : null,
      fillEnd: o.fillEnd ? [o.fillEnd[0] / k, o.fillEnd[1] / k] : null,
      textMeta: null,
    }));
    if (objects.length || this.font.glyphs[this.char]) this.font.glyphs[this.char] = { advance: this.advance(), objects };
  }

  /** Switches to another letter (storing the current one first). */
  open(ch: string): void {
    this.store();
    this.char = ch;
    this.editor.dispose();
    this.editor = this.makeEditor(ch);
    this.notify();
  }

  setAdvance(units: number): void {
    this.store();
    this.font.glyphs[this.char] = { advance: Math.max(0, Math.round(units)), objects: this.font.glyphs[this.char]?.objects ?? [] };
    const ed = this.editor;
    ed.doc.guides = ed.doc.guides.map((g, i) => (i === ed.doc.guides.length - 1 ? { ...g, pos: units * this.k } : g));
    ed.changed('base');
    this.notify();
  }

  /** Kerning for a pair of characters, font units (0 removes it). */
  setKerning(pair: string, units: number): void {
    if ([...pair].length !== 2) return;
    if (units) this.font.kerning[pair] = Math.round(units);
    else delete this.font.kerning[pair];
    this.notify();
  }

  /**
   * Drafts letters from an outline font: each glyph auto-digitized into satin columns, scaled
   * to the native capital height. Drafts are meant to be fixed by hand.
   */
  draftFrom(source: LetterFont, chars: readonly string[] = FONT_CHARS, opts: AutoDigitizeOptions = {}): number {
    this.store();
    const f = this.font.capHeight / source.capHeight;
    let made = 0;
    const scratch = createDocument();
    for (const ch of chars) {
      const g = source.glyph(ch);
      if (!g?.contours?.length) continue;
      // Draft satin columns from the outline (fix them by hand afterwards).
      const scaled = (n: PathNode): PathNode => ({ ...n, x: n.x * f, y: n.y * f, width: n.width === null ? null : n.width * f });
      const objects = autodigitize(g.contours, source.capHeight, opts).map((o) =>
        createObject(scratch, {
          ...o,
          points: (o.points ?? []).map(scaled),
          rail2: (o.rail2 ?? []).map(scaled),
          holes: (o.holes ?? []).map((h) => h.map(scaled)),
        }),
      );
      this.font.glyphs[ch] = { advance: Math.round(g.advance * f), objects };
      made++;
    }
    for (const a of chars) {
      for (const b of chars) {
        const v = source.kerning(a, b);
        if (v) this.font.kerning[a + b] = Math.round(v * f);
      }
    }
    if (!this.font.source) this.font.source = source.name;
    this.editor.dispose();
    this.editor = this.makeEditor(this.char);
    this.notify();
    return made;
  }

  /** The test line laid out in this font (pieces in mm). */
  testLine(text: string, capHeight = 10): NewObject[] {
    this.store();
    return layoutText(defaultTextSpec({ text, font: this.font.name, capHeight }), nativeLetterFont(this.font), 0).pieces;
  }

  /** The font as .spf text (current letter included). */
  toSpf(): string {
    this.store();
    return serializeSpf(this.font);
  }
}
