import { describe, expect, it } from 'vitest';
import { digitizeLayers, pointInRegion, quantize, regionArea, traceImage, traceLabel, tracedSvg, type PixelImage, type RGB, type Thread } from '../src';

/** A w x h picture painted by a function of the pixel (null = transparent). */
function picture(w: number, h: number, paint: (x: number, y: number) => RGB | null): PixelImage {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = paint(x, y);
      const i = (y * w + x) * 4;
      if (c) data.set([c[0], c[1], c[2], 255], i);
    }
  }
  return { width: w, height: h, data };
}

const WHITE: RGB = [255, 255, 255];
const RED: RGB = [210, 20, 40];
const BLUE: RGB = [20, 60, 200];
const BLACK: RGB = [10, 10, 10];
const GREEN: RGB = [0, 180, 0];

/** A logo: white background, a red square with a blue square inside, a thin black bar, one stray green pixel. */
const logo = picture(100, 80, (x, y) => {
  if (x === 90 && y === 5) return GREEN;
  if (x >= 10 && x < 50 && y >= 10 && y < 50) return x >= 25 && x < 35 && y >= 25 && y < 35 ? BLUE : RED;
  if (x >= 20 && x < 80 && y >= 62 && y < 65) return BLACK;
  // A little noise, as in a saved JPEG.
  return [255 - ((x * 7 + y * 3) % 5), 255, 255];
});
const at = { x: 0, y: 0, width: 50, height: 40 }; // 0.5 mm per pixel

const near = (a: RGB, b: RGB, tol = 12) => a.every((v, i) => Math.abs(v - b[i]!) <= tol);

describe('colour reduction', () => {
  it('finds the flat colours of a picture and keeps transparency', () => {
    const img = picture(20, 10, (x) => (x < 5 ? null : x < 12 ? RED : BLUE));
    const q = quantize(img, 4);
    expect(q.palette).toHaveLength(2);
    expect(q.palette.some((c) => near(c, RED))).toBe(true);
    expect(q.palette.some((c) => near(c, BLUE))).toBe(true);
    expect(q.labels[0]).toBe(255);
    expect(quantize(img, 4)).toEqual(q);
  });
});

describe('outline tracing', () => {
  const labels = (w: number, rows: string[]) => Uint8Array.from(rows.join('').split('').map((c) => (c === '#' ? 1 : 0)));

  it('traces a block as one ring of its corners, a donut as an outline and a hole', () => {
    expect(traceLabel(labels(4, ['.##.', '.##.', '....']), 4, 3, 1)).toEqual([[[1, 0], [3, 0], [3, 2], [1, 2]]]);
    const donut = traceLabel(labels(3, ['###', '#.#', '###']), 3, 3, 1);
    expect(donut).toHaveLength(2);
  });

  it('keeps pixels that only touch diagonally apart', () => {
    expect(traceLabel(labels(2, ['#.', '.#']), 2, 2, 1)).toHaveLength(2);
  });
});

describe('tracing a picture', () => {
  const layers = traceImage(logo, at, { colours: 6, minArea: 1 });

  it('drops the background and the stray pixel, keeps the shapes, largest first', () => {
    expect(layers).toHaveLength(3);
    const [red, black, blue] = layers;
    expect(near(red!.color, RED)).toBe(true);
    expect(near(blue!.color, BLUE)).toBe(true);
    expect(near(black!.color, BLACK)).toBe(true);
    // Red: 20 x 20 mm with a 5 x 5 mm hole.
    expect(red!.region).toHaveLength(1);
    expect(red!.region[0]!.holes).toHaveLength(1);
    // Smoothing rounds square corners by about a pixel (0.5 mm in this coarse picture).
    expect(Math.abs(red!.area - (400 - 25))).toBeLessThan(6);
    expect(Math.abs(blue!.area - 25)).toBeLessThan(3);
    expect(Math.abs(black!.area - 30 * 1.5)).toBeLessThan(3);
    expect(pointInRegion(red!.region, [10, 10])).toBe('inside');
    expect(pointInRegion(red!.region, [15, 15])).toBe('outside');
  });

  it('can keep the background, and snaps to thread colours when asked', () => {
    expect(traceImage(logo, at, { colours: 6, minArea: 1, dropBackground: false })).toHaveLength(4);
    const threads: Thread[] = [
      { code: '1', brand: 'Test', name: 'Poppy', type: '', rgb: [200, 16, 46] },
      { code: '2', brand: 'Test', name: 'Navy', type: '', rgb: [0, 50, 180] },
      { code: '3', brand: 'Test', name: 'Black', type: '', rgb: [0, 0, 0] },
      { code: '4', brand: 'Test', name: 'White', type: '', rgb: [255, 255, 255] },
    ];
    const snapped = traceImage(logo, at, { colours: 6, minArea: 1, threads, chart: 'Test' });
    expect(snapped.map((l) => l.thread?.name)).toEqual(['Poppy', 'Black', 'Navy']);
    expect(snapped[0]!.color).toEqual([200, 16, 46]);
  });

  it('digitizes wide shapes as tatami and thin ones as satin columns, overlapping later colours', () => {
    const objects = digitizeLayers(layers, { columnMaxWidth: 3.5, overlap: 0.4 });
    const types = objects.map((o) => o.settings!.stitchType);
    // Red square: tatami; the 1.5 mm black bar: columns; the 5 mm blue square: tatami.
    expect(types[0]).toBe('fill');
    expect(types.at(-1)).toBe('fill');
    expect(types.slice(1, -1).length).toBeGreaterThan(0);
    expect(types.slice(1, -1).every((t) => t === 'radial_satin')).toBe(true);
    // The red fill reaches 0.4 mm under the blue square (its hole shrinks), not past its own outline.
    const red = objects[0]!;
    const hx = red.holes![0]!.map((n) => n.x);
    expect(Math.min(...hx)).toBeCloseTo(12.5 + 0.4, 1);
    const ox = red.points!.map((n) => n.x);
    expect(Math.min(...ox)).toBeCloseTo(5, 1);
    expect(red.color).toEqual(layers[0]!.color);
    expect(regionArea(layers[0]!.region)).toBeGreaterThan(0);
  });

  it('smooths a traced circle into a few curve nodes', () => {
    const disc = picture(200, 200, (x, y) => (Math.hypot(x - 100, y - 100) < 80 ? RED : WHITE));
    const [layer] = traceImage(disc, { x: 0, y: 0, width: 20, height: 20 });
    const [fill] = digitizeLayers([layer!]);
    expect(fill!.points!.length).toBeLessThan(24);
    expect(fill!.points!.filter((n) => n.type === 'curve').length).toBeGreaterThan(fill!.points!.length / 2);
    expect(layer!.area).toBeCloseTo(Math.PI * 8 * 8, -1);
  });

  it('writes the traced shapes as SVG', () => {
    const svg = tracedSvg(layers);
    expect(svg.match(/<path /g)).toHaveLength(3);
    expect(svg).toContain('fill-rule="evenodd"');
  });
});
