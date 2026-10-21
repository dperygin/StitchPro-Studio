// Save / Save as / Open for .sps design files. Uses the File System Access API where the
// browser has it, otherwise a download and a file input.

import { loadProject, saveProject, type StitchDocument } from '@stitchpro/engine';

/** A saved file the next Save writes to again (when the browser supports it). */
export type FileTarget = FileSystemFileHandle | null;

interface PickerWindow {
  showSaveFilePicker?: (opts: unknown) => Promise<FileSystemFileHandle>;
  showOpenFilePicker?: (opts: unknown) => Promise<FileSystemFileHandle[]>;
}

const SPS_TYPES = [{ description: 'StitchPro design', accept: { 'application/json': ['.sps'] } }];

export function download(name: string, data: BlobPart, type = 'application/octet-stream'): void {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Saves a design; returns where it went (for the next Save). */
export async function saveDesign(doc: StitchDocument, target: FileTarget, saveAs: boolean): Promise<FileTarget> {
  const text = saveProject(doc);
  const w = window as unknown as PickerWindow;
  let handle = saveAs ? null : target;
  if (!handle && w.showSaveFilePicker) {
    try {
      handle = await w.showSaveFilePicker({ suggestedName: `${doc.name || 'design'}.sps`, types: SPS_TYPES });
    } catch {
      return target; // cancelled
    }
  }
  if (handle) {
    const stream = await handle.createWritable();
    await stream.write(text);
    await stream.close();
    return handle;
  }
  download(`${doc.name || 'design'}.sps`, text, 'application/json');
  return null;
}

/** Lets the user pick files; resolves with them (empty when cancelled). */
export function pickFiles(accept: string, multiple = false): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    input.addEventListener('change', () => resolve([...(input.files ?? [])]));
    input.addEventListener('cancel', () => resolve([]));
    input.click();
  });
}

/** Opens .sps files: each becomes a document (loading errors are thrown with readable messages). */
export async function openDesigns(): Promise<{ doc: StitchDocument; name: string }[]> {
  const files = await pickFiles('.sps', true);
  const out = [];
  for (const f of files) {
    const doc = loadProject(await f.text());
    if (!doc.name || doc.name === 'Untitled') doc.name = f.name.replace(/\.sps$/i, '');
    out.push({ doc, name: f.name });
  }
  return out;
}
