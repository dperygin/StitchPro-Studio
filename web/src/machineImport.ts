// Machine file import: the server reads the file; each run becomes a Manual object.

import { importedDesign, type MachineFileData, type StitchDocument } from '@stitchpro/engine';

/** Machine formats the server reads. */
export const MACHINE_FORMATS = ['dst', 'pes', 'exp', 'jef', 'vp3', 'xxx'] as const;

export const MACHINE_ACCEPT = MACHINE_FORMATS.map((f) => `.${f}`).join(',');

/** Reads a machine file through the server into a new design. */
export async function readMachineFile(file: File): Promise<StitchDocument> {
  const ext = /\.([a-z0-9]+)$/i.exec(file.name)?.[1]?.toLowerCase() ?? '';
  if (!(MACHINE_FORMATS as readonly string[]).includes(ext)) {
    throw new Error(`"${file.name}" is not a machine file StitchPro reads (${MACHINE_FORMATS.map((f) => f.toUpperCase()).join(', ')}).`);
  }
  const res = await fetch(`/api/import/${ext}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: await file.arrayBuffer() });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(`Import failed: ${typeof detail.detail === 'string' ? detail.detail : res.statusText}`);
  }
  const data = (await res.json()) as MachineFileData;
  return importedDesign(data, file.name.replace(/\.[^.]+$/, ''));
}
