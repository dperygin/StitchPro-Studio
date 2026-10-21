// Tatami pattern gallery: a thumbnail of every pattern, stitched by the engine.

import { useEffect, useRef } from 'react';
import { FILL_PATTERNS, defaultSettings, polygonFromRings, sewnSpacing, tatamiLayer, tatamiParams, type FillPattern, type Point } from '@stitchpro/engine';
import type { Editor } from '@stitchpro/editor';

const SIZE = 44;
const SQUARE = polygonFromRings([[0, 0], [12, 0], [12, 12], [0, 12]]);
const cache = new Map<FillPattern, Point[]>();

function sample(pattern: FillPattern): Point[] {
  let pts = cache.get(pattern);
  if (!pts) {
    const s = sewnSpacing(defaultSettings({ stitchType: 'fill', fillPattern: pattern, fillRowSpacing: 0.8, fillStitchLength: 2.5, embossWidth: 6, embossHeight: 6 }));
    pts = tatamiLayer(SQUARE, { ...tatamiParams(s), pull: 0, travelOnEdge: false });
    cache.set(pattern, pts);
  }
  return pts;
}

function PatternThumb({ pattern }: { pattern: FillPattern }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = ref.current?.getContext('2d');
    if (!ctx) return;
    const k = SIZE / 12;
    ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.fillStyle = '#333';
    // Needle points show the pattern best.
    for (const [x, y] of sample(pattern)) ctx.fillRect(x * k - 0.6, y * k - 0.6, 1.2, 1.2);
  }, [pattern]);
  return <canvas ref={ref} width={SIZE} height={SIZE} aria-hidden />;
}

export function TatamiGallery({ editor, current }: { editor: Editor; current: FillPattern }) {
  return (
    <fieldset className="prop-section">
      <legend>Pattern</legend>
      <div className="gallery">
        {FILL_PATTERNS.map((p) => (
          <button key={p} type="button" className={`gallery-item${p === current ? ' checked' : ''}`} title={p} aria-pressed={p === current} onClick={() => editor.updateSelectedSettings({ fillPattern: p })}>
            <PatternThumb pattern={p} />
            <span>{p}</span>
          </button>
        ))}
      </div>
    </fieldset>
  );
}
