// Subscribe React to editor changes. The shell only re-renders when the editor says it changed.

import { useState, useSyncExternalStore } from 'react';
import { Editor } from '@stitchpro/editor';

export function useEditor(): Editor {
  const [editor] = useState(() => new Editor());
  useSyncExternalStore(
    (cb) => editor.subscribe(cb),
    () => editor.revision,
  );
  return editor;
}
