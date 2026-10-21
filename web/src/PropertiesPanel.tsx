// Properties of the selected objects: name, stitch type, every setting the type uses (always
// in mm), underlay 1 and 2, effects, stop after, hoop out, colour and thread, stitch count,
// copy/apply properties, size and position.

import { STITCH_TYPES, STITCH_TYPE_LABELS, type StitchSettings, type StitchType } from '@stitchpro/engine';
import { settingSections, underlaySections, type Editor, type SettingField } from '@stitchpro/editor';
import { CommandButton } from './Toolbars';
import { SizeFields } from './SizeFields';
import { TatamiGallery } from './TatamiGallery';
import { ThreadPicker } from './ThreadPicker';
import { useEditorState } from './useEditor';

const hex = (c: readonly number[]) => `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
const rgb = (h: string): [number, number, number] => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

function SettingInput({ editor, field, settings }: { editor: Editor; field: SettingField; settings: StitchSettings }) {
  const value = settings[field.key];
  const id = `setting-${field.key}`;
  const set = (v: unknown, soon = false) => editor.updateSelectedSettings({ [field.key]: v } as Partial<StitchSettings>, soon);
  let input: React.ReactNode;
  if (field.kind === 'bool') {
    input = <input id={id} type="checkbox" checked={Boolean(value)} onChange={(e) => set(e.target.checked)} />;
  } else if (field.kind === 'enum') {
    input = (
      <select id={id} value={String(value)} onChange={(e) => set(e.target.value)}>
        {field.options!.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  } else if (field.kind === 'text') {
    input = <input id={id} type="text" defaultValue={String(value)} key={String(value)} onBlur={(e) => e.target.value !== value && set(e.target.value)} />;
  } else {
    input = (
      <input
        id={id}
        type="number"
        min={field.min}
        max={field.max}
        step={field.step}
        value={Number(value)}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v)) set(field.min !== undefined || field.max !== undefined ? Math.min(field.max ?? v, Math.max(field.min ?? v, v)) : v, true);
        }}
      />
    );
  }
  return (
    <div className="field">
      <label htmlFor={id}>{field.label}</label>
      {input}
      {field.unit && <span className="unit">{field.unit === 'deg' ? '°' : field.unit === 'x' ? '' : field.unit}</span>}
    </div>
  );
}

export function PropertiesPanel({ editor }: { editor: Editor }) {
  useEditorState(editor);
  const sel = editor.selectedObjects();
  const o = sel[0];
  if (!o) {
    return (
      <section className="panel properties" aria-label="Properties">
        <h2>Properties</h2>
        <p className="muted">Select an object to see its properties.</p>
        <p className="muted">
          New objects: {STITCH_TYPE_LABELS[editor.drawMode.stitchType]}, {editor.drawMode.closed ? 'closed' : 'open'}
        </p>
      </section>
    );
  }
  const s = o.settings;
  const sections = [...settingSections(s.stitchType, s), ...underlaySections(s.stitchType)];
  const count = sel.reduce((n, x) => n + editor.stitchCount(x), 0);
  return (
    <section className="panel properties" aria-label="Properties">
      <h2>Properties{sel.length > 1 ? ` (${sel.length} objects)` : ''}</h2>
      <div className="field">
        <label htmlFor="prop-name">Name</label>
        <input id="prop-name" type="text" defaultValue={o.name} key={`${o.id}-${o.name}`} onBlur={(e) => e.target.value !== o.name && editor.updateSelected({ name: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} />
      </div>
      <div className="field">
        <label htmlFor="prop-type">Stitch type</label>
        <select id="prop-type" value={s.stitchType} onChange={(e) => editor.setStitchType(e.target.value as StitchType)}>
          {STITCH_TYPES.map((t) => (
            <option key={t} value={t}>
              {STITCH_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="prop-closed">Closed</label>
        <input id="prop-closed" type="checkbox" checked={o.closed} onChange={(e) => editor.updateSelected({ closed: e.target.checked })} />
      </div>
      {s.stitchType === 'fill' && <TatamiGallery editor={editor} current={s.fillPattern} />}
      {sections.map((sec) => (
        <fieldset key={sec.title} className="prop-section">
          <legend>{sec.title}</legend>
          {sec.fields.map((f) => (
            <SettingInput key={f.key} editor={editor} field={f} settings={s} />
          ))}
        </fieldset>
      ))}
      <fieldset className="prop-section">
        <legend>Sewing</legend>
        <div className="field">
          <label htmlFor="prop-stop">Stop after</label>
          <input id="prop-stop" type="checkbox" checked={o.stopAfter} onChange={(e) => editor.updateSelected({ stopAfter: e.target.checked })} />
        </div>
        <div className="field">
          <label>Hoop out</label>
          {o.hoopOut ? (
            <>
              <span>
                {o.hoopOut[0].toFixed(1)}, {o.hoopOut[1].toFixed(1)} mm
              </span>
              <button type="button" className="tb-button" onClick={() => editor.updateSelected({ hoopOut: null })}>
                Clear
              </button>
            </>
          ) : (
            <CommandButton editor={editor} id="pick.hoopOut" label="Set…" />
          )}
        </div>
        <div className="field">
          <label>Stitches</label>
          <span data-testid="prop-stitch-count">{count.toLocaleString()}</span>
        </div>
      </fieldset>
      <fieldset className="prop-section">
        <legend>Colour</legend>
        <div className="field">
          <label htmlFor="prop-colour">Colour</label>
          <input id="prop-colour" type="color" value={hex(o.color)} onChange={(e) => editor.useColour(rgb(e.target.value))} />
          {o.thread && <span className="muted">{`${o.thread.chart} ${o.thread.code} ${o.thread.name}`}</span>}
        </div>
        <ThreadPicker editor={editor} />
      </fieldset>
      <fieldset className="prop-section">
        <legend>Size and position</legend>
        <SizeFields editor={editor} />
      </fieldset>
      <div className="panel-buttons">
        <CommandButton editor={editor} id="edit.copyProperties" />
        <CommandButton editor={editor} id="edit.applyProperties" />
      </div>
    </section>
  );
}
