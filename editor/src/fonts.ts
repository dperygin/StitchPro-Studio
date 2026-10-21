/// <reference path="./opentype.d.ts" />
// Font library: TrueType/OpenType via opentype.js plus native .spf fonts. One library is
// shared by every open design tab.

import { parse, type Font } from 'opentype.js';

export function readFontFile(buffer: ArrayBuffer): Font {
  return parse(buffer);
}

export class FontLibrary {
  /** TrueType/OpenType fonts by family name. */
  readonly outlineFonts = new Map<string, Font>();
  /** Native .spf fonts (parsed JSON) by name. */
  readonly nativeFonts = new Map<string, unknown>();

  addOutlineFont(name: string, font: Font): void {
    this.outlineFonts.set(name, font);
  }

  addNativeFont(name: string, font: unknown): void {
    this.nativeFonts.set(name, font);
  }

  /** Native fonts first, then TrueType/OpenType. */
  names(): string[] {
    return [...this.nativeFonts.keys(), ...this.outlineFonts.keys()];
  }
}
