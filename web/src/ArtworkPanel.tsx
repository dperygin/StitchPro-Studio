// Artwork (tracing pictures) panel: import, opacity, hide, lock, remove.

import type { Editor } from '@stitchpro/editor';
import { CommandButton } from './Toolbars';
import { useEditorState } from './useEditor';

export function ArtworkPanel({ editor }: { editor: Editor }) {
  useEditorState(editor);
  const art = editor.doc.artwork;
  return (
    <section className="panel artwork-list" aria-label="Artwork">
      <h2>Artwork</h2>
      <div className="panel-buttons">
        <CommandButton editor={editor} id="file.importArtwork" label="Import…" />
      </div>
      <ul>
        {art.map((a) => (
          <li key={a.id} className="artwork-row" data-testid="artwork-row">
            <span className="artwork-name" title={a.name}>
              {a.name}
            </span>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(a.opacity * 100)}
              disabled={a.locked}
              aria-label={`Opacity of ${a.name}`}
              onChange={(e) => editor.updateArtwork(a.id, { opacity: Number(e.target.value) / 100 })}
            />
            <label title="Visible">
              <input type="checkbox" checked={a.visible} aria-label={`Show ${a.name}`} onChange={(e) => editor.updateArtwork(a.id, { visible: e.target.checked })} />
              👁
            </label>
            <label title="Locked">
              <input type="checkbox" checked={a.locked} aria-label={`Lock ${a.name}`} onChange={(e) => editor.updateArtwork(a.id, { locked: e.target.checked })} />
              🔒
            </label>
            <button type="button" className="tb-button" title="Auto-digitize this picture" aria-label={`Digitize ${a.name}`} onClick={() => editor.run('dialog.autoDigitize', a.id)}>
              ✨
            </button>
            <button type="button" className="tb-button" disabled={a.locked} aria-label={`Remove ${a.name}`} onClick={() => editor.removeArtwork(a.id)}>
              ×
            </button>
          </li>
        ))}
      </ul>
      {!art.length && <p className="muted">No pictures.</p>}
    </section>
  );
}
