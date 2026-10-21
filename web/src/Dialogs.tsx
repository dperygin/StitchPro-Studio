// Tool dialogs: they collect options and call the editor method that does the work.

import { useState } from 'react';
import { BUILTIN_MOTIFS } from '@stitchpro/engine';
import { fromDisplay, toDisplay, type Editor } from '@stitchpro/editor';

interface FieldSpec {
  key: string;
  label: string;
  kind: 'number' | 'length' | 'bool' | 'choice';
  initial: number | boolean | string;
  min?: number;
  max?: number;
  step?: number;
  options?: { value: string; label: string }[];
}

interface DialogSpec {
  title: string;
  fields: FieldSpec[];
  apply: (ed: Editor, v: Record<string, number | boolean | string>) => void;
}

/** Copy-tool dialogs by command id. Lengths are entered in the display units. */
export const DIALOGS: Record<string, (ed: Editor) => DialogSpec> = {
  'dialog.array': () => ({
    title: 'Array',
    fields: [
      { key: 'rows', label: 'Rows', kind: 'number', initial: 2, min: 1, max: 50, step: 1 },
      { key: 'cols', label: 'Columns', kind: 'number', initial: 3, min: 1, max: 50, step: 1 },
      { key: 'dx', label: 'Column spacing', kind: 'length', initial: 20 },
      { key: 'dy', label: 'Row spacing', kind: 'length', initial: 20 },
    ],
    apply: (ed, v) => ed.arrayCopies(Number(v.rows), Number(v.cols), Number(v.dx), Number(v.dy)),
  }),
  'dialog.mirror': () => ({
    title: 'Mirror',
    fields: [
      {
        key: 'axis',
        label: 'Mirror',
        kind: 'choice',
        initial: 'horizontal',
        options: [
          { value: 'horizontal', label: 'Left - right (copy to the right)' },
          { value: 'vertical', label: 'Top - bottom (copy below)' },
        ],
      },
      { key: 'gap', label: 'Gap', kind: 'length', initial: 0 },
    ],
    apply: (ed, v) => ed.mirrorCopy(v.axis === 'vertical', Number(v.gap)),
  }),
  'dialog.kaleidoscope': (ed) => {
    const box = ed.selectionBox();
    const cy = box ? box.maxY + (box.maxY - box.minY) : 0;
    const cx = box ? (box.minX + box.maxX) / 2 : 0;
    return {
      title: 'Circle / Kaleidoscope',
      fields: [
        { key: 'n', label: 'Copies round the circle', kind: 'number', initial: 6, min: 2, max: 72, step: 1 },
        { key: 'cx', label: 'Centre X', kind: 'length', initial: cx },
        { key: 'cy', label: 'Centre Y', kind: 'length', initial: cy },
        { key: 'reflect', label: 'Kaleidoscope (every other copy reflected)', kind: 'bool', initial: false },
      ],
      apply: (e, v) => e.circleCopies(Number(v.n), [Number(v.cx), Number(v.cy)], Boolean(v.reflect)),
    };
  },
  'dialog.insertOffset': () => ({
    title: 'Insert offset',
    fields: [{ key: 'd', label: 'Offset (negative = inside)', kind: 'length', initial: 2 }],
    apply: (ed, v) => ed.insertOffset(Number(v.d)),
  }),
  'dialog.addBorder': () => ({
    title: 'Add border',
    fields: [
      { key: 'd', label: 'Offset', kind: 'length', initial: 3 },
      { key: 'motif', label: 'Motif', kind: 'choice', initial: 'wave', options: BUILTIN_MOTIFS.map((m) => ({ value: m.name, label: m.name })) },
    ],
    apply: (ed, v) => ed.addBorder(Number(v.d), String(v.motif)),
  }),
};

export function ToolDialog({ editor, id, onClose }: { editor: Editor; id: string; onClose: () => void }) {
  const make = DIALOGS[id];
  const [spec] = useState(() => make?.(editor));
  const u = editor.units;
  const [values, setValues] = useState<Record<string, string | boolean>>(() =>
    Object.fromEntries(
      (spec?.fields ?? []).map((f) => [f.key, f.kind === 'bool' ? Boolean(f.initial) : f.kind === 'length' ? String(Number(toDisplay(Number(f.initial), u).toFixed(3))) : String(f.initial)]),
    ),
  );
  if (!spec) return null;
  const ok = () => {
    const out: Record<string, number | boolean | string> = {};
    for (const f of spec.fields) {
      const v = values[f.key]!;
      out[f.key] = f.kind === 'bool' ? Boolean(v) : f.kind === 'choice' ? String(v) : f.kind === 'length' ? fromDisplay(Number(v), u) : Number(v);
    }
    spec.apply(editor, out);
    onClose();
  };
  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <div className="dialog" role="dialog" aria-label={spec.title} onMouseDown={(e) => e.stopPropagation()}>
        <h2>{spec.title}</h2>
        {spec.fields.map((f) => (
          <div className="field" key={f.key}>
            <label htmlFor={`dlg-${f.key}`}>{f.label}</label>
            {f.kind === 'bool' ? (
              <input id={`dlg-${f.key}`} type="checkbox" checked={Boolean(values[f.key])} onChange={(e) => setValues({ ...values, [f.key]: e.target.checked })} />
            ) : f.kind === 'choice' ? (
              <select id={`dlg-${f.key}`} value={String(values[f.key])} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}>
                {f.options!.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                id={`dlg-${f.key}`}
                type="number"
                min={f.min}
                max={f.max}
                step={f.step ?? (u === 'in' ? 0.01 : 0.1)}
                value={String(values[f.key])}
                onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
                onKeyDown={(e) => e.key === 'Enter' && ok()}
              />
            )}
            <span className="unit">{f.kind === 'length' ? u : ''}</span>
          </div>
        ))}
        <div className="dialog-buttons">
          <button type="button" className="tb-button" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="tb-button primary" onClick={ok}>
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
