// Autosave: every open design tab is written to IndexedDB 1.5 s after it changes, and the
// saved tabs are restored when the app starts. Closing a tab forgets it.

import type { Editor } from '@stitchpro/editor';
import { loadProject, saveProject, type StitchDocument } from '@stitchpro/engine';
import type { FileTarget } from './saveFile';

export const AUTOSAVE_DELAY_MS = 1500;

const DB_NAME = 'stitchpro';
const STORE = 'autosave';

export interface SavedTab {
  key: number;
  name: string;
  sps: string;
  file: FileTarget;
  savedAt: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB is not available'));
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'key' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    dbPromise.catch(() => (dbPromise = null));
  }
  return dbPromise;
}

function request<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const req = run(db.transaction(STORE, mode).objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

/** Saved tabs, oldest first; unreadable entries are skipped. */
export async function loadAutosaved(): Promise<{ key: number; name: string; doc: StitchDocument; file: FileTarget }[]> {
  try {
    const all = (await request('readonly', (s) => s.getAll())) as SavedTab[];
    const out = [];
    for (const t of all.sort((a, b) => a.key - b.key)) {
      try {
        out.push({ key: t.key, name: t.name, doc: loadProject(t.sps), file: t.file ?? null });
      } catch {
        // a damaged entry: skip it
      }
    }
    return out;
  } catch {
    return [];
  }
}

async function put(tab: SavedTab): Promise<void> {
  try {
    await request('readwrite', (s) => s.put(tab));
  } catch {
    // A file handle the browser can't store: keep the design without it.
    try {
      await request('readwrite', (s) => s.put({ ...tab, file: null }));
    } catch {
      // storage unavailable or full: autosave is best effort
    }
  }
}

/** Forgets a tab's autosave (it was closed). */
export async function forgetAutosave(key: number): Promise<void> {
  try {
    await request('readwrite', (s) => s.delete(key));
  } catch {
    // nothing to forget
  }
}

/** Clears every autosaved tab (before the restored ones are saved under their new keys). */
export async function clearAutosave(): Promise<void> {
  try {
    await request('readwrite', (s) => s.clear());
  } catch {
    // nothing to clear
  }
}

/**
 * Saves a tab 1.5 s after each design change (and once now when it has content). Returns a
 * function that stops watching.
 */
export function watchAutosave(key: number, editor: Editor, describe: () => { name: string; file: FileTarget }): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let last = '';
  const save = () => {
    timer = null;
    const sps = saveProject(editor.doc);
    if (sps === last) return;
    last = sps;
    const { name, file } = describe();
    void put({ key, name, sps, file, savedAt: Date.now() });
  };
  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(save, AUTOSAVE_DELAY_MS);
  };
  const stop = editor.subscribe((kind) => {
    if (kind === 'base') schedule();
  });
  if (editor.doc.objects.length || editor.doc.artwork.length) schedule();
  return () => {
    stop();
    if (timer) clearTimeout(timer);
  };
}
