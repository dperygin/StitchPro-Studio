// Scroll bars round the canvas: they show and move the view across the hoop and the design.

import type { ReactNode } from 'react';
import type { Editor } from '@stitchpro/editor';
import { useEditorState } from './useEditor';

const MARGIN_MM = 50;

export function Scrollbars({ editor, children }: { editor: Editor; children: ReactNode }) {
  useEditorState(editor);
  const { zoom, panX, panY } = editor.view;
  const { width, height } = editor.viewport;
  const box = editor.contentBox();
  // Scrollable range in screen pixels: the content plus a margin, at the current zoom.
  const left = (box.minX - MARGIN_MM) * zoom;
  const right = (box.maxX + MARGIN_MM) * zoom;
  const top = (box.minY - MARGIN_MM) * zoom;
  const bottom = (box.maxY + MARGIN_MM) * zoom;
  const xRange = Math.max(1, right - left - width);
  const yRange = Math.max(1, bottom - top - height);
  // pan = -scroll - left (screen x of design 0 is panX).
  const xValue = Math.min(xRange, Math.max(0, -panX - left));
  const yValue = Math.min(yRange, Math.max(0, -panY - top));

  return (
    <div className="canvas-frame">
      <div className="canvas-area">{children}</div>
      <input
        className="scroll-h"
        type="range"
        aria-label="Scroll horizontally"
        min={0}
        max={xRange}
        value={xValue}
        onChange={(e) => editor.setPan(-Number(e.target.value) - left, panY)}
      />
      <input
        className="scroll-v"
        type="range"
        aria-label="Scroll vertically"
        min={0}
        max={yRange}
        value={yValue}
        onChange={(e) => editor.setPan(panX, -Number(e.target.value) - top)}
      />
    </div>
  );
}
