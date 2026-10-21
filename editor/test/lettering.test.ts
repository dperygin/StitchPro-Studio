import { describe, expect, it } from 'vitest';
import { createNativeFont, createDocument, createObject, defaultTextSpec, letterMeta, pathNode, underlayPlan, type LetterFont } from '@stitchpro/engine';
import { Editor, FONT_EDIT_CAP_MM, FontEditorSession, FontLibrary } from '../src/index';

/** Every capital a 200 x 1000 unit bar, advance 300. */
const bars: LetterFont = {
  name: 'Bars',
  native: false,
  capHeight: 1000,
  glyph: (ch) => (/[A-Z]/.test(ch) ? { advance: 300, contours: [[[0, 0], [200, 0], [200, -1000], [0, -1000]]] } : null),
  kerning: () => 0,
  chars: () => [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'],
};

function editor() {
  const fonts = new FontLibrary();
  fonts.add(bars);
  const ed = new Editor(createDocument({ closestJoin: false }), { fonts });
  ed.showRulers = false;
  return ed;
}
const spec = (o = {}) => defaultTextSpec({ text: 'ABC', font: 'Bars', stitch: 'fill', capHeight: 10, ...o });
const xs = (ed: Editor, letter: number) =>
  ed.doc.objects.filter((o) => letterMeta(o)?.letter === letter).flatMap((o) => o.points.map((n) => n.x));

describe('adding and editing text', () => {
  it('adds every letter as grouped pieces carrying textMeta, as one undo step', () => {
    const ed = editor();
    const id = ed.addText(spec());
    expect(ed.doc.objects).toHaveLength(3);
    expect(ed.doc.objects.every((o) => letterMeta(o)?.textId === id && o.groupId === id)).toBe(true);
    expect(ed.selectionOrder).toHaveLength(3);
    ed.undo();
    expect(ed.doc.objects).toHaveLength(0);
  });

  it('rebuilds from the stored spec with Edit text, in the same place in the sewing order', () => {
    const ed = editor();
    const before = createObject(ed.doc, { points: [pathNode(0, 50), pathNode(5, 50)] });
    ed.addObject(before);
    const id = ed.addText(spec());
    const after = createObject(ed.doc, { points: [pathNode(0, 60), pathNode(5, 60)] });
    ed.addObject(after);
    ed.editText(id, { ...ed.textSpec(id)!, text: 'ABCD' });
    expect(ed.doc.objects.map((o) => (letterMeta(o) ? 'T' : o.id === before.id ? 'B' : 'A')).join('')).toBe('BTTTTA');
    expect(ed.textSpec(id)!.text).toBe('ABCD');
  });

  it('keeps a moved text where it was moved', () => {
    const ed = editor();
    const id = ed.addText(spec());
    ed.moveSelection(20, 0);
    ed.commit('Move');
    const leftBefore = Math.min(...xs(ed, 0));
    ed.editText(id, { ...ed.textSpec(id)!, letterSpacing: 0 });
    expect(Math.min(...xs(ed, 0))).toBeCloseTo(leftBefore, 6);
  });

  it('skips underlay under small lettering', () => {
    const small = editor();
    small.addText(spec({ capHeight: 4 }));
    expect(underlayPlan(small.doc.objects[0]!)).toEqual([]);
    // At 30 mm each bar is 6 x 30 mm: a fill over 100 mm2 gets edge run + tatami.
    const big = editor();
    big.addText(spec({ capHeight: 30 }));
    expect(underlayPlan(big.doc.objects[0]!).map((p) => p.kind)).toEqual(['edge', 'tatami']);
  });

  it('enables Edit text and Letters only with lettering selected', () => {
    const ed = editor();
    expect(ed.isEnabled('text.edit')).toBe(false);
    ed.addText(spec());
    expect(ed.isEnabled('text.edit')).toBe(true);
    const asked: unknown[] = [];
    ed.onAction((a, arg) => asked.push([a, arg]));
    ed.run('text.edit');
    ed.run('text.add');
    expect(asked).toEqual([['text', ed.selectedTextId()], ['text', null]]);
  });
});

describe('Letters mode', () => {
  it('moves, scales and resets one letter with its keys, others never move', () => {
    const ed = editor();
    ed.addText(spec());
    const b0 = xs(ed, 0);
    const c0 = xs(ed, 2);
    ed.keyDown({ key: 'l' });
    expect(ed.toolName).toBe('letters');
    ed.keyDown({ key: 'Tab' }); // letter 1 (B)
    const b1 = Math.min(...xs(ed, 1));
    ed.keyDown({ key: 'd' });
    expect(Math.min(...xs(ed, 1))).toBeCloseTo(b1 + 0.5, 6);
    ed.keyDown({ key: 'D', shift: true });
    expect(Math.min(...xs(ed, 1))).toBeCloseTo(b1 + 5.5, 6);
    ed.keyDown({ key: 'x' });
    expect(xs(ed, 0)).toEqual(b0);
    expect(xs(ed, 2)).toEqual(c0);
    const id = ed.selectedTextId()!;
    expect(ed.textSpec(id)!.letters[1]).toMatchObject({ dx: 5.5, scale: 1.05 });
    ed.keyDown({ key: 'r' });
    expect(ed.textSpec(id)!.letters[1]).toBeUndefined();
    ed.keyDown({ key: 'e' });
    ed.keyDown({ key: 'b' });
    expect(ed.textSpec(id)!.letters).toEqual({});
  });

  it('takes priority over the single-letter shortcuts', () => {
    const ed = editor();
    ed.addText(spec());
    ed.setTool('letters');
    ed.keyDown({ key: 's' }); // would be SimStitch; here it moves the letter down
    expect(ed.simStitch).toBe(false);
    expect(ed.toolName).toBe('letters');
  });

  it('picks the letter clicked on', () => {
    const ed = editor();
    ed.addText(spec({ position: [50, 50] }));
    ed.setTool('letters');
    const x = (Math.min(...xs(ed, 2)) + Math.max(...xs(ed, 2))) / 2;
    ed.pointerDown({ x: x * 4, y: 50 * 4 });
    expect(ed.activeLetter?.letter).toBe(2);
  });
});

describe('font editor', () => {
  it('edits letters at 40 mm capital height and stores them in font units', () => {
    const font = createNativeFont('Mine');
    const s = new FontEditorSession(font);
    s.open('A');
    const ed = s.editor;
    expect(ed.doc.guides.some((g) => g.axis === 'h' && g.pos === -FONT_EDIT_CAP_MM)).toBe(true);
    ed.addObject(createObject(ed.doc, { stitchType: 'satin', points: [pathNode(10, 0, 'corner', 4), pathNode(10, -40, 'corner', 4)] }));
    s.setAdvance(500);
    s.open('B');
    expect(font.glyphs.A!.advance).toBe(500);
    expect(font.glyphs.A!.objects[0]!.points[1]).toMatchObject({ x: 250, y: -1000, width: 100 });
    s.open('A');
    expect(s.editor.doc.objects[0]!.points[1]!.y).toBeCloseTo(-40, 9);
  });

  it('drafts letters from a TrueType font, keeps kerning and makes a test line', () => {
    const s = new FontEditorSession(createNativeFont('Drafted'));
    expect(s.draftFrom(bars, ['A', 'B', 'z'])).toBe(2);
    // A bar drafts as one auto-digitized Column.
    expect(s.font.glyphs.A!.objects).toHaveLength(1);
    expect(s.font.glyphs.A!.objects[0]!.settings.stitchType).toBe('radial_satin');
    expect(s.font.glyphs.A!.objects[0]!.rail2.length).toBeGreaterThan(1);
    s.setKerning('AB', -20);
    expect(s.font.kerning.AB).toBe(-20);
    s.setKerning('AB', 0);
    expect(s.font.kerning.AB).toBeUndefined();
    expect(s.testLine('AB')).toHaveLength(2);
    expect(JSON.parse(s.toSpf())).toMatchObject({ format: 'stitchpro-font', name: 'Drafted' });
  });
});
