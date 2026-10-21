// Thread charts (.tch / .clr) and colour matching.
//
// Chart lines are CSV: code, chart, colour name, thread type (A-D or empty), R, G, B. Names may
// contain commas, and some charts add more fields after the colour.

import type { RGB } from './types';

export interface Thread {
  code: string;
  brand: string;
  name: string;
  /** Thread type A-D ('' when the chart doesn't say). */
  type: string;
  rgb: RGB;
}

const TYPE = /^[A-D]?$/i;
const isChannel = (f: string | undefined) => f !== undefined && /^\s*\d{1,3}\s*$/.test(f) && Number(f) <= 255;

/** Parses one chart line, or null when it isn't a thread. */
export function parseThreadLine(line: string): Thread | null {
  const f = line.split(',');
  // The colour is the first type field followed by three 0-255 numbers (after code and chart).
  for (let i = 4; i + 2 < f.length; i++) {
    if (TYPE.test(f[i - 1]!.trim()) && isChannel(f[i]) && isChannel(f[i + 1]) && isChannel(f[i + 2])) {
      const code = f[0]!.trim();
      if (!code) return null;
      return {
        code,
        brand: f[1]!.trim(),
        name: f.slice(2, i - 1).join(',').trim(),
        type: f[i - 1]!.trim().toUpperCase(),
        rgb: [Number(f[i]), Number(f[i + 1]), Number(f[i + 2])],
      };
    }
  }
  return null;
}

export function parseThreadChart(text: string): Thread[] {
  const out: Thread[] = [];
  for (const line of text.split(/\r?\n/)) {
    const t = parseThreadLine(line);
    if (t) out.push(t);
  }
  return out;
}

// ---- colour science ----

export type Lab = [number, number, number];

/** sRGB (0-255) to CIELAB with the D65 white point. */
export function srgbToLab(rgb: RGB): Lab {
  const lin = rgb.map((c) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  const [r, g, b] = lin as [number, number, number];
  // sRGB -> XYZ (D65), normalised by the D65 white.
  const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
  const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  const z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** The CIEDE2000 colour difference between two CIELAB colours (kL = kC = kH = 1). */
export function deltaE2000(lab1: Lab, lab2: Lab): number {
  const [L1, a1, b1] = lab1;
  const [L2, a2, b2] = lab2;
  const rad = Math.PI / 180;
  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const Cbar = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cbar ** 7 / (Cbar ** 7 + 25 ** 7)));
  const a1p = (1 + G) * a1;
  const a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1);
  const C2p = Math.hypot(a2p, b2);
  const hue = (b: number, a: number) => {
    if (b === 0 && a === 0) return 0;
    const h = Math.atan2(b, a) / rad;
    return h < 0 ? h + 360 : h;
  };
  const h1p = hue(b1, a1p);
  const h2p = hue(b2, a2p);
  const dLp = L2 - L1;
  const dCp = C2p - C1p;
  let dhp = 0;
  if (C1p * C2p !== 0) {
    dhp = h2p - h1p;
    if (dhp > 180) dhp -= 360;
    else if (dhp < -180) dhp += 360;
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp / 2) * rad);
  const Lbarp = (L1 + L2) / 2;
  const Cbarp = (C1p + C2p) / 2;
  let hbarp = h1p + h2p;
  if (C1p * C2p !== 0) {
    if (Math.abs(h1p - h2p) <= 180) hbarp = (h1p + h2p) / 2;
    else hbarp = h1p + h2p < 360 ? (h1p + h2p + 360) / 2 : (h1p + h2p - 360) / 2;
  }
  const T =
    1 -
    0.17 * Math.cos((hbarp - 30) * rad) +
    0.24 * Math.cos(2 * hbarp * rad) +
    0.32 * Math.cos((3 * hbarp + 6) * rad) -
    0.2 * Math.cos((4 * hbarp - 63) * rad);
  const dTheta = 30 * Math.exp(-(((hbarp - 275) / 25) ** 2));
  const Rc = 2 * Math.sqrt(Cbarp ** 7 / (Cbarp ** 7 + 25 ** 7));
  const Sl = 1 + (0.015 * (Lbarp - 50) ** 2) / Math.sqrt(20 + (Lbarp - 50) ** 2);
  const Sc = 1 + 0.045 * Cbarp;
  const Sh = 1 + 0.015 * Cbarp * T;
  const Rt = -Math.sin(2 * dTheta * rad) * Rc;
  return Math.sqrt((dLp / Sl) ** 2 + (dCp / Sc) ** 2 + (dHp / Sh) ** 2 + Rt * (dCp / Sc) * (dHp / Sh));
}

/** ΔE 2000 between two sRGB colours. */
export function colourDifference(a: RGB, b: RGB): number {
  return deltaE2000(srgbToLab(a), srgbToLab(b));
}

export interface ThreadMatch {
  thread: Thread;
  deltaE: number;
}

/** The chart's thread closest to a colour (CIEDE2000), or null for an empty chart. */
export function nearestThread(rgb: RGB, threads: readonly Thread[]): ThreadMatch | null {
  const lab = srgbToLab(rgb);
  let best: ThreadMatch | null = null;
  for (const t of threads) {
    const d = deltaE2000(lab, srgbToLab(t.rgb));
    if (!best || d < best.deltaE) best = { thread: t, deltaE: d };
  }
  return best;
}

/** Above this ΔE a match is reported as poor. */
export const POOR_MATCH_DELTA_E = 5;

/** Threads sorted by how close they are to a colour. */
export function threadsByCloseness(rgb: RGB, threads: readonly Thread[]): ThreadMatch[] {
  const lab = srgbToLab(rgb);
  return threads.map((t) => ({ thread: t, deltaE: deltaE2000(lab, srgbToLab(t.rgb)) })).sort((a, b) => a.deltaE - b.deltaE);
}
