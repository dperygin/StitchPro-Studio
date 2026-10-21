// Artwork (tracing pictures): importing images and decoding them so Pick Color can read them.

import type { Editor } from '@stitchpro/editor';
import * as UTIF from 'utif2';
import { sanitizeSvg } from './svgImport';

/** Pictures are scaled down to at most this many pixels on their longer side. */
export const MAX_ARTWORK_PX = 4096;

const IMAGE_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  tif: 'image/tiff',
  tiff: 'image/tiff',
};

/** The file types the artwork picker offers. */
export const ARTWORK_ACCEPT = Object.keys(IMAGE_TYPES)
  .map((e) => `.${e}`)
  .join(',');

const extension = (name: string) => /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase() ?? '';

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('The picture could not be read'));
    img.src = src;
  });
}

/** Draws a picture into a canvas no larger than MAX_ARTWORK_PX and returns it as a PNG data URL. */
function toDataUrl(source: CanvasImageSource, width: number, height: number): { src: string; width: number; height: number } {
  const k = Math.min(1, MAX_ARTWORK_PX / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * k));
  canvas.height = Math.max(1, Math.round(height * k));
  canvas.getContext('2d')!.drawImage(source, 0, 0, canvas.width, canvas.height);
  return { src: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height };
}

/** A picture file as a PNG data URL (TIFF decoded with utif2; SVG sanitized first). */
export async function readPicture(file: File): Promise<{ src: string; width: number; height: number }> {
  const ext = extension(file.name);
  const type = IMAGE_TYPES[ext];
  if (!type) {
    throw new Error(`"${file.name}" is not a picture StitchPro can read. Save it as PNG, JPG, GIF, WebP, BMP, SVG or TIFF and import that.`);
  }
  if (ext === 'tif' || ext === 'tiff') {
    const buf = await file.arrayBuffer();
    const ifds = UTIF.decode(buf);
    const first = ifds[0];
    if (!first) throw new Error(`"${file.name}" has no picture in it`);
    UTIF.decodeImage(buf, first);
    const rgba = UTIF.toRGBA8(first);
    const canvas = document.createElement('canvas');
    canvas.width = first.width;
    canvas.height = first.height;
    canvas.getContext('2d')!.putImageData(new ImageData(Uint8ClampedArray.from(rgba), first.width, first.height), 0, 0);
    return toDataUrl(canvas, canvas.width, canvas.height);
  }
  let url: string;
  if (ext === 'svg') {
    const clean = sanitizeSvg(await file.text());
    url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(clean)}`;
  } else url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const w = img.naturalWidth || 1024;
    const h = img.naturalHeight || 1024;
    return toDataUrl(img, w, h);
  } finally {
    if (url.startsWith('blob:')) URL.revokeObjectURL(url);
  }
}

/** Imports picture files as artwork; refused files are reported in the status bar. */
export async function importArtworkFiles(editor: Editor, files: readonly File[]): Promise<number> {
  let added = 0;
  const refused: string[] = [];
  for (const f of files) {
    try {
      const pic = await readPicture(f);
      editor.addArtwork(f.name, pic.src, pic.width, pic.height);
      added++;
    } catch (e) {
      refused.push((e as Error).message);
    }
  }
  editor.setStatus(refused.length ? refused.join(' ') : `Imported ${added} picture${added === 1 ? '' : 's'}`);
  return added;
}

const decoding = new WeakMap<Editor, Set<number>>();

/** Decodes every artwork picture the editor has no pixels for yet (once each). */
export function decodeArtwork(editor: Editor): void {
  let busy = decoding.get(editor);
  if (!busy) decoding.set(editor, (busy = new Set()));
  for (const a of editor.doc.artwork) {
    if (editor.artworkPixels.has(a.id) || busy.has(a.id)) continue;
    busy.add(a.id);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (ctx && canvas.width && canvas.height) {
        ctx.drawImage(img, 0, 0);
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
        editor.setArtworkPixels(a.id, { width: data.width, height: data.height, data: data.data });
      }
      busy.delete(a.id);
    };
    img.onerror = () => busy.delete(a.id);
    img.src = a.src;
  }
}
