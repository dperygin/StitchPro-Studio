// Auto-digitize picture: trace an artwork picture into flat-colour shapes (with a live preview),
// then make draft stitches from them: tatami for wide shapes, satin columns for thin ones.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Editor } from '@stitchpro/editor';
import { DEFAULT_DIGITIZE, DEFAULT_TRACE, digitizeLayers, traceImage, tracedSvg, type Artwork, type PixelImage, type TracedLayer } from '@stitchpro/engine';
import { ARTWORK_ACCEPT, importArtworkFiles } from './artwork';
import { download, pickFiles } from './saveFile';
import { threadCharts } from './threads';
import { useEditorState } from './useEditor';

/** Pictures are traced at about 0.1 mm per pixel, at most this many pixels on the longer side. */
const TRACE_MAX_PX = 1000;
const PREVIEW_PX = 320;

/** An artwork picture resampled for tracing (once per picture). */
const pixelCache = new Map<string, Promise<PixelImage>>();
function tracePixels(a: Artwork): Promise<PixelImage> {
  const key = `${a.id}|${a.src.length}|${a.width}x${a.height}`;
  let hit = pixelCache.get(key);
  if (!hit) {
    hit = new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const longestMm = Math.max(a.width, a.height);
        const longestPx = Math.max(200, Math.min(TRACE_MAX_PX, longestMm / 0.1, Math.max(img.naturalWidth, img.naturalHeight)));
        const k = longestPx / Math.max(a.width, a.height);
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(2, Math.round(a.width * k));
        canvas.height = Math.max(2, Math.round(a.height * k));
        const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const d = ctx.getImageData(0, 0, canvas.width, canvas.height);
        resolve({ width: d.width, height: d.height, data: d.data });
      };
      img.onerror = () => reject(new Error('The picture could not be read'));
      img.src = a.src;
    });
    pixelCache.set(key, hit);
  }
  return hit;
}

function drawPreview(canvas: HTMLCanvasElement, a: Artwork, layers: readonly TracedLayer[]): void {
  const ctx = canvas.getContext('2d')!;
  const k = PREVIEW_PX / Math.max(a.width, a.height);
  canvas.width = Math.max(1, Math.round(a.width * k));
  canvas.height = Math.max(1, Math.round(a.height * k));
  // A checkerboard shows what is left out (background).
  for (let y = 0; y < canvas.height; y += 8) for (let x = 0; x < canvas.width; x += 8) {
    ctx.fillStyle = (x + y) % 16 ? '#ffffff' : '#eef0f3';
    ctx.fillRect(x, y, 8, 8);
  }
  ctx.setTransform(k, 0, 0, k, -a.x * k, -a.y * k);
  for (const l of layers) {
    ctx.fillStyle = `rgb(${l.color[0]}, ${l.color[1]}, ${l.color[2]})`;
    ctx.beginPath();
    for (const poly of l.region) for (const ring of [poly.outer, ...poly.holes]) ring.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.fill('evenodd');
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

export function AutoDigitizeDialog({ editor, artworkId, onClose }: { editor: Editor; artworkId: number | null; onClose: () => void }) {
  useEditorState(editor);
  const art = editor.doc.artwork;
  const [sourceId, setSourceId] = useState<number | null>(artworkId ?? art[art.length - 1]?.id ?? null);
  const source = art.find((a) => a.id === sourceId) ?? null;
  const [colours, setColours] = useState(DEFAULT_TRACE.colours);
  const [minArea, setMinArea] = useState(DEFAULT_TRACE.minArea);
  const [smoothing, setSmoothing] = useState(DEFAULT_TRACE.smoothing);
  const [dropBackground, setDropBackground] = useState(DEFAULT_TRACE.dropBackground);
  const [chart, setChart] = useState(editor.doc.threadChart && threadCharts.some((c) => c.name === editor.doc.threadChart) ? editor.doc.threadChart : '');
  const [columns, setColumns] = useState(true);
  const [columnMaxWidth, setColumnMaxWidth] = useState(DEFAULT_DIGITIZE.columnMaxWidth);
  const [overlap, setOverlap] = useState(DEFAULT_DIGITIZE.overlap);
  const [layers, setLayers] = useState<TracedLayer[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const preview = useRef<HTMLCanvasElement>(null);

  const threads = useMemo(() => threadCharts.find((c) => c.name === chart)?.threads, [chart]);

  // Trace again (after a short pause) whenever the picture or a tracing option changes.
  useEffect(() => {
    if (!source) return;
    let cancelled = false;
    setBusy(true);
    const timer = setTimeout(() => {
      tracePixels(source)
        .then((img) => {
          if (cancelled) return;
          const traced = traceImage(img, source, { colours, minArea, smoothing, dropBackground, threads, chart });
          setLayers(traced);
          setError('');
        })
        .catch((e: Error) => !cancelled && setError(e.message))
        .finally(() => !cancelled && setBusy(false));
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [source, colours, minArea, smoothing, dropBackground, threads, chart]);

  useEffect(() => {
    if (preview.current && source && layers) drawPreview(preview.current, source, layers);
  }, [source, layers]);

  const chooseFile = async () => {
    const files = await pickFiles(`${ARTWORK_ACCEPT},image/*`);
    if (!files.length) return;
    const before = new Set(editor.doc.artwork.map((a) => a.id));
    await importArtworkFiles(editor, files);
    const added = editor.doc.artwork.find((a) => !before.has(a.id));
    if (added) setSourceId(added.id);
  };

  const create = () => {
    if (!layers?.length) return;
    const objects = digitizeLayers(layers, { columnMaxWidth: columns ? columnMaxWidth : 0, overlap }, smoothing);
    const ids = editor.insertObjects(objects, 'Auto-digitize picture');
    editor.setStatus(`Auto-digitized ${layers.length} colour${layers.length === 1 ? '' : 's'} into ${ids.length} objects (drafts: check angles, order and pull)`);
    onClose();
  };

  const num = (label: string, id: string, value: number, set: (v: number) => void, min: number, max: number, step: number, unit = '') => (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} type="number" min={min} max={max} step={step} value={value} onChange={(e) => Number.isFinite(e.target.valueAsNumber) && set(Math.min(max, Math.max(min, e.target.valueAsNumber)))} />
      <span className="unit">{unit}</span>
    </div>
  );

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <div className="dialog auto-digitize" role="dialog" aria-label="Auto-digitize picture" onMouseDown={(e) => e.stopPropagation()}>
        <h2>Auto-digitize picture</h2>
        <p className="muted">Works best on logos and clip art with flat colours. The result is a draft to check and adjust.</p>
        <div className="auto-digitize-body">
          <div>
            <div className="field">
              <label htmlFor="ad-source">Picture</label>
              <select id="ad-source" value={sourceId ?? ''} onChange={(e) => setSourceId(e.target.value ? Number(e.target.value) : null)}>
                {!art.length && <option value="">No pictures yet</option>}
                {art.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
              <button type="button" className="tb-button" onClick={() => void chooseFile()}>
                Choose file…
              </button>
            </div>
            {num('Colours', 'ad-colours', colours, setColours, 2, 12, 1)}
            {num('Smallest shape', 'ad-min-area', minArea, setMinArea, 0.2, 50, 0.5, 'mm²')}
            {num('Smoothing', 'ad-smoothing', smoothing, setSmoothing, 0.05, 1, 0.05, 'mm')}
            <div className="field">
              <label htmlFor="ad-background">Leave out the background</label>
              <input id="ad-background" type="checkbox" checked={dropBackground} onChange={(e) => setDropBackground(e.target.checked)} />
            </div>
            <div className="field">
              <label htmlFor="ad-chart">Match to thread chart</label>
              <select id="ad-chart" value={chart} onChange={(e) => setChart(e.target.value)}>
                <option value="">(picture colours)</option>
                {threadCharts.map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="ad-columns">Satin columns for thin shapes</label>
              <input id="ad-columns" type="checkbox" checked={columns} onChange={(e) => setColumns(e.target.checked)} />
            </div>
            {columns && num('Thin means up to', 'ad-column-width', columnMaxWidth, setColumnMaxWidth, 1, 8, 0.5, 'mm')}
            {num('Overlap under later colours', 'ad-overlap', overlap, setOverlap, 0, 2, 0.1, 'mm')}
          </div>
          <div className="auto-digitize-preview">
            {source ? <canvas ref={preview} aria-label="Traced shapes preview" /> : <p className="muted">Choose a picture to trace.</p>}
            <p className="muted" data-testid="trace-summary">
              {error || (busy ? 'Tracing…' : layers ? `${layers.length} colour${layers.length === 1 ? '' : 's'}` : '')}
            </p>
            <ul className="trace-colours">
              {(layers ?? []).map((l, i) => (
                <li key={i}>
                  <span className="swatch" style={{ background: `rgb(${l.color.join(', ')})` }} /> {l.thread ? `${l.thread.code} ${l.thread.name}` : `rgb(${l.color.join(', ')})`}{' '}
                  <span className="muted">{l.area.toFixed(0)} mm²</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div className="dialog-buttons">
          <button type="button" className="tb-button" disabled={!layers?.length} onClick={() => layers && download(`${source?.name.replace(/\.[^.]+$/, '') || 'traced'}.svg`, tracedSvg(layers), 'image/svg+xml')}>
            Save traced SVG
          </button>
          <button type="button" className="tb-button" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="tb-button primary" disabled={!layers?.length || busy} onClick={create}>
            Create stitches
          </button>
        </div>
      </div>
    </div>
  );
}
