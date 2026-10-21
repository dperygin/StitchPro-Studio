// Stitch player: play / pause, step by stitch or by object, scrub through the needle sequence, speed.

import type { Editor } from '@stitchpro/editor';
import { useEditorState } from './useEditor';

export function PlayerControls({ editor }: { editor: Editor }) {
  useEditorState(editor);
  const total = editor.totalStitches();
  const p = editor.player;
  const index = p.index ?? total;
  return (
    <div className="player" aria-label="Stitch player">
      <button type="button" className="tb-button" disabled={!total} onClick={() => editor.playerStepObject(-1)} title="Back one object" aria-label="Previous object">
        ⏮
      </button>
      <button type="button" className="tb-button" disabled={!total} onClick={() => editor.playerStep(-1)} title="Back one stitch">
        ◀
      </button>
      <button type="button" className="tb-button" disabled={!total} onClick={() => editor.playerToggle()} title="Play / pause (Space)" data-testid="player-play">
        {p.playing ? '❚❚' : '▶'}
      </button>
      <button type="button" className="tb-button" disabled={!total} onClick={() => editor.playerStep(1)} title="Forward one stitch">
        ▶|
      </button>
      <button type="button" className="tb-button" disabled={!total} onClick={() => editor.playerStepObject(1)} title="Forward one object" aria-label="Next object">
        ⏭
      </button>
      <button type="button" className="tb-button" disabled={p.index === null} onClick={() => editor.playerStop()} title="Stop (show everything)">
        ■
      </button>
      <input type="range" min={0} max={total} value={index} aria-label="Stitch" onChange={(e) => editor.playerSeek(Number(e.target.value))} />
      <span className="muted">
        {index.toLocaleString()} / {total.toLocaleString()}
      </span>
      <select aria-label="Speed" value={p.speed} onChange={(e) => editor.setPlayerSpeed(Number(e.target.value))}>
        {[100, 400, 1500, 6000].map((s) => (
          <option key={s} value={s}>
            {s}/s
          </option>
        ))}
      </select>
    </div>
  );
}
