// Bundled fonts: open-licensed (SIL OFL) outline fonts from @fontsource, and the native .spf
// fonts drafted from them (src/spf/). Both are loaded lazily into the shared font library.

import { parseSpf } from '@stitchpro/engine';
import { readFontFile, type FontLibrary } from '@stitchpro/editor';
import robotoWoff from '@fontsource/roboto/files/roboto-latin-400-normal.woff?url';
import oswaldWoff from '@fontsource/oswald/files/oswald-latin-400-normal.woff?url';
import pacificoWoff from '@fontsource/pacifico/files/pacifico-latin-400-normal.woff?url';

export interface BundledFont {
  family: string;
  url: string;
  /** CSS font family for previews in the UI. */
  css: string;
}

export const bundledFonts: BundledFont[] = [
  { family: 'Roboto', url: robotoWoff, css: 'Roboto' },
  { family: 'Oswald', url: oswaldWoff, css: 'Oswald' },
  { family: 'Pacifico', url: pacificoWoff, css: 'Pacifico' },
];

const nativeFiles = import.meta.glob<string>('./spf/*.spf', { query: '?raw', import: 'default' });

let loading: Promise<void> | null = null;

/** Loads every bundled font into the library (once). */
export function loadBundledFonts(library: FontLibrary): Promise<void> {
  loading ??= (async () => {
    await Promise.all([
      ...Object.values(nativeFiles).map(async (load) => {
        try {
          library.addNative(parseSpf(await load()));
        } catch (e) {
          console.warn('A bundled native font could not be read', e);
        }
      }),
      ...bundledFonts.map(async (f) => {
        try {
          const buf = await (await fetch(f.url)).arrayBuffer();
          library.add({ ...readFontFile(buf, `${f.family}.woff`).letterFont, name: f.family });
        } catch (e) {
          console.warn(`The font ${f.family} could not be loaded`, e);
        }
      }),
    ]);
  })();
  return loading;
}

/** Loads a font file the user picked (.spf, .ttf, .otf, .woff); returns its name. */
export async function loadFontFile(library: FontLibrary, file: File): Promise<string> {
  const { name, letterFont, native } = readFontFile(await file.arrayBuffer(), file.name);
  if (native) library.addNative(native);
  else library.add({ ...letterFont, name });
  return name;
}
