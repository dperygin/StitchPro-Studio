import { describe, expect, it } from 'vitest';
import {
  AREA_TYPES,
  COLUMN_TYPES,
  DEFAULT_PALETTE_COLORS,
  DEFAULT_SETTINGS,
  ROW_FILL_TYPES,
  SPACED_COLUMN_TYPES,
  STITCH_TYPES,
  STITCH_TYPE_LABELS,
  StitchCache,
  UNDERLAY_TYPES,
  computeStitches,
  createDocument,
  createObject,
  defaultSettings,
  hasUnderlay,
  isAreaType,
  isColumnType,
  syncPalette,
  updateObject,
  type Motif,
  type Point,
  type StitchObject,
} from '../src/index';

describe('stitch types', () => {
  it('has the 15 types with their labels', () => {
    expect(STITCH_TYPES).toHaveLength(15);
    expect(STITCH_TYPE_LABELS.running).toBe('Run');
    expect(STITCH_TYPE_LABELS.radial_satin).toBe('Two-Rail Satin');
    expect(STITCH_TYPE_LABELS.fill).toBe('Tatami');
    expect(STITCH_TYPE_LABELS.outline).toBe('Radial Fill');
    expect(STITCH_TYPE_LABELS.motif_line).toBe('Motif');
  });

  it('groups types', () => {
    expect([...COLUMN_TYPES]).toEqual(['satin', 'zigzag', 'e_stitch']);
    expect([...AREA_TYPES].sort()).toEqual(
      ['fill', 'outline', 'motif_fill', 'contour', 'stipple', 'cross_stitch', 'satin_fill', 'laydown'].sort(),
    );
    expect([...ROW_FILL_TYPES]).toEqual(['fill', 'satin_fill']);
    expect([...SPACED_COLUMN_TYPES]).toEqual(['satin', 'zigzag', 'e_stitch', 'radial_satin']);
    expect([...UNDERLAY_TYPES]).toEqual(['fill', 'satin', 'radial_satin', 'satin_fill']);
    expect(isColumnType('radial_satin')).toBe(false);
    expect(isAreaType('laydown')).toBe(true);
    expect(hasUnderlay('laydown')).toBe(false);
  });
});

describe('defaults', () => {
  it('uses the specified setting defaults', () => {
    const s = DEFAULT_SETTINGS;
    expect(s.stitchType).toBe('running');
    expect(s.stitchLength).toBe(3.0);
    expect(s.runStyle).toBe('single');
    expect(s.cornerMode).toBe('auto');
    expect(s.satinWidth).toBe(3.0);
    expect(s.satinDensity).toBe(0.4);
    expect(s.splitLength).toBe(7.0);
    expect(s.fillPattern).toBe('thirds');
    expect(s.fillStitchLength).toBe(4.0);
    expect(s.motifName).toBe('wave');
    expect(s.motif2Name).toBe('');
    expect(s.pullCompensation).toBe(0.2);
    expect(s.underlayType).toBe('auto');
    expect(s.underlay2Type).toBe('none');
    expect(s.laydownLayers).toBe(2);
    expect(s.laydownAngle2).toBe(90);
  });

  it('gives underlay layer 2 the same defaults as layer 1', () => {
    for (const k of ['Spacing', 'Angle', 'Inset', 'StitchLength', 'StartMargin', 'EndMargin', 'ZigzagAngle'] as const) {
      expect(DEFAULT_SETTINGS[`underlay2${k}`]).toBe(DEFAULT_SETTINGS[`underlay${k}`]);
    }
  });

  it('hands out independent copies of the settings', () => {
    const a = defaultSettings();
    a.stitchLength = 9;
    expect(defaultSettings().stitchLength).toBe(3.0);
    expect(Object.isFrozen(DEFAULT_SETTINGS)).toBe(true);
    expect(defaultSettings({ stitchType: 'satin' }).stitchType).toBe('satin');
  });

  it('creates a document with the specified defaults', () => {
    const d = createDocument();
    expect(d.name).toBe('Untitled');
    expect(d.objects).toEqual([]);
    expect([d.hoopWidth, d.hoopHeight, d.hoopShape, d.hoopCorner, d.hoopId]).toEqual([100, 100, 'rectangle', 0, '']);
    expect(d.rulerOrigin).toEqual([0, 0]);
    expect([d.autoJump, d.autoJumpThreshold, d.autoTrim, d.trimThreshold]).toEqual([true, 12.0, true, 3]);
    expect([d.closestJoin, d.joinDistance, d.tieStitches, d.minStitch, d.trimJumps]).toEqual([true, 3, true, 0.3, 3]);
    expect(d.nextObjectId).toBe(1);
  });

  it('has the 12-colour default palette', () => {
    const d = createDocument();
    expect(d.palette).toHaveLength(12);
    expect(d.palette.map((s) => s.color)).toEqual(DEFAULT_PALETTE_COLORS);
    expect(d.palette[0]).toEqual({ color: [0, 0, 0], thread: null });
    expect(d.palette[1]!.color).toEqual([255, 255, 255]);
    expect(d.palette[11]!.color).toEqual([0, 170, 165]);
    // Each document has its own palette.
    d.palette[0]!.color[0] = 9;
    expect(createDocument().palette[0]!.color).toEqual([0, 0, 0]);
  });

  it('creates objects with the specified defaults', () => {
    const o = createObject(createDocument(), { stitchType: 'satin' });
    expect(o.settings.stitchType).toBe('satin');
    expect(o.name).toBe('Satin 1');
    expect(o.version).toBe(1);
    expect(o.autoEntry).toBe(true);
    expect(o.visible).toBe(true);
    expect(o.locked).toBe(false);
    expect(o.fillStart).toBeNull();
    expect(o.customStitches).toBeNull();
    expect(o.rail2).toEqual([]);
    expect(o.thread).toBeNull();
  });
});

describe('ids', () => {
  it('come from the document counter', () => {
    const d = createDocument();
    const a = createObject(d);
    const b = createObject(d);
    expect([a.id, b.id]).toEqual([1, 2]);
    expect(d.nextObjectId).toBe(3);
  });

  it('are independent per document (no global counter)', () => {
    const d1 = createDocument();
    const d2 = createDocument();
    createObject(d1);
    createObject(d1);
    expect(createObject(d2).id).toBe(1);
  });

  it('are kept when an object changes, while the version bumps', () => {
    const o = createObject(createDocument());
    const o2 = updateObject(o, { closed: true });
    expect(o2.id).toBe(o.id);
    expect(o2.version).toBe(2);
    expect(o.version).toBe(1);
    expect(updateObject(o2, {}).version).toBe(3);
  });
});

describe('palette sync', () => {
  it('leaves the palette alone when every colour has a slot', () => {
    const d = createDocument();
    const objs = [createObject(d, { color: [0, 94, 184] })];
    expect(syncPalette(d.palette, objs)).toBe(d.palette);
  });

  it('appends missing colours in stitch-out order, once each', () => {
    const d = createDocument();
    const thread = { chart: 'Isacord', code: '0017', name: 'Paper White' };
    const objs = [
      createObject(d, { color: [1, 2, 3] }),
      createObject(d, { color: [0, 0, 0] }),
      createObject(d, { color: [4, 5, 6], thread }),
      createObject(d, { color: [1, 2, 3] }),
    ];
    const p = syncPalette(d.palette, objs);
    expect(p).not.toBe(d.palette);
    expect(d.palette).toHaveLength(12);
    expect(p).toHaveLength(14);
    expect(p[12]).toEqual({ color: [1, 2, 3], thread: null });
    expect(p[13]).toEqual({ color: [4, 5, 6], thread });
  });
});

describe('stitch cache', () => {
  const counting = () => {
    let calls = 0;
    const cache = new StitchCache((o) => {
      calls++;
      return [[o.id, o.version]];
    });
    return { cache, calls: () => calls };
  };

  it('reuses stitches for the same (id, version)', () => {
    const { cache, calls } = counting();
    const o = createObject(createDocument());
    const first = cache.get(o);
    expect(cache.get(o)).toBe(first);
    expect(calls()).toBe(1);
  });

  it('recomputes when the version bumps', () => {
    const { cache, calls } = counting();
    const o = createObject(createDocument());
    cache.get(o);
    expect(cache.get(updateObject(o, { closed: true }))).toEqual([[1, 2]]);
    expect(calls()).toBe(2);
    expect(cache.size).toBe(1);
  });

  it('recomputes when the project motifs change', () => {
    const { cache, calls } = counting();
    const o = createObject(createDocument());
    const motifs: Motif[] = [];
    cache.get(o, motifs);
    cache.get(o, motifs);
    cache.get(o, [...motifs, { name: 'm', points: [[0, 0], [1, 0]] }]);
    expect(calls()).toBe(2);
  });

  it('only recomputes the object that changed', () => {
    const { cache, calls } = counting();
    const d = createDocument();
    const objs = [createObject(d), createObject(d), createObject(d)];
    objs.forEach((o) => cache.get(o));
    objs[1] = updateObject(objs[1]!, { visible: false });
    objs.forEach((o) => cache.get(o));
    expect(calls()).toBe(4);
  });

  it('prunes removed objects', () => {
    const { cache } = counting();
    const d = createDocument();
    const a = createObject(d);
    const b = createObject(d);
    cache.get(a);
    cache.get(b);
    cache.prune([b]);
    expect(cache.size).toBe(1);
  });

  it('returns hand edits instead of generated stitches', () => {
    const hand: Point[] = [[0, 0], [1, 1]];
    const o: StitchObject = createObject(createDocument(), { customStitches: hand });
    expect(computeStitches(o)).toBe(hand);
    expect(new StitchCache().get(o)).toBe(hand);
  });
});
