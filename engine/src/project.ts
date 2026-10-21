// Native .sps project load/save: pretty-printed JSON with snake_case keys.
//
// Loading is tolerant: missing or wrongly typed fields get defaults, unknown fields are
// ignored, duplicate ids get new ones, a node may be a bare [x, y] (corner), and a file
// without a palette gets the colours it uses. Unknown enum values are an error.

import type { Artwork, Guide, PaletteSlot, StitchDocument, StitchObject, TextMeta, ThreadRef } from './document';
import { HOOP_SHAPES, createDocument, syncPalette } from './document';
import type { Motif, PathNode, Point, RGB, StitchSettings } from './types';
import {
  CORNER_MODES,
  DEFAULT_SETTINGS,
  FILL_PATTERNS,
  RAGGED_MODES,
  RUN_STYLES,
  STITCH_TYPES,
  STITCH_TYPE_LABELS,
  UNDERLAY_KINDS,
} from './types';

/** A file that cannot be loaded; the message is meant for the user. */
export class ProjectError extends Error {
  override name = 'ProjectError';
}

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };

// ---- settings key mapping ----

const toSnake = (key: string): string => key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

const SETTING_KEYS = Object.keys(DEFAULT_SETTINGS) as (keyof StitchSettings)[];

const SETTING_ENUMS: Partial<Record<keyof StitchSettings, readonly string[]>> = {
  stitchType: STITCH_TYPES,
  runStyle: RUN_STYLES,
  cornerMode: CORNER_MODES,
  fillPattern: FILL_PATTERNS,
  raggedMode: RAGGED_MODES,
  underlayType: UNDERLAY_KINDS,
  underlay2Type: UNDERLAY_KINDS,
};

// ---- save ----

const nodeOut = (n: PathNode): Json => ({ x: n.x, y: n.y, node_type: n.type, width: n.width });
const pointOut = (p: Point | null): Json => (p ? [p[0], p[1]] : null);
const threadOut = (t: ThreadRef | null): Json => (t ? { chart: t.chart, code: t.code, name: t.name } : null);

function settingsOut(s: StitchSettings): Json {
  const out: JsonObject = {};
  for (const k of SETTING_KEYS) out[toSnake(k)] = s[k];
  return out;
}

function objectOut(o: StitchObject): Json {
  return {
    id: o.id,
    name: o.name,
    points: o.points.map(nodeOut),
    holes: o.holes.map((h) => h.map(nodeOut)),
    fill_start: pointOut(o.fillStart),
    fill_end: pointOut(o.fillEnd),
    auto_entry: o.autoEntry,
    locked: o.locked,
    group_id: o.groupId,
    custom_stitches: o.customStitches ? o.customStitches.map(pointOut) : null,
    rail2: o.rail2.map(nodeOut),
    stop_after: o.stopAfter,
    hoop_out: pointOut(o.hoopOut),
    text_meta: (o.textMeta as Json) ?? null,
    stitch_angles: o.stitchAngles.map(([a, b]) => [pointOut(a), pointOut(b)]),
    thread: threadOut(o.thread),
    closed: o.closed,
    visible: o.visible,
    color_rgb: [...o.color],
    settings: settingsOut(o.settings),
  };
}

function artworkOut(a: Artwork): Json {
  return {
    id: a.id,
    name: a.name,
    src: a.src,
    x: a.x,
    y: a.y,
    width: a.width,
    height: a.height,
    opacity: a.opacity,
    visible: a.visible,
    locked: a.locked,
  };
}

/** Serialises a document to .sps text. */
export function saveProject(doc: StitchDocument): string {
  const out: JsonObject = {
    name: doc.name,
    hoop_width_mm: doc.hoopWidth,
    hoop_height_mm: doc.hoopHeight,
    hoop_shape: doc.hoopShape,
    hoop_corner_mm: doc.hoopCorner,
    hoop_id: doc.hoopId,
    thread_chart: doc.threadChart,
    palette: doc.palette.map((s) => ({ color: [...s.color], thread: threadOut(s.thread) })),
    guides: doc.guides.map((g) => ({ axis: g.axis, pos: g.pos })),
    ruler_origin: pointOut(doc.rulerOrigin),
    auto_jump_enabled: doc.autoJump,
    auto_jump_threshold_mm: doc.autoJumpThreshold,
    auto_trim_enabled: doc.autoTrim,
    trim_threshold_mm: doc.trimThreshold,
    closest_join: doc.closestJoin,
    join_distance_mm: doc.joinDistance,
    tie_stitches: doc.tieStitches,
    min_stitch_mm: doc.minStitch,
    trim_jumps: doc.trimJumps,
    motifs: doc.motifs.map((m) => ({ name: m.name, points: m.points.map(pointOut) })),
    artwork: doc.artwork.map(artworkOut),
    objects: doc.objects.map(objectOut),
  };
  return JSON.stringify(out, null, 2) + '\n';
}

// ---- load: tolerant readers ----

const isObj = (v: unknown): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const num = (v: unknown, def: number): number => (isNum(v) ? v : def);
const bool = (v: unknown, def: boolean): boolean => (typeof v === 'boolean' ? v : def);
const str = (v: unknown, def: string): string => (typeof v === 'string' ? v : def);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** Missing -> default; present but not one of the allowed values -> readable error. */
function enumValue<T extends string>(v: unknown, allowed: readonly T[], def: T, where: string): T {
  if (v === undefined || v === null) return def;
  if (typeof v === 'string' && (allowed as readonly string[]).includes(v)) return v as T;
  throw new ProjectError(
    `${where}: unknown value ${JSON.stringify(v)}. Expected one of: ${allowed.join(', ')}.`,
  );
}

function pointIn(v: unknown): Point | null {
  if (Array.isArray(v) && v.length >= 2 && isNum(v[0]) && isNum(v[1])) return [v[0], v[1]];
  return null;
}

const pointsIn = (v: unknown): Point[] => arr(v).map(pointIn).filter((p): p is Point => p !== null);

function nodeIn(v: unknown, where: string): PathNode | null {
  const bare = pointIn(v);
  if (bare) return { x: bare[0], y: bare[1], type: 'corner', width: null };
  if (!isObj(v) || !isNum(v.x) || !isNum(v.y)) return null;
  return {
    x: v.x,
    y: v.y,
    type: enumValue(v.node_type, ['corner', 'curve'] as const, 'corner', `${where} node_type`),
    width: isNum(v.width) ? v.width : null,
  };
}

const nodesIn = (v: unknown, where: string): PathNode[] =>
  arr(v)
    .map((n) => nodeIn(n, where))
    .filter((n): n is PathNode => n !== null);

function colorIn(v: unknown, def: RGB): RGB {
  if (!Array.isArray(v) || v.length < 3 || !v.slice(0, 3).every(isNum)) return [def[0], def[1], def[2]];
  const c = (x: number) => Math.min(255, Math.max(0, Math.round(x)));
  return [c(v[0] as number), c(v[1] as number), c(v[2] as number)];
}

function threadIn(v: unknown): ThreadRef | null {
  if (!isObj(v)) return null;
  return { chart: str(v.chart, ''), code: str(v.code, ''), name: str(v.name, '') };
}

function settingsIn(v: unknown, where: string): StitchSettings {
  const src = isObj(v) ? v : {};
  const out = { ...DEFAULT_SETTINGS } as Record<keyof StitchSettings, unknown>;
  for (const k of SETTING_KEYS) {
    const key = toSnake(k);
    const raw = src[key];
    const allowed = SETTING_ENUMS[k];
    const def = DEFAULT_SETTINGS[k];
    if (allowed) out[k] = enumValue(raw, allowed, def as string, `${where} setting ${key}`);
    else if (typeof def === 'number') out[k] = num(raw, def);
    else if (typeof def === 'boolean') out[k] = bool(raw, def);
    else out[k] = str(raw, def as string);
  }
  return out as unknown as StitchSettings;
}

function stitchAnglesIn(v: unknown): [Point, Point][] {
  const out: [Point, Point][] = [];
  for (const pair of arr(v)) {
    if (!Array.isArray(pair)) continue;
    const a = pointIn(pair[0]);
    const b = pointIn(pair[1]);
    if (a && b) out.push([a, b]);
  }
  return out;
}

const IMAGE_DATA_URL = /^data:image\/[\w.+-]+[;,]/i;

/** Gives every item a unique id: the first keeps its own, duplicates and missing ids get new ones. */
function assignIds<T extends { id: number }>(items: T[], rawIds: unknown[], next: () => number): void {
  const used = new Set<number>();
  items.forEach((item, i) => {
    const raw = rawIds[i];
    if (Number.isInteger(raw) && (raw as number) > 0 && !used.has(raw as number)) item.id = raw as number;
    else item.id = next();
    used.add(item.id);
  });
}

/** Parses .sps text into a document. Throws ProjectError with a readable message. */
export function loadProject(text: string): StitchDocument {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new ProjectError(`This is not a valid StitchPro design file (${(e as Error).message}).`);
  }
  if (!isObj(data)) throw new ProjectError('This is not a valid StitchPro design file (expected a JSON object).');

  const def = createDocument();

  const rawObjects = arr(data.objects).filter(isObj);
  const objects: StitchObject[] = rawObjects.map((o, i) => {
    const label = `Object ${i + 1}${typeof o.name === 'string' ? ` ("${o.name}")` : ''}`;
    const fillStart = pointIn(o.fill_start);
    const fillEnd = pointIn(o.fill_end);
    const textMeta = isObj(o.text_meta) ? (o.text_meta as TextMeta) : null;
    return {
      id: 0,
      name: str(o.name, ''),
      points: nodesIn(o.points, label),
      settings: settingsIn(o.settings, label),
      color: colorIn(o.color_rgb, [0, 0, 0]),
      closed: bool(o.closed, false),
      visible: bool(o.visible, true),
      holes: arr(o.holes).map((h) => nodesIn(h, `${label} hole`)),
      fillStart,
      fillEnd,
      autoEntry: bool(o.auto_entry, !(fillStart || fillEnd)),
      locked: bool(o.locked, false),
      groupId: Number.isInteger(o.group_id) ? (o.group_id as number) : null,
      customStitches: Array.isArray(o.custom_stitches) ? pointsIn(o.custom_stitches) : null,
      rail2: nodesIn(o.rail2, `${label} rail2`),
      stopAfter: bool(o.stop_after, false),
      hoopOut: pointIn(o.hoop_out),
      textMeta,
      stitchAngles: stitchAnglesIn(o.stitch_angles),
      thread: threadIn(o.thread),
      version: 1,
    };
  });

  const rawArtwork = arr(data.artwork).filter(
    (a): a is JsonObject => isObj(a) && typeof a.src === 'string' && IMAGE_DATA_URL.test(a.src),
  );
  const artwork: Artwork[] = rawArtwork.map((a) => ({
    id: 0,
    name: str(a.name, ''),
    src: a.src as string,
    x: num(a.x, 0),
    y: num(a.y, 0),
    width: num(a.width, 0),
    height: num(a.height, 0),
    opacity: num(a.opacity, 0.5),
    visible: bool(a.visible, true),
    locked: bool(a.locked, false),
  }));

  // Ids: keep the file's ids where they are unique; hand out new ones after the highest.
  const fileIds = [...rawObjects, ...rawArtwork].map((x) => x.id).filter((id): id is number => Number.isInteger(id));
  let nextId = Math.max(0, ...fileIds) + 1;
  const next = () => nextId++;
  assignIds(objects, rawObjects.map((o) => o.id), next);
  assignIds(artwork, rawArtwork.map((a) => a.id), next);
  for (const o of objects) if (!o.name) o.name = `${STITCH_TYPE_LABELS[o.settings.stitchType]} ${o.id}`;

  const palette: PaletteSlot[] = arr(data.palette)
    .filter(isObj)
    .map((s) => ({ color: colorIn(s.color, [0, 0, 0]), thread: threadIn(s.thread) }));

  const guides: Guide[] = arr(data.guides)
    .filter(isObj)
    .filter((g) => isNum(g.pos))
    .map((g, i) => ({
      axis: enumValue(g.axis, ['h', 'v'] as const, 'h', `Guide ${i + 1} axis`),
      pos: g.pos as number,
    }));

  const motifs: Motif[] = arr(data.motifs)
    .filter(isObj)
    .filter((m) => typeof m.name === 'string')
    .map((m) => ({ name: m.name as string, points: pointsIn(m.points) }));

  return {
    name: str(data.name, def.name),
    objects,
    artwork,
    hoopWidth: num(data.hoop_width_mm, def.hoopWidth),
    hoopHeight: num(data.hoop_height_mm, def.hoopHeight),
    hoopShape: enumValue(data.hoop_shape, HOOP_SHAPES, def.hoopShape, 'hoop_shape'),
    hoopCorner: num(data.hoop_corner_mm, def.hoopCorner),
    hoopId: str(data.hoop_id, def.hoopId),
    threadChart: str(data.thread_chart, def.threadChart),
    // A file with no palette gets the colours it uses; any palette is topped up so every colour has a slot.
    palette: syncPalette(palette, objects),
    guides,
    rulerOrigin: pointIn(data.ruler_origin) ?? def.rulerOrigin,
    autoJump: bool(data.auto_jump_enabled, def.autoJump),
    autoJumpThreshold: num(data.auto_jump_threshold_mm, def.autoJumpThreshold),
    autoTrim: bool(data.auto_trim_enabled, def.autoTrim),
    trimThreshold: num(data.trim_threshold_mm, def.trimThreshold),
    closestJoin: bool(data.closest_join, def.closestJoin),
    joinDistance: num(data.join_distance_mm, def.joinDistance),
    tieStitches: bool(data.tie_stitches, def.tieStitches),
    minStitch: num(data.min_stitch_mm, def.minStitch),
    trimJumps: num(data.trim_jumps, def.trimJumps),
    motifs,
    nextObjectId: nextId,
  };
}
