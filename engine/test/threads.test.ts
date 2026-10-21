import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  HOOPS,
  MIN_HOOP_MM,
  colourDifference,
  deltaE2000,
  findHoop,
  fitsHoop,
  nearestThread,
  parseThreadChart,
  parseThreadLine,
  srgbToLab,
  threadsByCloseness,
  type Lab,
} from '../src/index';

describe('thread chart lines', () => {
  it('reads code, chart, name, type and RGB', () => {
    expect(parseThreadLine('1902,Isacord,Poppy,B,200,16,46')).toEqual({ code: '1902', brand: 'Isacord', name: 'Poppy', type: 'B', rgb: [200, 16, 46] });
  });

  it('keeps commas inside colour names', () => {
    expect(parseThreadLine('77,Brand,Blue, Light, Ice,A,180,200,230')!.name).toBe('Blue, Light, Ice');
    expect(parseThreadLine('78,Brand,Grey, B tone,,120,120,120')!).toMatchObject({ name: 'Grey, B tone', type: '' });
  });

  it('ignores fields after the colour and skips non-thread lines', () => {
    expect(parseThreadLine('1610,Madeira Firefighter,,,183,195,197,21')).toMatchObject({ code: '1610', name: '', rgb: [183, 195, 197] });
    expect(parseThreadLine('')).toBeNull();
    expect(parseThreadLine('code,chart,name,type,R,G,B')).toBeNull();
    expect(parseThreadLine('1,X,Too bright,,300,0,0')).toBeNull();
  });

  it('loads every supplied chart', () => {
    const dir = join(__dirname, '..', '..', 'web', 'src', 'threads');
    for (const f of readdirSync(dir)) {
      const text = readFileSync(join(dir, f), 'utf8');
      const lines = text.split(/\r?\n/).filter((l) => l.trim()).length;
      const threads = parseThreadChart(text);
      expect(threads.length, f).toBe(lines);
    }
  });
});

describe('colour matching', () => {
  it('converts sRGB to CIELAB (D65)', () => {
    const near = (a: Lab, b: Lab, digits = 1) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i]!, digits));
    near(srgbToLab([255, 255, 255]), [100, 0, 0], 3);
    near(srgbToLab([0, 0, 0]), [0, 0, 0], 6);
    near(srgbToLab([255, 0, 0]), [53.24, 80.09, 67.2]);
    near(srgbToLab([0, 0, 255]), [32.3, 79.19, -107.86]);
  });

  it('matches the CIEDE2000 reference data (Sharma, Wu and Dalal)', () => {
    const pairs: [Lab, Lab, number][] = [
      [[50, 2.6772, -79.7751], [50, 0, -82.7485], 2.0425],
      [[50, 3.1571, -77.2803], [50, 0, -82.7485], 2.8615],
      [[50, 2.8361, -74.02], [50, 0, -82.7485], 3.4412],
      [[50, -1.3802, -84.2814], [50, 0, -82.7485], 1.0],
      [[50, 2.5, 0], [73, 25, -18], 27.1492],
      [[50, 2.5, 0], [61, -5, 29], 22.8977],
      [[60.2574, -34.0099, 36.2677], [60.4626, -34.1751, 39.4387], 1.2644],
      [[2.0776, 0.0795, -1.135], [0.9033, -0.0636, -0.5514], 0.9082],
    ];
    for (const [a, b, expected] of pairs) {
      expect(deltaE2000(a, b)).toBeCloseTo(expected, 4);
      expect(deltaE2000(b, a)).toBeCloseTo(expected, 4);
    }
    expect(colourDifference([10, 20, 30], [10, 20, 30])).toBe(0);
  });

  it('finds the nearest thread and sorts by closeness', () => {
    const threads = parseThreadChart('1,T,Red,,200,16,46\n2,T,Blue,,0,94,184\n3,T,Pink,,236,0,140');
    const m = nearestThread([210, 20, 50], threads)!;
    expect(m.thread.name).toBe('Red');
    expect(m.deltaE).toBeLessThan(5);
    expect(threadsByCloseness([0, 90, 180], threads).map((x) => x.thread.name)[0]).toBe('Blue');
    expect(nearestThread([1, 2, 3], [])).toBeNull();
  });
});

describe('hoops', () => {
  it('lists only sewing fields of at least 76.2 mm both ways', () => {
    expect(HOOPS.length).toBeGreaterThan(30);
    for (const h of HOOPS) {
      expect(h.width).toBeGreaterThanOrEqual(MIN_HOOP_MM);
      expect(h.height).toBeGreaterThanOrEqual(MIN_HOOP_MM);
    }
    expect(new Set(HOOPS.map((h) => h.id)).size).toBe(HOOPS.length);
  });

  it('has round, rounded, upright and sideways rectangles, border, magnetic, sash and cap hoops', () => {
    expect(HOOPS.filter((h) => h.kind === 'round').map((h) => h.width)).toEqual(expect.arrayContaining([85, 190]));
    expect(findHoop('rectangle-130x180')).toBeDefined();
    expect(findHoop('rectangle-180x130')).toBeDefined();
    expect(findHoop('rectangle-297x465')).toBeDefined();
    expect(HOOPS.some((h) => h.kind === 'rounded' && h.shape === 'roundrect' && h.corner > 0)).toBe(true);
    expect(HOOPS.some((h) => h.kind === 'border')).toBe(true);
    expect(HOOPS.some((h) => h.kind === 'magnetic')).toBe(true);
    expect(Math.max(...HOOPS.filter((h) => h.kind === 'sash').map((h) => h.width))).toBe(1200);
    expect(findHoop('cap-150x135')).toMatchObject({ width: 150, height: 135 });
    expect(findHoop('rectangle-130x180')!.name).toBe('130 x 180 mm (5.1 x 7.1 in)');
  });

  it('checks whether a design fits the sewing field', () => {
    expect(fitsHoop([[-50, -50], [50, 50]], 100, 100, 'rectangle')).toBe(true);
    expect(fitsHoop([[51, 0]], 100, 100, 'rectangle')).toBe(false);
    expect(fitsHoop([[45, 45]], 100, 100, 'circle')).toBe(false);
    expect(fitsHoop([[30, 30]], 100, 100, 'circle')).toBe(true);
    expect(fitsHoop([[49, 49]], 100, 100, 'roundrect', 10)).toBe(false);
    expect(fitsHoop([[49, 0]], 100, 100, 'roundrect', 10)).toBe(true);
  });
});
