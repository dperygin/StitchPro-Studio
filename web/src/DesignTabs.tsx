import type { Editor, FontEditorSession } from '@stitchpro/editor';
import type { FileTarget } from './saveFile';

export interface Tab {
  id: number;
  editor: Editor;
  name: string;
  file: FileTarget;
  /** Font editor tabs. */
  session?: FontEditorSession;
}

export function DesignTabs({ tabs, activeId, onSelect, onClose }: { tabs: Tab[]; activeId: number; onSelect: (id: number) => void; onClose: (id: number) => void }) {
  return (
    <nav className="design-tabs" role="tablist">
      {tabs.map((t) => (
        <div key={t.id} className={`design-tab${t.id === activeId ? ' active' : ''}`} role="tab" aria-selected={t.id === activeId}>
          <button type="button" className="tab-name" onClick={() => onSelect(t.id)}>
            {t.session ? `Font: ${t.session.font.name}` : t.editor.doc.name || t.name}
          </button>
          <button type="button" className="tab-close" title="Close" aria-label={`Close ${t.name}`} onClick={() => onClose(t.id)}>
            ×
          </button>
        </div>
      ))}
    </nav>
  );
}
