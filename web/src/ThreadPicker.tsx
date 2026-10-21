// Thread chart picker: choose a chart, search, click a thread to use it.

import { useState } from 'react';
import type { Editor } from '@stitchpro/editor';
import { threadCharts } from './threads';

export function ThreadPicker({ editor }: { editor: Editor }) {
  const [chart, setChart] = useState(editor.doc.threadChart || threadCharts[0]?.name || '');
  const [query, setQuery] = useState('');
  const threads = threadCharts.find((c) => c.name === chart)?.threads ?? [];
  const q = query.trim().toLowerCase();
  const shown = (q ? threads.filter((t) => t.code.toLowerCase().includes(q) || t.name.toLowerCase().includes(q)) : threads).slice(0, 120);
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
      <input type="search" placeholder="Code or name" aria-label="Search threads" value={query} onChange={(e) => setQuery(e.target.value)} />
      <div className="thread-swatches">
        {shown.map((t) => (
          <button
            key={`${t.code}-${t.name}`}
            type="button"
            className="thread-swatch"
            title={`${t.code} ${t.name}`}
            style={{ background: `rgb(${t.rgb.join(',')})` }}
            onClick={() => editor.useColour(t.rgb, { chart, code: t.code, name: t.name })}
          />
        ))}
      </div>
    </div>
  );
}
