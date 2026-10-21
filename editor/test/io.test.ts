import { describe, expect, it } from 'vitest';
import { createDocument, createObject, pathNode } from '@stitchpro/engine';
import { Editor, type HostAction } from '../src/index';

function editorWith(n = 2) {
  const doc = createDocument({ closestJoin: false, hoopWidth: 100, hoopHeight: 100 });
  for (let i = 0; i < n; i++) doc.objects.push(createObject(doc, { stitchType: 'running', points: [pathNode(0, i * 10), pathNode(20, i * 10)] }));
  const ed = new Editor(doc);
  ed.showRulers = false;
  return ed;
}

describe('artwork', () => {
  it('adds a picture centred in the hoop at 96 ppi, shrunk to fit; edits and removes with undo', () => {
    const ed = editorWith(0);
    const small = ed.addArtwork('logo.png', 'data:image/png;base64,', 96, 48);
    const a = ed.doc.artwork.find((x) => x.id === small)!;
    expect(a.width).toBeCloseTo(25.4, 6);
    expect(a.height).toBeCloseTo(12.7, 6);
    expect(a.x).toBeCloseTo(-12.7, 6);
    const big = ed.addArtwork('photo.jpg', 'data:image/jpeg;base64,', 4000, 2000);
    const b = ed.doc.artwork.find((x) => x.id === big)!;
    expect(b.width).toBeCloseTo(100, 6);
    expect(b.height).toBeCloseTo(50, 6);
    ed.updateArtwork(big, { opacity: 0.2, locked: true, visible: false });
    expect(ed.doc.artwork[1]).toMatchObject({ opacity: 0.2, locked: true, visible: false });
    ed.removeArtwork(small);
    expect(ed.doc.artwork.map((x) => x.id)).toEqual([big]);
    ed.undo();
    expect(ed.doc.artwork).toHaveLength(2);
    ed.undo();
    expect(ed.doc.artwork[1]!.opacity).toBe(0.5);
  });
});

describe('imports and file commands', () => {
  it('inserts imported objects at the end and selects them as one undo step', () => {
    const ed = editorWith(1);
    const ids = ed.insertObjects(
      [
        { stitchType: 'fill', closed: true, points: [pathNode(0, 0), pathNode(10, 0), pathNode(10, 10)] },
        { stitchType: 'running', points: [pathNode(0, 0), pathNode(5, 5)] },
      ],
      'Import SVG',
    );
    expect(ed.doc.objects).toHaveLength(3);
    expect(ed.selectionOrder).toEqual(ids);
    ed.undo();
    expect(ed.doc.objects).toHaveLength(1);
  });

  it('asks the host for imports, exports and printouts', () => {
    const ed = editorWith(1);
    const asked: [HostAction, unknown][] = [];
    ed.onAction((a, arg) => asked.push([a, arg]));
    for (const id of ['file.importMachine', 'file.importArtwork', 'file.importSvg', 'file.exportSvg', 'file.printWorksheet', 'file.printTemplate', 'file.printImage']) {
      expect(ed.run(id)).toBe(true);
    }
    ed.run('file.export', 'pes');
    expect(asked).toEqual([
      ['importMachine', undefined],
      ['importArtwork', undefined],
      ['importSvg', undefined],
      ['exportSvg', undefined],
      ['print', 'worksheet'],
      ['print', 'template'],
      ['print', 'image'],
      ['export', 'pes'],
    ]);
  });
});

describe('stitch player', () => {
  it('steps object by object', () => {
    const ed = editorWith(3);
    const order = ed.sewingOrder();
    // From the full view (not playing), forward goes to the end of the first object.
    ed.playerStepObject(1);
    expect(ed.player.index).toBe(order[0]!.count);
    ed.playerSeek(0);
    ed.playerStepObject(1);
    expect(ed.player.index).toBe(order[0]!.start + order[0]!.count);
    ed.playerStepObject(1);
    expect(ed.player.index).toBe(order[1]!.start + order[1]!.count);
    ed.playerStep(-1);
    ed.playerStepObject(-1);
    expect(ed.player.index).toBe(order[1]!.start);
    ed.playerStepObject(-1);
    expect(ed.player.index).toBe(order[0]!.start);
    ed.run('player.nextObject');
    expect(ed.player.index).toBe(order[0]!.count);
    ed.dispose();
  });
});
