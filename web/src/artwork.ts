// Reading pictures: decodes artwork images so Pick Color can average their pixels.

import type { Editor } from '@stitchpro/editor';

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
