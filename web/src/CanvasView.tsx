import { useEffect, useRef } from 'react';
import { Renderer, attachInput, type Editor } from '@stitchpro/editor';

export function CanvasView({ editor }: { editor: Editor }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const renderer = new Renderer(editor, canvas);
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
