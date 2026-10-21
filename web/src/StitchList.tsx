// Stitch list (Shift+J): the needle points of the selected object.

import { formatLength, type Editor } from '@stitchpro/editor';
import { useEditorState } from './useEditor';

const MAX_ROWS = 500;

export function StitchList({ editor }: { editor: Editor }) {
  useEditorState(editor);
  const o = editor.selectedObjects()[0];
  const pts = o ? editor.stitches(o) : [];
  return (
    <section className="panel stitch-list" aria-label="Stitch list">
      <h2>Stitches{o ? ` — ${o.name}` : ''}</h2>
      {!o && <p className="muted">Select an object.</p>}
      <ol>
        {pts.slice(0, MAX_ROWS).map((p, i) => (
          <li key={i}>
            {formatLength(p[0], editor.units)}, {formatLength(p[1], editor.units)}
          </li>
        ))}
      </ol>
      {pts.length > MAX_ROWS && <p className="muted">… and {(pts.length - MAX_ROWS).toLocaleString()} more</p>}
    </section>
  );
}
