// Wires pointer/keyboard/wheel events on an element to the Editor. Middle drag pans, the
// wheel zooms, right click adds curve nodes (so the context menu is suppressed).

import type { Editor, KeyInput, PointerInput } from './editor';

function pointerInput(el: HTMLElement, e: PointerEvent | MouseEvent): PointerInput {
  const r = el.getBoundingClientRect();
  return {
    x: e.clientX - r.left,
    y: e.clientY - r.top,
    button: (e.button === 1 || e.button === 2 ? e.button : 0) as 0 | 1 | 2,
    shift: e.shiftKey,
    ctrl: e.ctrlKey || e.metaKey,
    alt: e.altKey,
    time: e.timeStamp,
  };
}

export function keyInput(e: KeyboardEvent): KeyInput {
  return { key: e.key, shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey, alt: e.altKey };
}

export function attachInput(editor: Editor, el: HTMLElement): () => void {
  let panning: { x: number; y: number } | null = null;
  const down = (e: PointerEvent) => {
    el.focus();
    el.setPointerCapture?.(e.pointerId);
    if (e.button === 1) {
      e.preventDefault();
      panning = { x: e.clientX, y: e.clientY };
      return;
    }
    editor.pointerDown(pointerInput(el, e));
  };
  const move = (e: PointerEvent) => {
    if (panning) {
      editor.panBy(e.clientX - panning.x, e.clientY - panning.y);
      panning = { x: e.clientX, y: e.clientY };
      return;
    }
    editor.pointerMove(pointerInput(el, e));
  };
  const up = (e: PointerEvent) => {
    el.releasePointerCapture?.(e.pointerId);
    if (panning) {
      panning = null;
      return;
    }
    editor.pointerUp(pointerInput(el, e));
  };
  const key = (e: KeyboardEvent) => {
    if (editor.keyDown(keyInput(e))) e.preventDefault();
  };
  const wheel = (e: WheelEvent) => {
    e.preventDefault();
    const r = el.getBoundingClientRect();
    editor.zoomAt([e.clientX - r.left, e.clientY - r.top], e.deltaY < 0 ? 1.1 : 1 / 1.1);
  };
  const menu = (e: Event) => e.preventDefault();
  const leave = () => {
    editor.pointer = null;
    editor.changed('overlay');
  };
  el.addEventListener('pointerdown', down);
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointerleave', leave);
  el.addEventListener('keydown', key);
  el.addEventListener('wheel', wheel, { passive: false });
  el.addEventListener('contextmenu', menu);
  return () => {
    el.removeEventListener('pointerdown', down);
    el.removeEventListener('pointermove', move);
    el.removeEventListener('pointerup', up);
    el.removeEventListener('pointerleave', leave);
    el.removeEventListener('keydown', key);
    el.removeEventListener('wheel', wheel);
    el.removeEventListener('contextmenu', menu);
  };
}
