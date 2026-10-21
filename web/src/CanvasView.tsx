import { useEffect, useRef } from 'react';
import { Renderer, attachInput, type Editor } from '@stitchpro/editor';

export function CanvasView({ editor }: { editor: Editor }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const renderer = new Renderer(editor, ctx);
    const resize = () => {
      canvas.width = canvas.clientWidth;
      canvas.height = canvas.clientHeight;
      renderer.draw();
    };
    resize();
    const detach = attachInput(editor, canvas);
    const unsubscribe = editor.subscribe(() => renderer.draw());
    window.addEventListener('resize', resize);
    return () => {
      detach();
      unsubscribe();
      window.removeEventListener('resize', resize);
    };
  }, [editor]);

  return <canvas ref={ref} className="canvas" data-testid="design-canvas" tabIndex={0} />;
}
