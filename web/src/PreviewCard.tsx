// The hover card for a toolbar button: a stitched sample and a one-line description, shown
// after a short pause on hover or keyboard focus, hidden on leave, blur or click.

import { useCallback, useEffect, useId, useRef, useState, type FocusEvent, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { PREVIEWS, PREVIEW_W, previewImage } from './previews';

const SHOW_DELAY_MS = 350;
const CARD_W = PREVIEW_W + 16;

export interface PreviewHandlers {
  onMouseEnter: (e: MouseEvent<HTMLElement>) => void;
  onMouseLeave: () => void;
  onFocus: (e: FocusEvent<HTMLElement>) => void;
  onBlur: () => void;
  onMouseDown: () => void;
  'aria-describedby'?: string;
}

/** Hover-card props for a button (none when the id has no preview) and the card to render. */
export function usePreview(id: string, title: string): { handlers: PreviewHandlers | null; card: React.ReactNode } {
  const preview = PREVIEWS[id];
  const cardId = useId();
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hide = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setAt(null);
  }, []);
  useEffect(() => hide, [hide]);
  const show = (el: HTMLElement) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const r = el.getBoundingClientRect();
      setAt({ left: Math.max(8, Math.min(r.left, window.innerWidth - CARD_W - 8)), top: r.bottom + 6 });
    }, SHOW_DELAY_MS);
  };
  if (!preview) return { handlers: null, card: null };
  const handlers: PreviewHandlers = {
    onMouseEnter: (e) => show(e.currentTarget),
    onMouseLeave: hide,
    onFocus: (e) => show(e.currentTarget),
    onBlur: hide,
    onMouseDown: hide,
    'aria-describedby': at ? cardId : undefined,
  };
  const src = at ? previewImage(id) : null;
  const card = at
    ? createPortal(
        <div className="preview-card" id={cardId} role="tooltip" data-testid="preview-card" style={{ left: at.left, top: at.top, width: CARD_W }}>
          <div className="preview-title">{title}</div>
          {src && <img src={src} alt="" width={PREVIEW_W} />}
          <div className="preview-text">{preview.description}</div>
        </div>,
        document.body,
      )
    : null;
  return { handlers, card };
}
