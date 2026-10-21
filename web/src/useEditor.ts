// Subscribe React to editor changes. The shell only re-renders when the editor says it changed.

import { useSyncExternalStore } from 'react';
import type { Editor } from '@stitchpro/editor';

/** Re-renders the calling component whenever the editor changes; returns its revision. */
export function useEditorState(editor: Editor): number {
  return useSyncExternalStore(
    (cb) => editor.subscribe(cb),
    () => editor.revision,
  );
}
