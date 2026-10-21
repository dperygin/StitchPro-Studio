// Colour bar: current colour, Pick Color, palette slots (click uses, double click edits,
// Shift+click removes), add / remove unused / hide unused, machine-command legend, player.

import { useRef } from 'react';
import { MARK_COLOURS, type Editor } from '@stitchpro/editor';
import type { MarkKind, RGB } from '@stitchpro/engine';
import { CommandButton } from './Toolbars';
import { PlayerControls } from './PlayerControls';
import { useEditorState } from './useEditor';

const css = (c: readonly number[]) => `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
const hex = (c: readonly number[]) => `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
const rgb = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

const LEGEND: [MarkKind, string][] = [
  ['start', 'Start'],
  ['end', 'End'],
  ['tie_in', 'Tie-in'],
  ['tie_off', 'Tie-off'],
  ['trim', 'Trim'],
  ['stop', 'Stop'],
  ['hoop_out', 'Hoop out'],
  ['color_change', 'Colour change'],
  ['travel', 'Travel'],
];

export function PaletteBar({ editor }: { editor: Editor }) {
  useEditorState(editor);
  const picker = useRef<HTMLInputElement>(null);
  const editing = useRef<number | null>(null);
  const palette = editor.doc.palette;
  const current = editor.currentColor;

  const editSlot = (i: number) => {
    editing.current = i;
    const input = picker.current;
    if (!input) return;
    input.value = hex(palette[i]!.color);
    input.click();
  };

  return (
    <section className="palette-bar" aria-label="Colours">
      <span className="current-colour" title="Current colour" style={{ background: css(current) }} data-testid="current-colour" />
      <CommandButton editor={editor} id="pick.colour" />
      <div className="slots">
        {palette.map((slot, i) => {
          const used = editor.isColourUsed(slot.color);
          if (editor.hideUnusedColours && !used) return null;
          return (
            <button
              key={i}
              type="button"
              className={`slot${used ? ' used' : ''}`}
              style={{ background: css(slot.color) }}
              title={`${slot.thread ? `${slot.thread.chart} ${slot.thread.code} ${slot.thread.name}` : css(slot.color)} — click to use, double click to edit, Shift+click to remove`}
              data-testid="palette-slot"
              onClick={(e) => {
                if (e.shiftKey) {
                  if (!editor.removePaletteSlot(i)) editor.setStatus('That colour is still used');
                } else editor.useColour(slot.color, slot.thread);
              }}
              onDoubleClick={() => editSlot(i)}
            />
          );
        })}
      </div>
      <input
        ref={picker}
        type="color"
        className="hidden-input"
        aria-hidden
        tabIndex={-1}
        onChange={(e) => {
          const i = editing.current;
          if (i === null) editor.addPaletteSlot(rgb(e.target.value));
          else editor.setPaletteSlot(i, { color: rgb(e.target.value), thread: null });
          editing.current = null;
        }}
      />
      <button
        type="button"
        className="tb-button"
        title="Add a colour"
        onClick={() => {
          editing.current = null;
          picker.current?.click();
        }}
      >
        + Add
      </button>
      <button type="button" className="tb-button" onClick={() => editor.removeUnusedColours()}>
        Remove unused
      </button>
      <label className="tb-field">
        <input type="checkbox" checked={editor.hideUnusedColours} onChange={() => editor.toggle('hideUnusedColours')} /> Hide unused
      </label>
      {editor.showMarks && (
        <ul className="legend" aria-label="Machine commands">
          {LEGEND.map(([k, label]) => (
            <li key={k}>
              <span className="legend-mark" style={{ background: MARK_COLOURS[k] }} /> {label}
            </li>
          ))}
        </ul>
      )}
      <PlayerControls editor={editor} />
    </section>
  );
}
