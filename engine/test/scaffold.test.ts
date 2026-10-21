import { describe, expect, it } from 'vitest';
import { polylineLength, polygonArea, unionArea, parseThreadChart, type Point } from '../src/index';

describe('engine scaffold', () => {
  it('measures polylines', () => {
    expect(polylineLength([[0, 0], [3, 4], [3, 10]])).toBe(11);
  });

  it('runs JSTS polygon operations', () => {
    const a: Point[] = [[0, 0], [10, 0], [10, 10], [0, 10]];
    const b = a.map(([x, y]): Point => [x + 5, y]);
    expect(polygonArea(a)).toBe(100);
    expect(unionArea(a, b)).toBe(150);
  });

  it('parses thread chart lines', () => {
    const t = parseThreadChart('0017,Isacord,Paper White ,,220,229,255,\r\nbad line\r\n');
    expect(t).toEqual([{ code: '0017', brand: 'Isacord', name: 'Paper White', rgb: [220, 229, 255] }]);
  });
});
