// Font editor tab: a letter grid, the letter's advance, kerning pairs, a test line, drafting
// from an outline font, and saving to fonts_spf/ through the server.

import { useState, useSyncExternalStore } from 'react';
import { nativeLetterFont, parseSpf } from '@stitchpro/engine';
import { FONT_CHARS, type FontEditorSession, type FontLibrary } from '@stitchpro/editor';
import { FontPreview, useFonts } from './FontPicker';

function useSession(session: FontEditorSession): number {
  return useSyncExternalStore(
    (cb) => session.subscribe(cb),
    () => session.editor.revision + Object.keys(session.font.glyphs).length * 1e6 + Object.keys(session.font.kerning).length,
  );
}

export function LetterGrid({ session }: { session: FontEditorSession }) {
  useSession(session);
  return (
    <section className="panel letter-grid" aria-label="Letters">
      <h2>Letters</h2>
      <div className="letters">
        {FONT_CHARS.map((c) => (
          <button
            key={c}
            type="button"
            className={`letter-button${c === session.char ? ' checked' : ''}${session.font.glyphs[c]?.objects.length ? ' done' : ''}`}
            title={session.font.glyphs[c] ? `${c}: ${session.font.glyphs[c]!.objects.length} pieces` : `${c}: empty`}
            onClick={() => session.open(c)}
          >
            {c}
          </button>
        ))}
      </div>
    </section>
  );
}

export function FontEditorPanel({ session, fonts }: { session: FontEditorSession; fonts: FontLibrary }) {
  useSession(session);
  const names = useFonts(fonts);
  const outline = names.filter((n) => !fonts.get(n)!.native);
  const [draftFrom, setDraftFrom] = useState(outline[0] ?? '');
  const [pair, setPair] = useState('AV');
  const [test, setTest] = useState('Hello');
  const [message, setMessage] = useState('');
  const f = session.font;

  const save = async (overwrite = false): Promise<void> => {
    const body = JSON.parse(session.toSpf());
    const res = await fetch(`/api/fonts${overwrite ? '?overwrite=true' : ''}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (res.status === 409 && !overwrite) {
      if (window.confirm(`A saved font named "${f.name}" already exists. Replace it?`)) return save(true);
      return;
    }
    if (!res.ok) {
      setMessage(`Saving failed (${res.status})`);
      return;
    }
    const { file } = await res.json();
    fonts.addNative(parseSpf(session.toSpf()));
    setMessage(`Saved ${file} to fonts_spf/`);
  };

  return (
    <section className="panel font-editor" aria-label="Font editor">
      <h2>Font editor</h2>
      <div className="field">
        <label htmlFor="fe-name">Name</label>
        <input id="fe-name" defaultValue={f.name} onBlur={(e) => (f.name = e.target.value.trim() || f.name)} />
      </div>
      <div className="field">
        <label htmlFor="fe-license">Licence</label>
        <input id="fe-license" defaultValue={f.license} onBlur={(e) => (f.license = e.target.value)} />
      </div>
      <div className="field">
        <label>Sizes (mm)</label>
        <input type="number" aria-label="Smallest size" defaultValue={f.sizeRange[0]} onBlur={(e) => (f.sizeRange = [Number(e.target.value), f.sizeRange[1]])} />
        <input type="number" aria-label="Largest size" defaultValue={f.sizeRange[1]} onBlur={(e) => (f.sizeRange = [f.sizeRange[0], Number(e.target.value)])} />
      </div>
      <fieldset className="prop-section">
        <legend>Letter “{session.char}”</legend>
        <div className="field">
          <label htmlFor="fe-advance">Advance (font units)</label>
          <input id="fe-advance" type="number" step={10} value={session.advance()} onChange={(e) => session.setAdvance(Number(e.target.value))} />
        </div>
        <p className="muted small">Edit at 40 mm capital height. Guides: baseline, x-height, capital height, descender and the advance.</p>
      </fieldset>
      <fieldset className="prop-section">
        <legend>Kerning</legend>
        <div className="field">
          <input aria-label="Kerning pair" maxLength={2} value={pair} onChange={(e) => setPair(e.target.value)} style={{ width: 48 }} />
          <input
            type="number"
            aria-label="Kerning (font units)"
            step={10}
            value={f.kerning[pair] ?? 0}
            onChange={(e) => session.setKerning(pair, Number(e.target.value))}
          />
          <span className="unit">units</span>
        </div>
      </fieldset>
      <fieldset className="prop-section">
        <legend>Test line</legend>
        <input aria-label="Test line" value={test} onChange={(e) => setTest(e.target.value)} style={{ width: '100%' }} />
        <FontPreview key={`${session.editor.revision}-${test}-${Object.keys(f.kerning).length}`} font={nativeLetterFont(f)} text={test} width={260} height={60} />
      </fieldset>
      <fieldset className="prop-section">
        <legend>Draft</legend>
        <div className="field">
          <select aria-label="Draft from font" value={draftFrom} onChange={(e) => setDraftFrom(e.target.value)}>
            {outline.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="tb-button"
            disabled={!draftFrom}
            onClick={() => {
              const src = fonts.get(draftFrom);
              if (src && window.confirm(`Draft every letter from ${draftFrom}? Letters already drawn are replaced.`)) {
                setMessage(`Drafted ${session.draftFrom(src)} letters from ${draftFrom}`);
              }
            }}
          >
            Draft from font
          </button>
        </div>
      </fieldset>
      <div className="panel-buttons">
        <button type="button" className="tb-button primary" onClick={() => void save()}>
          Save to fonts_spf/
        </button>
      </div>
      {message && (
        <p className="muted" role="status">
          {message}
        </p>
      )}
    </section>
  );
}
