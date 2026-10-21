import { describe, expect, it } from 'vitest';
import {
  JUMP_MARK,
  PAGE_SIZES,
  buildExportPlan,
  createDocument,
  createObject,
  designReport,
  designSvg,
  importedDesign,
  parsePathData,
  pathNode,
  sewObject,
  stitchRuns,
  tilePages,
  vectorObjects,
  type ExportPlan,
  type Point,
} from '../src';

const page = (name: string) => PAGE_SIZES.find((p) => p.name === name)!;

describe('SVG path data', () => {
  it('reads lines, relative moves, H/V and closes', () => {
    const [a, b] = parsePathData('M0 0 H10 V10 h-10 z m20 0 l5 5 5 -5');
    expect(a!.closed).toBe(true);
    expect(a!.points).toEqual([[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]);
    expect(b!.closed).toBe(false);
    expect(b!.points).toEqual([[20, 0], [25, 5], [30, 0]]);
  });

  it('flattens curves and arcs (compact arc flags) through the matrix', () => {
    const [c] = parsePathData('M0 0C0 10 10 10 10 0', [2, 0, 0, 2, 1, 1]);
    expect(c!.points[0]).toEqual([1, 1]);
    expect(c!.points.at(-1)).toEqual([21, 1]);
    expect(Math.max(...c!.points.map((p) => p[1]))).toBeCloseTo(16, 0);
    const [arc] = parsePathData('M0 0a5 5 0 105 5');
    expect(arc!.points.at(-1)![0]).toBeCloseTo(5, 6);
    expect(arc!.points.at(-1)![1]).toBeCloseTo(5, 6);
    // The large arc goes the long way round, past x = -5.
    expect(Math.min(...arc!.points.map((p) => p[0]))).toBeLessThan(-4);
    expect(() => parsePathData('M0 0 L x')).toThrow();
  });
});

describe('SVG as stitches', () => {
  const id: [number, number, number, number, number, number] = [1, 0, 0, 1, 0, 0];

  it('fills shapes as tatami with holes, skipping tiny pieces', () => {
    const objs = vectorObjects([{ d: 'M0 0H20V20H0Z M5 5V15H15V5Z M30 0h0.5v0.5h-0.5z', matrix: id, fill: [255, 0, 0], stroke: null, strokeWidth: 0 }]);
    expect(objs).toHaveLength(1);
    expect(objs[0]!.settings!.stitchType).toBe('fill');
    expect(objs[0]!.holes).toHaveLength(1);
    expect(objs[0]!.color).toEqual([255, 0, 0]);
    expect(objs[0]!.points).toHaveLength(4);
  });

  it('strokes become satin from 1 mm wide, else a run; smoothed nodes', () => {
    const circle = 'M10 0A10 10 0 1 1 -10 0A10 10 0 1 1 10 0Z';
    const [satin] = vectorObjects([{ d: circle, matrix: [2, 0, 0, 2, 0, 0], fill: null, stroke: [0, 0, 255], strokeWidth: 1 }]);
    expect(satin!.settings!.stitchType).toBe('satin');
    expect(satin!.settings!.satinWidth).toBeCloseTo(2, 6);
    expect(satin!.closed).toBe(true);
    expect(satin!.points!.length).toBeLessThan(20);
    expect(satin!.points!.some((n) => n.type === 'curve')).toBe(true);
    const [run] = vectorObjects([{ d: 'M0 0L30 0', matrix: id, fill: null, stroke: [0, 0, 0], strokeWidth: 0.5 }]);
    expect(run!.settings!.stitchType).toBe('running');
  });
});

describe('export SVG', () => {
  const doc = createDocument();
  doc.objects.push(
    createObject(doc, { stitchType: 'fill', closed: true, color: [255, 0, 0], points: [pathNode(0, 0), pathNode(20, 0), pathNode(20, 10), pathNode(0, 10)] }),
    createObject(doc, { stitchType: 'running', color: [0, 0, 255], points: [pathNode(0, 20), pathNode(30, 20)] }),
  );

  it('writes real size in thread colours, as shapes or stitches', () => {
    const shapes = designSvg(doc, sewObject, 'shapes');
    expect(shapes).toContain('width="32mm"');
    expect(shapes).toContain('height="22mm"');
    expect(shapes).toContain('fill="#ff0000"');
    expect(shapes).toContain('stroke="#0000ff"');
    const stitches = designSvg(doc, sewObject, 'stitches');
    expect(stitches.match(/<path /g)!.length).toBeGreaterThanOrEqual(2);
  });

  it('splits stitches at jump marks', () => {
    const pts: Point[] = [[0, 0], [1, 0], ...Array.from({ length: JUMP_MARK }, (): Point => [5, 5]), [6, 5]];
    expect(stitchRuns(pts)).toEqual([[[0, 0], [1, 0]], [[5, 5], [6, 5]]]);
  });
});

describe('worksheet report', () => {
  it('counts stitches, colours, stops, trims, thread length and run time', () => {
    const plan: ExportPlan = {
      name: 'x',
      threads: [
        { color: [0, 0, 0], name: 'Black', brand: 'Melco', code: '1' },
        { color: [255, 0, 0], name: 'Red', brand: 'Melco', code: '2' },
      ],
      commands: [
        ['stitch', 0, 0],
        ['stitch', 10, 0],
        ['trim', 10, 0],
        ['jump', 10, 10],
        ['stitch', 10, 20],
        ['stop', 10, 20],
        ['color_change', 10, 20],
        ['stitch', 0, 20],
      ],
      autoJump: true,
      maxStitch: 12,
      trimJumps: 3,
    };
    const r = designReport(plan);
    expect(r.stitches).toBe(4);
    expect(r.trims).toBe(1);
    expect(r.stops).toBe(1);
    expect(r.colourChanges).toBe(1);
    expect(r.threadLength).toBeCloseTo(30, 6);
    expect(r.blocks.map((b) => [b.stitches, b.threadLength, b.stops])).toEqual([
      [3, 20, 1],
      [1, 10, 0],
    ]);
    expect([r.width, r.height]).toEqual([10, 20]);
    expect(r.runMinutes).toBeCloseTo(4 / 800, 9);
  });

  it('reports a real design through its export plan', () => {
    const doc = createDocument();
    doc.objects.push(createObject(doc, { stitchType: 'running', points: [pathNode(0, 0), pathNode(30, 0)] }));
    const r = designReport(buildExportPlan(doc, sewObject));
    expect(r.blocks).toHaveLength(1);
    expect(r.width).toBeCloseTo(30, 6);
  });
});

describe('placement template tiling', () => {
  it('fits on one page when it can, else overlapping pages', () => {
    const one = tilePages({ minX: 0, minY: 0, maxX: 100, maxY: 100 }, page('A4'));
    expect(one.tiles).toHaveLength(1);
    const many = tilePages({ minX: 0, minY: 0, maxX: 400, maxY: 100 }, page('A4'), { orientation: 'portrait', margin: 10, overlap: 10 });
    expect(many.cols).toBe(3);
    expect(many.tiles[1]!.x - many.tiles[0]!.x).toBeCloseTo(190 - 10, 6);
    // Every point of the area is on some page.
    expect(many.tiles[0]!.x).toBeLessThanOrEqual(0);
    expect(many.tiles.at(-1)!.x + many.tiles.at(-1)!.width).toBeGreaterThanOrEqual(400);
  });

  it('auto orientation picks fewer pages', () => {
    const wide = { minX: 0, minY: 0, maxX: 260, maxY: 150 };
    const auto = tilePages(wide, page('A4'));
    expect(auto.orientation).toBe('landscape');
    expect(auto.tiles).toHaveLength(1);
    expect(tilePages(wide, page('A4'), { orientation: 'portrait' }).tiles.length).toBeGreaterThan(1);
  });
});

describe('machine file import', () => {
  it('makes each run a Manual object, grouped per colour block', () => {
    const doc = importedDesign(
      {
        threads: [
          { color: [10, 20, 30], name: 'Navy', brand: 'Madeira', code: '1166' },
          { color: [200, 0, 0], name: '', brand: '', code: '' },
        ],
        runs: [
          { thread: 0, points: [[0, 0], [1, 0]], stop: false },
          { thread: 0, points: [[5, 0], [6, 0]], stop: true },
          { thread: 1, points: [[0, 5], [1, 5]], stop: false },
        ],
        stitches: 6,
      },
      'imported',
    );
    expect(doc.objects.map((o) => o.settings.stitchType)).toEqual(['manual', 'manual', 'manual']);
    expect(doc.objects.map((o) => o.groupId)).toEqual([1, 1, 2]);
    expect(doc.objects[1]!.stopAfter).toBe(true);
    expect(doc.objects[0]!.thread).toEqual({ chart: 'Madeira', code: '1166', name: 'Navy' });
    expect(doc.objects[2]!.thread).toBeNull();
    expect(sewObject(doc.objects[0]!)).toEqual([[0, 0], [1, 0]]);
    expect(doc.palette.some((s) => s.color[0] === 10)).toBe(true);
  });
});
