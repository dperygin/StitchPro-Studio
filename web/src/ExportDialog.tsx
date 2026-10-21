// Export dialog: format plus "also export as" boxes, the machine settings, and a summary of
// what the machine file will hold (stitches, colours, trims, stops, size).

import { useMemo, useState } from 'react';
import { formatLength, type Editor } from '@stitchpro/editor';
import { buildExportPlan, designReport } from '@stitchpro/engine';
import { MACHINE_FORMATS } from './machineImport';

type NumberKey = 'autoJumpThreshold' | 'trimThreshold' | 'minStitch' | 'trimJumps';
type BoolKey = 'autoJump' | 'autoTrim' | 'tieStitches';

const NUMBERS: [NumberKey, string, string][] = [
  ['autoJumpThreshold', 'Longest stitch before an auto jump', 'mm'],
  ['trimThreshold', 'Trim moves longer than', 'mm'],
  ['minStitch', 'Drop stitches shorter than', 'mm'],
  ['trimJumps', 'Jumps a machine reads as a trim', ''],
];
const BOOLS: [BoolKey, string][] = [
  ['autoJump', 'Auto jump long stitches'],
  ['autoTrim', 'Auto trim'],
  ['tieStitches', 'Tie-in and tie-off stitches'],
];

export function ExportDialog({ editor, format, onExport, onClose }: { editor: Editor; format: string; onExport: (formats: string[]) => void; onClose: () => void }) {
  const d = editor.doc;
  const [main, setMain] = useState(format);
  const [also, setAlso] = useState<Set<string>>(new Set());
  const [nums, setNums] = useState(() => Object.fromEntries(NUMBERS.map(([k]) => [k, String(d[k])])) as Record<NumberKey, string>);
  const [bools, setBools] = useState(() => Object.fromEntries(BOOLS.map(([k]) => [k, d[k]])) as Record<BoolKey, boolean>);

  const patch = useMemo(() => {
    const p: Record<string, number | boolean> = { ...bools };
    for (const [k] of NUMBERS) {
      const v = Number(nums[k]);
      if (Number.isFinite(v) && v >= 0) p[k] = k === 'trimJumps' ? Math.min(10, Math.max(1, Math.round(v))) : v;
    }
    return p;
  }, [nums, bools]);
  // The summary follows the settings as they are edited.
  const report = useMemo(() => designReport(buildExportPlan({ ...editor.doc, ...patch }, (o) => editor.stitches(o))), [editor, patch]);

  const ok = () => {
    if (Object.entries(patch).some(([k, v]) => d[k as NumberKey | BoolKey] !== v)) editor.updateDoc(patch);
    onExport([main, ...MACHINE_FORMATS.filter((f) => f !== main && also.has(f))]);
    onClose();
  };
  const u = editor.units;
  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <div className="dialog" role="dialog" aria-label="Export machine file" onMouseDown={(e) => e.stopPropagation()}>
        <h2>Export machine file</h2>
        <div className="field">
          <label htmlFor="exp-format">Format</label>
          <select id="exp-format" value={main} onChange={(e) => setMain(e.target.value)}>
            {MACHINE_FORMATS.map((f) => (
              <option key={f} value={f}>
                {f.toUpperCase()}
              </option>
            ))}
          </select>
        </div>
        <fieldset className="also-export">
          <legend>Also export as</legend>
          {MACHINE_FORMATS.filter((f) => f !== main).map((f) => (
            <label key={f}>
              <input
                type="checkbox"
                checked={also.has(f)}
                onChange={(e) => {
                  const next = new Set(also);
                  if (e.target.checked) next.add(f);
                  else next.delete(f);
                  setAlso(next);
                }}
              />{' '}
              {f.toUpperCase()}
            </label>
          ))}
        </fieldset>
        <h3>Machine settings</h3>
        {NUMBERS.map(([k, label, unit]) => (
          <div className="field" key={k}>
            <label htmlFor={`exp-${k}`}>{label}</label>
            <input id={`exp-${k}`} type="number" min={0} step={k === 'trimJumps' ? 1 : 0.1} value={nums[k]} onChange={(e) => setNums({ ...nums, [k]: e.target.value })} />
            <span className="unit">{unit}</span>
          </div>
        ))}
        {BOOLS.map(([k, label]) => (
          <div className="field" key={k}>
            <label htmlFor={`exp-${k}`}>{label}</label>
            <input id={`exp-${k}`} type="checkbox" checked={bools[k]} onChange={(e) => setBools({ ...bools, [k]: e.target.checked })} />
          </div>
        ))}
        <h3>Summary</h3>
        <dl className="export-summary" data-testid="export-summary">
          <dt>Stitches</dt>
          <dd>{report.stitches.toLocaleString()}</dd>
          <dt>Colours</dt>
          <dd>{report.blocks.length}</dd>
          <dt>Trims</dt>
          <dd>{report.trims}</dd>
          <dt>Stops</dt>
          <dd>{report.stops}</dd>
          <dt>Size</dt>
          <dd>
            {formatLength(report.width, u)} x {formatLength(report.height, u)}
          </dd>
        </dl>
        <div className="dialog-buttons">
          <button type="button" className="tb-button" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="tb-button primary" onClick={ok}>
            Export
          </button>
        </div>
      </div>
    </div>
  );
}
