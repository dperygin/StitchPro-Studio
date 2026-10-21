import { describe, expect, it } from 'vitest';
import { createDocument, createObject, parseThreadChart, pathNode } from '@stitchpro/engine';
import { Editor, type PointerInput } from '../src/index';

const at = (x: number, y: number): PointerInput => ({ x: x * 4, y: y * 4, button: 0 });
const click = (ed: Editor, x: number, y: number) => {
  ed.pointerDown(at(x, y));
  ed.pointerUp(at(x, y));
};

/** A 10 x 10 pixel picture: left half red, right half blue, placed at (0,0) as 20 x 20 mm. */
function withPicture() {
  const doc = createDocument({ closestJoin: false });
  doc.artwork.push({ id: 900, name: 'photo', src: 'data:image/png;base64,AAAA', x: 0, y: 0, width: 20, height: 20, opacity: 0.5, visible: true, locked: false });
  const ed = new Editor(doc);
  ed.showRulers = false;
  const data = new Uint8ClampedArray(10 * 10 * 4);
  for (let y = 0; y < 10; y++) {
    for (let x = 0; x < 10; x++) {
      const k = (y * 10 + x) * 4;
      data.set(x < 5 ? [200, 0, 0, 255] : [0, 0, 200, 255], k);
    }
  }
  ed.setArtworkPixels(900, { width: 10, height: 10, data });
  return ed;
}

describe('Pick Color', () => {
  it('averages a 5 x 5 pixel area of the picture and adds it as a slot', () => {
    const ed = withPicture();
    const slots = ed.doc.palette.length;
    ed.run('pick.colour');
    click(ed, 2, 10); // pixel (1, 5): the 5 x 5 area is all red (clipped at the left edge)
    expect(ed.currentColor).toEqual([200, 0, 0]);
    expect(ed.doc.palette.length).toBe(slots + 1);
    // On the boundary the area mixes: pixel columns 3..7 = 2 red, 3 blue.
    expect(ed.artworkColourAt([10, 10])).toEqual([80, 0, 120]);
  });

  it('picks the slot that already has the colour instead of adding one', () => {
    const ed = withPicture();
    ed.run('pick.colour');
    click(ed, 2, 10);
    const slots = ed.doc.palette.length;
    click(ed, 3, 12);
    expect(ed.doc.palette.length).toBe(slots);
  });

  it('takes an object colour away from pictures', () => {
    const ed = withPicture();
    const o = createObject(ed.doc, { points: [pathNode(40, 40), pathNode(60, 40)], color: [0, 132, 61] });
    ed.addObject(o);
    ed.run('pick.colour');
    click(ed, 50, 40);
    expect(ed.currentColor).toEqual([0, 132, 61]);
  });

  it('ignores hidden pictures and pictures without pixels', () => {
    const ed = withPicture();
    ed.doc.artwork[0]!.visible = false;
    expect(ed.artworkColourAt([2, 10])).toBeNull();
    ed.doc.artwork[0]!.visible = true;
    ed.setArtworkPixels(900, null);
    expect(ed.artworkColourAt([2, 10])).toBeNull();
  });
});

describe('matching a design to a thread chart', () => {
  const chart = parseThreadChart('1,Isacord,Poppy,,200,16,46\n2,Isacord,Royal,,0,94,184\n3,Isacord,Black,,0,0,0');

  it('gives every colour and its objects the nearest thread, as one undo step', () => {
    const doc = createDocument({ closestJoin: false });
    doc.palette = [{ color: [205, 20, 50], thread: null }];
    const o = createObject(doc, { points: [pathNode(0, 0), pathNode(5, 0)], color: [205, 20, 50] });
    doc.objects.push(o);
    const ed = new Editor(doc);
    const report = ed.matchColoursToChart('Isacord', chart);
    expect(ed.object(o.id)!.color).toEqual([200, 16, 46]);
    expect(ed.object(o.id)!.thread).toEqual({ chart: 'Isacord', code: '1', name: 'Poppy' });
    expect(ed.doc.palette[0]!.thread?.code).toBe('1');
    expect(ed.doc.threadChart).toBe('Isacord');
    expect(report.poor).toBe(0);
    expect(ed.status).toContain('worst ΔE');
    ed.undo();
    expect(ed.object(o.id)!.color).toEqual([205, 20, 50]);
  });

  it('reports the worst ΔE when a colour has no close thread', () => {
    const doc = createDocument({ closestJoin: false });
    doc.palette = [{ color: [255, 255, 0], thread: null }];
    const ed = new Editor(doc);
    const report = ed.matchColoursToChart('Isacord', chart);
    expect(report.worst).toBeGreaterThan(5);
    expect(report.poor).toBe(1);
    expect(ed.status).toMatch(/1 colour not close \(worst ΔE \d+\.\d\)/);
  });
});

describe('hoops', () => {
  it('sets a hoop from the catalogue and checks the design fits it', () => {
    const doc = createDocument({ closestJoin: false });
    doc.objects.push(createObject(doc, { points: [pathNode(-44, 0), pathNode(44, 0)] })); // 88 mm: fits 130 x 180, not round 85
    const ed = new Editor(doc);
    ed.setHoop('rectangle-130x180');
    expect([ed.doc.hoopWidth, ed.doc.hoopHeight, ed.doc.hoopShape]).toEqual([130, 180, 'rectangle']);
    expect(ed.hoopFits()).toBe(true);
    ed.setHoop('round-85');
    expect(ed.doc.hoopShape).toBe('circle');
    expect(ed.hoopFits()).toBe(false);
  });
});
