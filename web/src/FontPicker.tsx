// Font picker: live previews (laid out by the engine) and search; native fonts first.

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { defaultTextSpec, layoutText, materializePath, type LetterFont } from '@stitchpro/engine';
import type { FontLibrary } from '@stitchpro/editor';

/** Re-renders when fonts are added to the library. */
export function useFonts(library: FontLibrary): string[] {
  useSyncExternalStore(
    (cb) => library.subscribe(cb),
    () => library.names().length,
  );
  return library.names();
}

/** A preview of text in a font, drawn from the laid-out pieces. */
export function FontPreview({ font, text = 'AaBbCc', height = 28, width = 180 }: { font: LetterFont; text?: string; height?: number; width?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
    const t = layoutText(defaultTextSpec({ text, font: font.name, capHeight: 10, stitch: 'fill', align: 'left' }), font, 0);
    if (!t.pieces.length) return;
    const k = Math.min((height - 6) / (t.height * 1.4), (width - 6) / Math.max(1, t.width));
    ctx.save();
    ctx.translate(width / 2, height / 2);
    ctx.scale(k, k);
    ctx.fillStyle = getComputedStyle(c).color || '#222';
    ctx.strokeStyle = ctx.fillStyle;
    ctx.lineWidth = 1.2 / k;
    for (const p of t.pieces) {
      const rings = [p.points ?? [], ...(p.holes ?? [])].map((r) => materializePath(r, p.closed ?? false));
      ctx.beginPath();
      for (const r of rings) r.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      if (p.closed && (p.stitchType ?? p.settings?.stitchType) !== 'running') ctx.fill('evenodd');
      else ctx.stroke();
    }
    ctx.restore();
  }, [font, text, height, width]);
  return <canvas ref={ref} width={width} height={height} className="font-preview" aria-hidden />;
}

export function FontPicker({ library, value, onChange, previewText }: { library: FontLibrary; value: string; onChange: (name: string) => void; previewText?: string }) {
  const names = useFonts(library);
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const shown = names.filter((n) => !q || n.toLowerCase().includes(q));
  return (
    <div className="font-picker">
      <input type="search" placeholder="Search fonts" aria-label="Search fonts" value={query} onChange={(e) => setQuery(e.target.value)} />
      <ul role="listbox" aria-label="Fonts">
        {shown.map((n) => {
          const f = library.get(n)!;
          return (
            <li key={n} role="option" aria-selected={n === value}>
              <button type="button" className={`font-option${n === value ? ' checked' : ''}`} onClick={() => onChange(n)}>
                <span className="font-name">
                  {n}
                  {f.native ? <span className="badge">native</span> : null}
                </span>
                <FontPreview font={f} text={previewText?.trim() ? previewText.slice(0, 12) : 'AaBbCc'} />
              </button>
            </li>
          );
        })}
        {!shown.length && <li className="muted">No fonts{names.length ? ' match' : ' loaded yet'}.</li>}
      </ul>
    </div>
  );
}
