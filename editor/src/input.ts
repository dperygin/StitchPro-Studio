// Wires pointer/keyboard/wheel events on an element to the Editor.

import type { Editor } from './editor';

export function attachInput(editor: Editor, el: HTMLElement): () => void {
  const pos = (e: PointerEvent | WheelEvent) => {
    const r = el.getBoundingClientRect();
    return editor.view.toDesign([e.clientX - r.left, e.clientY - r.top]);
  };
  const down = (e: PointerEvent) => editor.pointerDown(pos(e));
  const move = (e: PointerEvent) => editor.pointerMove(pos(e));
  const up = (e: PointerEvent) => editor.pointerUp(pos(e));
  const key = (e: KeyboardEvent) => editor.keyDown(e.key);
  const wheel = (e: WheelEvent) => {
    e.preventDefault();
    const r = el.getBoundingClientRect();
    editor.zoomAt([e.clientX - r.left, e.clientY - r.top], e.deltaY < 0 ? 1.1 : 1 / 1.1);
  };
  el.addEventListener('pointerdown', down);
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', up);
  el.addEventListener('keydown', key);
  el.addEventListener('wheel', wheel, { passive: false });
  return () => {
    el.removeEventListener('pointerdown', down);
    el.removeEventListener('pointermove', move);
    el.removeEventListener('pointerup', up);
    el.removeEventListener('keydown', key);
    el.removeEventListener('wheel', wheel);
  };
}
