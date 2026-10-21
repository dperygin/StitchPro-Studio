// Text dialog: add or edit lettering. Every option maps onto the engine's TextSpec; the editor
// lays out, plans and adds the pieces.

import { useRef, useState } from 'react';
import { defaultTextSpec, materializePath, type TextSpec } from '@stitchpro/engine';
import { fromDisplay, toDisplay, type Editor } from '@stitchpro/editor';
import { FontPicker } from './FontPicker';
import { SpecialChars } from './SpecialChars';
import { loadFontFile } from './fonts';

const ALIGN: [TextSpec['align'], string][] = [
  ['left', 'Left'],
  ['centre', 'Centre'],
  ['right', 'Right'],
  ['full', 'Full'],
];
const BASELINES: [TextSpec['baseline'], string][] = [
  ['straight', 'Straight'],
  ['arcTop', 'Arc (top)'],
  ['arcBottom', 'Arc (bottom)'],
  ['custom', 'Drawn line'],
];
const ORDERS: [TextSpec['order'], string][] = [
  ['ltr', 'Left to right'],
  ['rtl', 'Right to left'],
  ['centreOut', 'Centre out'],
];
const ENVELOPES: [TextSpec['envelope'], string][] = [
  ['none', 'None'],
  ['archUp', 'Arch up'],
  ['archDown', 'Arch down'],
  ['bulge', 'Bulge'],
  ['pinch', 'Pinch'],
];
const STITCHES: [TextSpec['stitch'], string][] = [
  ['satin_fill', 'Satin fill (columns)'],
  ['fill', 'Tatami fill'],
  ['satin_outline', 'Satin outline'],
  ['running', 'Running outline'],
];

export function TextDialog({ editor, textId, onClose }: { editor: Editor; textId: number | null; onClose: () => void }) {
  const fonts = editor.fonts;
  const [spec, setSpec] = useState<TextSpec>(() => {
    const existing = textId !== null ? editor.textSpec(textId) : null;
    if (existing) return existing;
    const first = fonts.names()[0] ?? '';
    return defaultTextSpec({ font: first, color: [...editor.currentColor], position: [0, 0] });
  });
  const [error, setError] = useState('');
  const textRef = useRef<HTMLTextAreaElement>(null);
  const u = editor.units;
  const set = <K extends keyof TextSpec>(k: K, v: TextSpec[K]) => setSpec((s) => ({ ...s, [k]: v }));
  const font = fonts.get(spec.font);

  // A drawn custom baseline: the selected open line that isn't lettering.
  const line = editor.selectedObjects().find((o) => !o.closed && editor.textIdOf(o) === null && o.points.length >= 2);

  const insert = (ch: string) => {
    const el = textRef.current;
    const at = el ? el.selectionStart : spec.text.length;
    const end = el ? el.selectionEnd : spec.text.length;
    set('text', spec.text.slice(0, at) + ch + spec.text.slice(end));
  };

  const ok = () => {
    try {
      if (!spec.text.trim()) throw new Error('Type some text first');
      if (!font) throw new Error('Choose a font');
      const final = { ...spec, capHeight: Math.min(300, Math.max(1, spec.capHeight)) };
      if (final.baseline === 'custom') {
        if (!line) throw new Error('Select a drawn line to use as the baseline');
        final.customLine = materializePath(line.points, false);
      }
      if (textId === null) editor.addText(final);
      else editor.editText(textId, final);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const num = (k: 'capHeight' | 'letterSpacing' | 'arcRadius', length = true) => (
    <input
      type="number"
      step={length && u === 'in' ? 0.01 : 0.1}
      value={Number((length ? toDisplay(spec[k], u) : spec[k]).toFixed(3))}
      onChange={(e) => set(k, length ? fromDisplay(Number(e.target.value), u) : Number(e.target.value))}
      aria-label={k}
    />
  );

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <div className="dialog text-dialog" role="dialog" aria-label={textId === null ? 'Add text' : 'Edit text'} onMouseDown={(e) => e.stopPropagation()}>
        <h2>{textId === null ? 'Add text' : 'Edit text'}</h2>
        <div className="text-dialog-body">
          <div className="text-dialog-col">
            <label className="field-stack">
              Text
              <textarea ref={textRef} rows={3} value={spec.text} onChange={(e) => set('text', e.target.value)} aria-label="Text" />
            </label>
            <SpecialChars font={font} onPick={insert} />
            <FontPicker library={fonts} value={spec.font} onChange={(n) => set('font', n)} previewText={spec.text} />
            <label className="tb-button file-button">
              Load font file…
              <input
                type="file"
                accept=".spf,.ttf,.otf,.woff"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  try {
                    set('font', await loadFontFile(fonts, f));
                  } catch (err) {
                    setError((err as Error).message);
                  }
                }}
              />
            </label>
          </div>
          <div className="text-dialog-col">
            <div className="field">
              <label>Capital height (1-300 mm)</label>
              {num('capHeight')}
              <span className="unit">{u}</span>
            </div>
            <div className="field">
              <label>Letter spacing</label>
              {num('letterSpacing')}
              <span className="unit">{u}</span>
            </div>
            <div className="field">
              <label htmlFor="txt-kerning">Kerning</label>
              <input id="txt-kerning" type="checkbox" checked={spec.kerning} onChange={(e) => set('kerning', e.target.checked)} />
            </div>
            {font && !font.native && (
              <div className="field">
                <label htmlFor="txt-stitch">Stitch</label>
                <select id="txt-stitch" value={spec.stitch} onChange={(e) => set('stitch', e.target.value as TextSpec['stitch'])}>
                  {STITCHES.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="field">
              <label htmlFor="txt-align">Alignment</label>
              <select id="txt-align" value={spec.align} onChange={(e) => set('align', e.target.value as TextSpec['align'])}>
                {ALIGN.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="txt-lines">Line spacing (x capital height)</label>
              <input id="txt-lines" type="number" step={0.1} min={0.5} value={spec.lineSpacing} onChange={(e) => set('lineSpacing', Number(e.target.value))} />
            </div>
            <div className="field">
              <label htmlFor="txt-width">Letter width</label>
              <input id="txt-width" type="number" step={5} min={20} max={300} value={spec.widthPercent} onChange={(e) => set('widthPercent', Number(e.target.value))} />
              <span className="unit">%</span>
            </div>
            <div className="field">
              <label htmlFor="txt-slant">Slant</label>
              <input id="txt-slant" type="number" step={1} min={-45} max={45} value={spec.slant} onChange={(e) => set('slant', Number(e.target.value))} />
              <span className="unit">°</span>
            </div>
            <div className="field">
              <label htmlFor="txt-baseline">Baseline</label>
              <select id="txt-baseline" value={spec.baseline} onChange={(e) => set('baseline', e.target.value as TextSpec['baseline'])}>
                {BASELINES.map(([v, l]) => (
                  <option key={v} value={v} disabled={v === 'custom' && !line}>
                    {l}
                    {v === 'custom' && !line ? ' (select a line first)' : ''}
                  </option>
                ))}
              </select>
            </div>
            {(spec.baseline === 'arcTop' || spec.baseline === 'arcBottom') && (
              <div className="field">
                <label>Arc radius</label>
                {num('arcRadius')}
                <span className="unit">{u}</span>
              </div>
            )}
            <div className="field">
              <label htmlFor="txt-order">Sewing order</label>
              <select id="txt-order" value={spec.order} onChange={(e) => set('order', e.target.value as TextSpec['order'])}>
                {ORDERS.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="txt-envelope">Envelope</label>
              <select id="txt-envelope" value={spec.envelope} onChange={(e) => set('envelope', e.target.value as TextSpec['envelope'])}>
                {ENVELOPES.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </div>
            {spec.envelope !== 'none' && (
              <div className="field">
                <label htmlFor="txt-env-amount">Envelope amount</label>
                <input id="txt-env-amount" type="number" step={0.05} min={0} max={1} value={spec.envelopeAmount} onChange={(e) => set('envelopeAmount', Number(e.target.value))} />
              </div>
            )}
          </div>
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
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
