// Layout, tabs, dialogs, global keys. The shell holds open designs (one Editor each, sharing
// fonts and clipboard) and handles what only the browser can do: files, downloads, dialogs.

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
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
import { download, openDesigns, pickFiles, saveDesign } from './saveFile';
import { ARTWORK_ACCEPT, decodeArtwork, importArtworkFiles } from './artwork';
import { importSvgFile } from './svgImport';
import { MACHINE_ACCEPT, readMachineFile } from './machineImport';
import { ExportDialog } from './ExportDialog';
import { downloadPng, downloadWorksheet } from './worksheet';
import { clearAutosave, forgetAutosave, loadAutosaved, watchAutosave } from './autosave';
import { applyPrefs, watchPrefs } from './viewPrefs';
import { TextDialog } from './TextDialog';
import { FontEditorPanel, LetterGrid } from './FontEditorPanel';
import { loadBundledFonts } from './fonts';

type ServerState = 'checking' | 'online' | 'offline';

let tabCounter = 0;

export function App() {
  const fonts = useMemo(() => new FontLibrary(), []);
  const clipboard = useMemo(() => new Clipboard(), []);
  const newTab = (doc = createDocument(), name = 'Untitled', file: Tab['file'] = null): Tab => {
    const editor = new Editor(doc, { fonts, clipboard });
    applyPrefs(editor);
    return { id: ++tabCounter, editor, name, file };
  };
  const [tabs, setTabs] = useState<Tab[]>(() => [newTab()]);
  const [activeId, setActiveId] = useState(() => tabs[0]!.id);
  const [server, setServer] = useState<ServerState>('checking');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [dialog, setDialog] = useState<string | null>(null);
  const [exportFormat, setExportFormat] = useState<string | null>(null);
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

  // Autosave: restore the tabs saved last time (replacing the untouched start tab), then save
  // every design tab 1.5 s after it changes; closing a tab forgets it.
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const watchers = useRef(new Map<number, () => void>());
  useEffect(() => {
    let cancelled = false;
    void loadAutosaved().then(async (saved) => {
      if (cancelled || !saved.length) return;
      await clearAutosave();
      const restored = saved.map((s) => newTab(s.doc, s.name, s.file));
      setTabs((ts) => {
        const untouched = ts.length === 1 && !ts[0]!.editor.doc.objects.length && !ts[0]!.editor.canUndo;
        if (untouched) ts[0]!.editor.dispose();
        return untouched ? restored : [...ts, ...restored];
      });
      setActiveId(restored[restored.length - 1]!.id);
      restored[restored.length - 1]!.editor.setStatus(`Restored ${restored.length} design${restored.length === 1 ? '' : 's'} from the last session`);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    const live = new Set(tabs.filter((t) => !t.session).map((t) => t.id));
    for (const [id, stop] of watchers.current) {
      if (live.has(id)) continue;
      stop();
      watchers.current.delete(id);
      void forgetAutosave(id);
    }
    for (const t of tabs) {
      if (t.session || watchers.current.has(t.id)) continue;
      const describe = () => {
        const cur = tabsRef.current.find((x) => x.id === t.id) ?? t;
        return { name: cur.name, file: cur.file };
      };
      watchers.current.set(t.id, watchAutosave(t.id, t.editor, describe));
    }
  }, [tabs]);

  // Preferences follow the active editor.
  useEffect(() => watchPrefs(editor), [editor]);

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
        setExportFormat(typeof arg === 'string' ? arg : 'dst');
      } else if (action === 'importMachine') {
        const [file] = await pickFiles(MACHINE_ACCEPT);
        if (!file) return;
        editor.setStatus(`Reading ${file.name}…`);
        const doc = await readMachineFile(file);
        const t = newTab(doc, file.name);
        setTabs((ts) => [...ts, t]);
        setActiveId(t.id);
        t.editor.setStatus(`Imported ${doc.objects.length} runs from ${file.name}`);
      } else if (action === 'importArtwork') {
        const files = await pickFiles(`${ARTWORK_ACCEPT},image/*`, true);
        if (files.length) await importArtworkFiles(editor, files);
      } else if (action === 'importSvg') {
        const [file] = await pickFiles('.svg,image/svg+xml');
        if (file) await importSvgFile(editor, file);
      } else if (action === 'exportSvg') {
        setDialog('file.exportSvg');
      } else if (action === 'print') {
        if (arg === 'template') setDialog('file.printTemplate');
        else if (arg === 'image') downloadPng(editor);
        else downloadWorksheet(editor);
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

  /** Exports the design in each format (one hoop check for all). */
  async function exportFiles(formats: string[]) {
    try {
      if (!editor.hoopFits()) {
        const d = editor.doc;
        const ok = window.confirm(`The design is bigger than the ${d.hoopWidth} x ${d.hoopHeight} mm hoop. Export anyway?`);
        if (!ok) {
          editor.setStatus('Export cancelled: the design is bigger than the hoop');
          return;
        }
      }
      for (const f of formats) await exportFile(f);
      if (formats.length > 1) editor.setStatus(`Exported ${formats.map((f) => f.toUpperCase()).join(', ')}`);
    } catch (e) {
      editor.setStatus((e as Error).message);
    }
  }

  /** One machine file from the server (the paywall's entitled() check lives there). */
  async function exportFile(fmt: string) {
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
      {exportFormat && <ExportDialog editor={editor} format={exportFormat} onExport={(fs) => void exportFiles(fs)} onClose={() => setExportFormat(null)} />}
      {textDialog && <TextDialog editor={editor} textId={textDialog.textId} onClose={() => setTextDialog(null)} />}
    </div>
  );
}
