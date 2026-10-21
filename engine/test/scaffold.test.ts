import { describe, expect, it } from 'vitest';
import {
  StitchCache,
  createObject,
  touch,
  polylineLength,
  polygonArea,
  unionArea,
  parseThreadChart,
} from '../src/index';

describe('engine scaffold', () => {
  it('measures polylines', () => {
    expect(polylineLength([{ x: 0, y: 0 }, { x: 3, y: 4 }, { x: 3, y: 10 }])).toBe(11);
  });

  it('runs JSTS polygon operations', () => {
    const a = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
    const b = a.map((p) => ({ x: p.x + 5, y: p.y }));
    expect(polygonArea(a)).toBe(100);
    expect(unionArea(a, b)).toBe(150);
  });

  it('caches stitches by (id, version)', () => {
    const cache = new StitchCache();
    let calls = 0;
    const gen = () => {
      calls++;
      return [];
    };
    const obj = createObject('a');
    cache.get(obj, gen);
    cache.get(obj, gen);
    expect(calls).toBe(1);
    cache.get(touch(obj), gen);
    expect(calls).toBe(2);
  });

  it('parses thread chart lines', () => {
    const t = parseThreadChart('0017,Isacord,Paper White ,,220,229,255,\r\nbad line\r\n');
    expect(t).toEqual([{ code: '0017', brand: 'Isacord', name: 'Paper White', rgb: [220, 229, 255] }]);
  });
});
