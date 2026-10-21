/// <reference path="./opentype.d.ts" />
// Font library: TrueType/OpenType via opentype.js plus native .spf fonts.

import { parse, type Font } from 'opentype.js';

export function readFontFile(buffer: ArrayBuffer): Font {
  return parse(buffer);
}
