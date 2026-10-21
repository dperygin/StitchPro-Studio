// Layout, tabs, dialogs, global keys. The shell holds open designs (one Editor each, sharing
// fonts and clipboard) and handles what only the browser can do: files, downloads, dialogs.

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Clipboard, Editor, FontEditorSession, FontLibrary, formatLength, keyInput, type HostAction } from '@stitchpro/editor';
import { createDocument, createNativeFont } from '@stitchpro/engine';
import { useEditorState } from './useEditor';
import { Toolbars } from './Toolbars';
import { CanvasView } from './CanvasView';
import { Scrollbars } from './Scrollbars';
import { DesignTabs, type Tab } from './DesignTabs';
import { ObjectList } from './ObjectList';
import { ArtworkPanel } from './ArtworkPanel';
import { PropertiesPanel } from './PropertiesPanel';
import { StitchList } from './StitchList';
import { PaletteBar } from './PaletteBar';
import { Settings } from './Settings';
import { ToolDialog } from './Dialogs';
import { download, openDesigns, saveDesign } from './saveFile';
import { decodeArtwork } from './artwork';
import { TextDialog } from './TextDialog';
import { FontEditorPanel, LetterGrid } from './FontEditorPanel';
import { loadBundledFonts } from './fonts';

type ServerState = 'checking' | 'online' | 'offline';

let tabCounter = 0;

export function App() {
  const fonts = useMemo(() => new FontLibrary(), []);
  const clipboard = useMemo(() => new Clipboard(), []);
  const newTab = (doc = createDocument(), name = 'Untitled'): Tab => ({ id: ++tabCounter, editor: new Editor(doc, { fonts, clipboard }), name, file: null });
  const [tabs, setTabs] = useState<Tab[]>(() => [newTab()]);
  const [activeId, setActiveId] = useState(() => tabs[0]!.id);
  const [server, setServer] = useState<ServerState>('checking');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [dialog, setDialog] = useState<string | null>(null);
  const [textDialog, setTextDialog] = useState<{ textId: number | null } | null>(null);
  const active = tabs.find((t) => t.id === activeId) ?? tabs[0]!;
  const session = active.session ?? null;
  // A font tab shows the editor of the letter being edited (a new one per letter).
  useSyncExternalStore(
    (cb) => (session ? session.subscribe(cb) : () => {}),
    () => (session ? `${session.char}` : ''),
  );
  const editor = session ? session.editor : active.editor;
  useEditorState(editor);

  useEffect(() => {
    void loadBundledFonts(fonts);
  }, [fonts]);

  useEffect(() => {
    fetch('/api/health')
      .then((r) => setServer(r.ok ? 'online' : 'offline'))
      .catch(() => setServer('offline'));
  }, []);

  // Host actions: things the editor asks the browser to do.
  useEffect(() => {
    return editor.onAction((action: HostAction, arg?: unknown) => {
      void handleAction(action, arg);
    });
  });

  async function handleAction(action: HostAction, arg?: unknown) {
    try {
      if (action === 'new') {
        const t = newTab();
        setTabs((ts) => [...ts, t]);
        setActiveId(t.id);
      } else if (action === 'open') {
        const opened = await openDesigns();
        if (!opened.length) return;
        const added = opened.map((o) => newTab(o.doc, o.name));
        setTabs((ts) => [...ts, ...added]);
        setActiveId(added[added.length - 1]!.id);
      } else if (action === 'save' || action === 'saveAs') {
        const file = await saveDesign(editor.doc, active.file, action === 'saveAs');
        setTabs((ts) => ts.map((t) => (t.id === active.id ? { ...t, file, name: file?.name ?? t.name } : t)));
        editor.setStatus('Saved');
      } else if (action === 'export') {
        await exportFile(typeof arg === 'string' ? arg : 'dst');
      } else if (action === 'settings') {
        setSettingsOpen(true);
      } else if (action === 'dialog' && typeof arg === 'string') {
        setDialog(arg);
      } else if (action === 'text') {
        setTextDialog({ textId: typeof arg === 'number' ? arg : null });
      } else if (action === 'fontEditor') {
        const s = new FontEditorSession(createNativeFont('My font'), { fonts, clipboard });
        const t: Tab = { id: ++tabCounter, editor: s.editor, name: 'Font: My font', file: null, session: s };
        setTabs((ts) => [...ts, t]);
        setActiveId(t.id);
      }
    } catch (e) {
      editor.setStatus((e as Error).message);
    }
  }

  async function exportFile(fmt: string) {
    if (!editor.hoopFits()) {
      const d = editor.doc;
      const ok = window.confirm(`The design is bigger than the ${d.hoopWidth} x ${d.hoopHeight} mm hoop. Export anyway?`);
      if (!ok) {
        editor.setStatus('Export cancelled: the design is bigger than the hoop');
        return;
      }
    }
    editor.setStatus(`Exporting ${fmt.toUpperCase()}…`);
    const res = await fetch(`/api/export/${fmt}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editor.exportPlan()),
    });
    if (!res.ok) {
      const detail = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(`Export failed: ${typeof detail.detail === 'string' ? detail.detail : res.statusText}`);
    }
    download(`${editor.doc.name || 'design'}.${fmt}`, await res.blob());
    editor.setStatus(`Exported ${fmt.toUpperCase()}`);
  }

  // Pictures in the design are decoded so Pick Color can read them.
  useEffect(() => decodeArtwork(editor));

  // Keys typed outside text fields go to the editor.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (t?.tagName === 'CANVAS') return; // the canvas forwards its own keys
      if (editor.keyDown(keyInput(e))) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editor]);

  const closeTab = (id: number) => {
    setTabs((ts) => {
      const left = ts.filter((t) => t.id !== id);
      ts.find((t) => t.id === id)?.editor.dispose();
      const next = left.length ? left : [newTab()];
      if (id === activeId) setActiveId(next[next.length - 1]!.id);
      return next;
    });
  };

  const pointer = editor.pointer;
  return (
    <div className="app">
      <Toolbars editor={editor} serverOnline={server === 'online'} />
      <div className="app-main">
        <aside className="left-panel">
          {session && <LetterGrid session={session} />}
          <ObjectList editor={editor} />
          {!session && <ArtworkPanel editor={editor} />}
        </aside>
        <section className="centre">
          <DesignTabs tabs={tabs} activeId={active.id} onSelect={setActiveId} onClose={closeTab} />
          <Scrollbars editor={editor}>
            <CanvasView key={session ? `${active.id}-${session.char}` : active.id} editor={editor} />
          </Scrollbars>
        </section>
        <aside className="right-panel">
          {session && <FontEditorPanel session={session} fonts={fonts} />}
          <PropertiesPanel editor={editor} />
          {editor.stitchListOpen && <StitchList editor={editor} />}
        </aside>
      </div>
      <PaletteBar editor={editor} />
      <footer className="status-bar">
        <h1 className="brand">StitchPro Studio</h1>
        <span className="status-message" data-testid="status">
          {editor.status}
        </span>
        <span data-testid="server-status" className={`server ${server}`}>
          Server: {server}
        </span>
        <span data-testid="stitch-total">{editor.totalStitches().toLocaleString()} stitches</span>
        <span className="pointer">
          {pointer ? `X ${formatLength(pointer[0], editor.units)}  Y ${formatLength(pointer[1], editor.units)}` : ''}
        </span>
      </footer>
      {settingsOpen && <Settings editor={editor} onClose={() => setSettingsOpen(false)} />}
      {dialog && <ToolDialog key={dialog} editor={editor} id={dialog} onClose={() => setDialog(null)} />}
      {textDialog && <TextDialog editor={editor} textId={textDialog.textId} onClose={() => setTextDialog(null)} />}
    </div>
  );
}
