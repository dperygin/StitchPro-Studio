// Drafts the bundled native fonts (web/src/spf/*.spf) from the open-licensed (SIL OFL 1.1)
// fonts in @fontsource. Run: npm run fonts:draft
//
// The drafts are what the font editor's "Draft from" makes; refine them in the font editor.

import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createNativeFont } from '../engine/src/index';
import { FontEditorSession, readFontFile } from '../editor/src/index';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'web', 'src', 'spf');

const SOURCES = [
  { pkg: 'roboto', file: 'roboto-latin-400-normal.woff', from: 'Roboto', name: 'StitchPro Sans', sizeRange: [6, 60] as [number, number] },
  { pkg: 'oswald', file: 'oswald-latin-400-normal.woff', from: 'Oswald', name: 'StitchPro Condensed', sizeRange: [6, 60] as [number, number] },
  { pkg: 'pacifico', file: 'pacifico-latin-400-normal.woff', from: 'Pacifico', name: 'StitchPro Script', sizeRange: [8, 80] as [number, number] },
];

for (const s of SOURCES) {
  const dir = join(root, 'node_modules', '@fontsource', s.pkg);
  const buf = readFileSync(join(dir, 'files', s.file));
  const source = { ...readFontFile(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, s.file).letterFont, name: s.from };
  const copyright = readFileSync(join(dir, 'LICENSE'), 'utf8').split(/\r?\n/)[0]!.trim();
  const font = createNativeFont(s.name, {
    license: `SIL Open Font License 1.1. ${copyright} Drafted for StitchPro from ${s.from}; see ${s.pkg}-OFL.txt.`,
    source: `${s.from} (@fontsource/${s.pkg})`,
    sizeRange: s.sizeRange,
  });
  const session = new FontEditorSession(font);
  const n = session.draftFrom(source);
  const target = join(out, `${s.name}.spf`);
  writeFileSync(target, session.toSpf());
  copyFileSync(join(dir, 'LICENSE'), join(out, `${s.pkg}-OFL.txt`));
  console.log(`${s.name}: ${n} letters from ${s.from} -> ${target}`);
}
