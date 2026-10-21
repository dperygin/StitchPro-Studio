import { describe, expect, it } from 'vitest';
import { Editor, fromDisplay, toDisplay } from '../src/index';

describe('editor scaffold', () => {
  it('notifies subscribers on change', () => {
    const editor = new Editor();
    let calls = 0;
    const off = editor.subscribe(() => calls++);
    editor.setUnits('in');
    editor.setUnits('in');
    expect(calls).toBe(1);
    off();
    editor.setUnits('mm');
    expect(calls).toBe(1);
  });

  it('keeps the design point under the cursor when zooming', () => {
    const editor = new Editor();
    const screen = { x: 200, y: 150 };
    const before = editor.view.toDesign(screen);
    editor.zoomAt(screen, 2);
    const after = editor.view.toDesign(screen);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });

  it('converts units', () => {
    expect(toDisplay(25.4, 'in')).toBe(1);
    expect(fromDisplay(2, 'in')).toBe(50.8);
    expect(toDisplay(10, 'mm')).toBe(10);
  });
});
