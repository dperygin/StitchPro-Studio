import { describe, expect, it } from 'vitest';
import {
  CORNER_MODES,
  DEFAULT_SETTINGS,
  FILL_PATTERNS,
  ProjectError,
  RAGGED_MODES,
  RUN_STYLES,
  STITCH_TYPES,
  UNDERLAY_KINDS,
  createDocument,
  createObject,
  loadProject,
  pathNode,
  saveProject,
  type StitchDocument,
  type StitchSettings,
} from '../src/index';

const PNG = 'data:image/png;base64,iVBORw0KGgo=';

/** Every setting changed from its default, so a mis-mapped key can't hide behind a default. */
function nonDefaultSettings(): StitchSettings {
  const enums: Partial<Record<keyof StitchSettings, readonly string[]>> = {
    stitchType: STITCH_TYPES,
    runStyle: RUN_STYLES,
    cornerMode: CORNER_MODES,
    fillPattern: FILL_PATTERNS,
    raggedMode: RAGGED_MODES,
    underlayType: UNDERLAY_KINDS,
    underlay2Type: UNDERLAY_KINDS,
  };
  const s = { ...DEFAULT_SETTINGS } as Record<string, unknown>;
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
    const allowed = enums[k as keyof StitchSettings];
    if (allowed) s[k] = allowed[allowed.length - 1] === v ? allowed[0] : allowed[allowed.length - 1];
    else if (typeof v === 'number') s[k] = v + 1.25;
    else if (typeof v === 'boolean') s[k] = !v;
    else s[k] = `${v}x`;
  }
  return s as unknown as StitchSettings;
}

/** A document with every field set to something other than its default. */
function fullDocument(): StitchDocument {
  const doc = createDocument({
    name: 'Round trip',
    hoopWidth: 130,
    hoopHeight: 180,
    hoopShape: 'roundrect',
    hoopCorner: 12,
    hoopId: 'brother-130x180',
    threadChart: 'Isacord',
    guides: [
      { axis: 'h', pos: 10.5 },
      { axis: 'v', pos: -3 },
    ],
    rulerOrigin: [5, 6],
    autoJump: false,
    autoJumpThreshold: 9,
    autoTrim: false,
    trimThreshold: 4,
    closestJoin: false,
    joinDistance: 2,
    tieStitches: false,
    minStitch: 0.4,
    trimJumps: 5,
    motifs: [{ name: 'mine', points: [[0, 0], [0.5, -0.4], [1, 0]] }],
  });
  const thread = { chart: 'Isacord', code: '0017', name: 'Paper White' };
  const a = createObject(doc, {
    name: 'Leaf',
    points: [pathNode(0, 0), pathNode(10, 0, 'curve', 4.5), pathNode(10, 10, 'corner', null)],
    settings: nonDefaultSettings(),
    color: [12, 34, 56],
    closed: true,
    visible: false,
    holes: [[pathNode(2, 2), pathNode(4, 2), pathNode(3, 4, 'curve')]],
    fillStart: [1, 1],
    fillEnd: [9, 9],
    autoEntry: false,
    locked: true,
    groupId: 7,
    customStitches: [[0, 0], [1.5, 2.5]],
    rail2: [pathNode(0, 5), pathNode(10, 5, 'curve', 2)],
    stopAfter: true,
    hoopOut: [50, -20],
    textMeta: { text: 'Hi', font: 'Roboto', nested: { capHeight: 10 } },
    stitchAngles: [
      [[0, 0], [5, 5]],
      [[1, 2], [3, 4]],
    ],
    thread,
  });
  const b = createObject(doc, { stitchType: 'satin', color: [0, 0, 0] });
  doc.objects = [a, b];
  doc.artwork = [
    { id: 3, name: 'photo', src: PNG, x: -5, y: 7, width: 40, height: 30, opacity: 0.8, visible: false, locked: true },
  ];
  doc.nextObjectId = 4;
  doc.palette = [
    { color: [0, 0, 0], thread: null },
    { color: [12, 34, 56], thread },
  ];
  return doc;
}

describe('.sps save', () => {
  it('writes pretty-printed JSON with the specified snake_case keys', () => {
    const text = saveProject(fullDocument());
    expect(text).toContain('\n  "name": "Round trip"');
    const data = JSON.parse(text);
    expect(Object.keys(data)).toEqual([
      'name', 'hoop_width_mm', 'hoop_height_mm', 'hoop_shape', 'hoop_corner_mm', 'hoop_id', 'thread_chart',
      'palette', 'guides', 'ruler_origin', 'auto_jump_enabled', 'auto_jump_threshold_mm', 'auto_trim_enabled',
      'trim_threshold_mm', 'closest_join', 'join_distance_mm', 'tie_stitches', 'min_stitch_mm', 'trim_jumps',
      'motifs', 'artwork', 'objects',
    ]);
    expect(Object.keys(data.objects[0]).sort()).toEqual(
      [
        'id', 'name', 'points', 'holes', 'fill_start', 'fill_end', 'auto_entry', 'locked', 'group_id',
        'custom_stitches', 'rail2', 'stop_after', 'hoop_out', 'text_meta', 'stitch_angles', 'thread', 'closed',
        'visible', 'color_rgb', 'settings',
      ].sort(),
    );
    expect(data.objects[0].points[1]).toEqual({ x: 10, y: 0, node_type: 'curve', width: 4.5 });
    const s = data.objects[0].settings;
    expect(Object.keys(s)).toHaveLength(Object.keys(DEFAULT_SETTINGS).length);
    expect(s).toHaveProperty('underlay2_start_margin');
    expect(s).toHaveProperty('mitre_below_deg');
    expect(s).toHaveProperty('e_spacing');
    expect(s).toHaveProperty('motif2_name');
    for (const k of Object.keys(s)) expect(k).toMatch(/^[a-z0-9_]+$/);
  });
});

describe('.sps round trip', () => {
  it('keeps every field', () => {
    const doc = fullDocument();
    expect(loadProject(saveProject(doc))).toEqual(doc);
  });

  it('keeps a default document', () => {
    const doc = createDocument();
    expect(loadProject(saveProject(doc))).toEqual(doc);
  });
});

describe('.sps tolerant load', () => {
  it('fills missing fields with defaults and ignores unknown ones', () => {
    const doc = loadProject(JSON.stringify({ extra: 1, objects: [{ id: 4, points: [], color_rgb: [0, 0, 0], foo: 'bar' }] }));
    const def = createDocument();
    expect(doc.name).toBe('Untitled');
    expect(doc.hoopWidth).toBe(def.hoopWidth);
    expect(doc.autoJumpThreshold).toBe(def.autoJumpThreshold);
    const o = doc.objects[0]!;
    expect(o.settings).toEqual(DEFAULT_SETTINGS);
    expect(o.visible).toBe(true);
    expect(o.customStitches).toBeNull();
    expect(o.name).toBe('Run 4');
    expect(o).not.toHaveProperty('foo');
    expect(doc).not.toHaveProperty('extra');
    expect(doc.nextObjectId).toBe(5);
  });

  it('fills missing settings individually', () => {
    const doc = loadProject(JSON.stringify({ objects: [{ settings: { stitch_type: 'satin', satin_width: 5 } }] }));
    const s = doc.objects[0]!.settings;
    expect(s.stitchType).toBe('satin');
    expect(s.satinWidth).toBe(5);
    expect(s.satinDensity).toBe(DEFAULT_SETTINGS.satinDensity);
  });

  it('gives duplicate and missing ids new ones', () => {
    const doc = loadProject(
      JSON.stringify({ objects: [{ id: 5 }, { id: 5 }, {}, { id: 2 }], artwork: [{ id: 2, src: PNG }] }),
    );
    expect(doc.objects.map((o) => o.id)).toEqual([5, 6, 7, 2]);
    expect(doc.artwork[0]!.id).toBe(2);
    expect(doc.nextObjectId).toBe(8);
  });

  it('accepts bare [x, y] nodes as corners', () => {
    const doc = loadProject(JSON.stringify({ objects: [{ points: [[1, 2], { x: 3, y: 4, node_type: 'curve' }], holes: [[[0, 0], [1, 0], [1, 1]]] }] }));
    const o = doc.objects[0]!;
    expect(o.points).toEqual([pathNode(1, 2, 'corner', null), pathNode(3, 4, 'curve', null)]);
    expect(o.holes[0]![2]).toEqual(pathNode(1, 1));
  });

  it('defaults auto_entry to true unless an entry or exit is set', () => {
    const doc = loadProject(
      JSON.stringify({ objects: [{}, { fill_start: [1, 1] }, { fill_end: [2, 2] }, { fill_start: [1, 1], auto_entry: true }] }),
    );
    expect(doc.objects.map((o) => o.autoEntry)).toEqual([true, false, false, true]);
  });

  it('builds the palette from the colours used when the file has none', () => {
    const doc = loadProject(
      JSON.stringify({ objects: [{ color_rgb: [1, 2, 3] }, { color_rgb: [9, 9, 9] }, { color_rgb: [1, 2, 3] }] }),
    );
    expect(doc.palette.map((p) => p.color)).toEqual([[1, 2, 3], [9, 9, 9]]);
  });

  it('adds missing colours to a palette that lacks them', () => {
    const doc = loadProject(
      JSON.stringify({ palette: [{ color: [9, 9, 9] }], objects: [{ color_rgb: [1, 2, 3] }, { color_rgb: [9, 9, 9] }] }),
    );
    expect(doc.palette.map((p) => p.color)).toEqual([[9, 9, 9], [1, 2, 3]]);
  });

  it('drops artwork whose src is not an image data URL', () => {
    const doc = loadProject(
      JSON.stringify({
        artwork: [
          { src: PNG },
          { src: 'https://example.com/a.png' },
          { src: 'data:text/html;base64,PHNjcmlwdD4=' },
          { src: 'javascript:alert(1)' },
          {},
          { src: 'data:image/svg+xml;utf8,<svg/>' },
        ],
      }),
    );
    expect(doc.artwork.map((a) => a.src)).toEqual([PNG, 'data:image/svg+xml;utf8,<svg/>']);
    expect(doc.artwork[0]!.opacity).toBe(0.5);
  });

  it('reports unknown enum values with a readable message', () => {
    const bad = (json: unknown) => () => loadProject(JSON.stringify(json));
    expect(bad({ objects: [{ name: 'Leaf', settings: { stitch_type: 'sequin' } }] })).toThrow(
      'Object 1 ("Leaf") setting stitch_type: unknown value "sequin". Expected one of: running, satin,',
    );
    expect(bad({ objects: [{ settings: { fill_pattern: 'plaid' } }] })).toThrow(/fill_pattern: unknown value "plaid"/);
    expect(bad({ objects: [{ points: [{ x: 0, y: 0, node_type: 'smooth' }] }] })).toThrow(/node_type: unknown value "smooth"/);
    expect(bad({ hoop_shape: 'oval' })).toThrow('hoop_shape: unknown value "oval". Expected one of: rectangle, circle, roundrect.');
    expect(bad({ guides: [{ axis: 'x', pos: 1 }] })).toThrow(/Guide 1 axis/);
    expect(bad({ objects: [{ settings: { underlay_type: 5 } }] })).toThrow(ProjectError);
  });

  it('rejects files that are not JSON objects', () => {
    expect(() => loadProject('not json')).toThrow(/not a valid StitchPro design file/);
    expect(() => loadProject('[1, 2]')).toThrow(ProjectError);
  });
});
