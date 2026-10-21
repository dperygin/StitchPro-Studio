import { useEffect, useRef } from 'react';
import { Renderer, attachInput, type Editor } from '@stitchpro/editor';

/** The palette's purple, for selection boxes, handles and nodes on the canvas. */
const SELECTION_PURPLE = '#783088';

export function CanvasView({ editor }: { editor: Editor }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const renderer = new Renderer(editor, canvas);
    renderer.theme = { ...renderer.theme, selection: SELECTION_PURPLE, node: SELECTION_PURPLE };
    const resize = () => {
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(canvas.clientWidth * ratio));
      canvas.height = Math.max(1, Math.round(canvas.clientHeight * ratio));
      editor.setViewport(canvas.clientWidth, canvas.clientHeight);
      renderer.requestRedraw('base');
    };
    resize();
    const detach = attachInput(editor, canvas);
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    return () => {
      detach();
      observer.disconnect();
      renderer.dispose();
    };
  }, [editor]);

  return <canvas ref={ref} className="canvas" data-testid="design-canvas" tabIndex={0} />;
}
