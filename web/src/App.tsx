// Layout, tabs, dialogs, global keys.

import { useEffect, useState } from 'react';
import { useEditor } from './useEditor';
import { Toolbars } from './Toolbars';
import { CanvasView } from './CanvasView';
import { PropertiesPanel } from './PropertiesPanel';
import { PaletteBar } from './PaletteBar';
import { threadCharts } from './threads';

type ServerState = 'checking' | 'online' | 'offline';

export function App() {
  const editor = useEditor();
  const [server, setServer] = useState<ServerState>('checking');

  useEffect(() => {
    fetch('/api/health')
      .then((r) => setServer(r.ok ? 'online' : 'offline'))
      .catch(() => setServer('offline'));
  }, []);

  return (
    <div className="app">
      <header className="app-header">
        <h1>StitchPro Studio</h1>
        <span data-testid="server-status" className={`server ${server}`}>
          Server: {server}
        </span>
        <span className="muted">{threadCharts.length} thread charts</span>
        <button onClick={() => editor.setUnits(editor.units === 'mm' ? 'in' : 'mm')}>
          Units: {editor.units}
        </button>
      </header>
      <Toolbars />
      <main className="app-main">
        <CanvasView editor={editor} />
        <PropertiesPanel />
      </main>
      <PaletteBar />
    </div>
  );
}
