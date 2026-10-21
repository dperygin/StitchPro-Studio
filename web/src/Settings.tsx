// Design settings: name, jumps and trims, ties, closest join, minimum stitch.

import { useState } from 'react';
import type { Editor } from '@stitchpro/editor';

type NumberKey = 'autoJumpThreshold' | 'trimThreshold' | 'joinDistance' | 'minStitch' | 'trimJumps';
type BoolKey = 'autoJump' | 'autoTrim' | 'closestJoin' | 'tieStitches';

const NUMBERS: [NumberKey, string, string][] = [
  ['autoJumpThreshold', 'Longest stitch before an auto jump', 'mm'],
  ['trimThreshold', 'Trim moves longer than', 'mm'],
  ['joinDistance', 'Closest join distance', 'mm'],
  ['minStitch', 'Drop stitches shorter than', 'mm'],
  ['trimJumps', 'Jumps a machine reads as a trim', ''],
];
const BOOLS: [BoolKey, string][] = [
  ['autoJump', 'Auto jump long stitches'],
  ['autoTrim', 'Auto trim'],
  ['closestJoin', 'Closest join'],
  ['tieStitches', 'Tie-in and tie-off stitches'],
];

export function Settings({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const d = editor.doc;
  const [name, setName] = useState(d.name);
  const [nums, setNums] = useState(() => Object.fromEntries(NUMBERS.map(([k]) => [k, String(d[k])])) as Record<NumberKey, string>);
  const [bools, setBools] = useState(() => Object.fromEntries(BOOLS.map(([k]) => [k, d[k]])) as Record<BoolKey, boolean>);
  const save = () => {
    const patch: Record<string, unknown> = { name, ...bools };
    for (const [k] of NUMBERS) {
      const v = Number(nums[k]);
      if (Number.isFinite(v) && v >= 0) patch[k] = k === 'trimJumps' ? Math.min(10, Math.max(1, Math.round(v))) : v;
    }
    editor.updateDoc(patch);
    onClose();
  };
  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <div className="dialog" role="dialog" aria-label="Design settings" onMouseDown={(e) => e.stopPropagation()}>
        <h2>Design settings</h2>
        <div className="field">
          <label htmlFor="set-name">Name</label>
          <input id="set-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        {NUMBERS.map(([k, label, unit]) => (
          <div className="field" key={k}>
            <label htmlFor={`set-${k}`}>{label}</label>
            <input id={`set-${k}`} type="number" min={0} step={k === 'trimJumps' ? 1 : 0.1} value={nums[k]} onChange={(e) => setNums({ ...nums, [k]: e.target.value })} />
            <span className="unit">{unit}</span>
          </div>
        ))}
        {BOOLS.map(([k, label]) => (
          <div className="field" key={k}>
            <label htmlFor={`set-${k}`}>{label}</label>
            <input id={`set-${k}`} type="checkbox" checked={bools[k]} onChange={(e) => setBools({ ...bools, [k]: e.target.checked })} />
          </div>
        ))}
        <div className="dialog-buttons">
          <button type="button" className="tb-button" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="tb-button primary" onClick={save}>
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
