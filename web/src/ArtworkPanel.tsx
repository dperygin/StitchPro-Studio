// Artwork (tracing pictures) panel. Importing pictures arrives with the import step.

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
          <li key={a.id}>
            {a.name} <span className="muted">{Math.round(a.opacity * 100)}%</span>
          </li>
        ))}
      </ul>
      {!art.length && <p className="muted">No pictures.</p>}
    </section>
  );
}
