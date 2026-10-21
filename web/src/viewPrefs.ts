// Preferences kept in localStorage: units, grid, snap, rulers, SimStitch, machine commands,
// stitch list and player speed. Storage can be missing or blocked, so every access is guarded.

import type { Editor, Units } from '@stitchpro/editor';

const KEY = 'stitchpro.prefs';

export interface Prefs {
  units: Units;
  showGrid: boolean;
  gridSpacing: number;
  snap: boolean;
  showRulers: boolean;
  simStitch: boolean;
  showMarks: boolean;
  stitchListOpen: boolean;
  playerSpeed: number;
}

function read(): Partial<Prefs> {
  try {
    const raw = localStorage.getItem(KEY);
    const v = raw ? (JSON.parse(raw) as unknown) : null;
    return v && typeof v === 'object' ? (v as Partial<Prefs>) : {};
  } catch {
    return {};
  }
}

function write(p: Prefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // storage blocked or full: preferences just aren't remembered
  }
}

const current = (ed: Editor): Prefs => ({
  units: ed.units,
  showGrid: ed.showGrid,
  gridSpacing: ed.gridSpacing,
  snap: ed.snap,
  showRulers: ed.showRulers,
  simStitch: ed.simStitch,
  showMarks: ed.showMarks,
  stitchListOpen: ed.stitchListOpen,
  playerSpeed: ed.player.speed,
});

/** Applies the saved preferences to an editor. */
export function applyPrefs(ed: Editor): void {
  const p = read();
  if (p.units === 'mm' || p.units === 'in') ed.units = p.units;
  if (typeof p.gridSpacing === 'number' && p.gridSpacing > 0) ed.gridSpacing = p.gridSpacing;
  if (typeof p.playerSpeed === 'number' && p.playerSpeed > 0) ed.player.speed = p.playerSpeed;
  for (const k of ['showGrid', 'snap', 'showRulers', 'simStitch', 'showMarks', 'stitchListOpen'] as const) if (typeof p[k] === 'boolean') ed[k] = p[k];
}

/** Remembers an editor's preferences whenever they change. Returns a function that stops. */
export function watchPrefs(ed: Editor): () => void {
  let last = JSON.stringify(current(ed));
  return ed.subscribe(() => {
    const now = current(ed);
    const text = JSON.stringify(now);
    if (text === last) return;
    last = text;
    write(now);
  });
}
