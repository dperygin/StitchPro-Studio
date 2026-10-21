// Thread chart picker: choose a chart, see the threads closest to the current colour (ΔE 2000),
// search the chart, click a thread to use it, or match the whole design to the chart.

import { useMemo, useState } from 'react';
import { POOR_MATCH_DELTA_E, threadsByCloseness } from '@stitchpro/engine';
import type { Editor } from '@stitchpro/editor';
import { threadCharts } from './threads';

export function ThreadPicker({ editor }: { editor: Editor }) {
  const [chart, setChart] = useState(editor.doc.threadChart || threadCharts[0]?.name || '');
  const [query, setQuery] = useState('');
  const threads = threadCharts.find((c) => c.name === chart)?.threads ?? [];
  const current = editor.currentColor;
  const closest = useMemo(() => threadsByCloseness(current, threads).slice(0, 8), [current, threads]);
  const q = query.trim().toLowerCase();
  const shown = q ? threads.filter((t) => t.code.toLowerCase().includes(q) || t.name.toLowerCase().includes(q)).slice(0, 120) : [];
  const use = (t: (typeof threads)[number]) => editor.useColour(t.rgb, { chart, code: t.code, name: t.name });

  return (
    <div className="thread-picker">
      <div className="field">
        <label htmlFor="thread-chart">Chart</label>
        <select id="thread-chart" value={chart} onChange={(e) => setChart(e.target.value)}>
          {threadCharts.map((c) => (
            <option key={c.name} value={c.name}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      <p className="muted small">Closest to the current colour</p>
      <ul className="closest-threads">
        {closest.map(({ thread: t, deltaE }) => (
          <li key={`${t.code}-${t.name}`}>
            <button type="button" className="thread-row" onClick={() => use(t)} title={`Use ${t.code} ${t.name}`}>
              <span className="thread-swatch" style={{ background: `rgb(${t.rgb.join(',')})` }} />
              <span className="thread-code">{t.code}</span>
              <span className="thread-name">{t.name}</span>
              <span className={`delta${deltaE > POOR_MATCH_DELTA_E ? ' poor' : ''}`}>ΔE {deltaE.toFixed(1)}</span>
            </button>
          </li>
        ))}
      </ul>
      <input type="search" placeholder="Search code or name" aria-label="Search threads" value={query} onChange={(e) => setQuery(e.target.value)} />
      {q && (
        <div className="thread-swatches">
          {shown.map((t) => (
            <button key={`${t.code}-${t.name}`} type="button" className="thread-swatch" title={`${t.code} ${t.name}`} style={{ background: `rgb(${t.rgb.join(',')})` }} onClick={() => use(t)} />
          ))}
          {!shown.length && <span className="muted">No match</span>}
        </div>
      )}
      <button type="button" className="tb-button" disabled={!threads.length} onClick={() => editor.matchColoursToChart(chart, threads)}>
        Match design to {chart}
      </button>
    </div>
  );
}
