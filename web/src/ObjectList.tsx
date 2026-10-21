// Sequence list: numbered rows in colour blocks, thumbnails, visibility, drag to reorder,
// number box, group/lock/delete, sequence by selection, move start/up/down/end, hoop-out blocks.

import { useEffect, useRef, useState } from 'react';
import { sameColor, type Point, type StitchObject } from '@stitchpro/engine';
import { isJumpLanding, type Editor } from '@stitchpro/editor';
import { CommandButton } from './Toolbars';
import { useEditorState } from './useEditor';

const css = (c: readonly number[]) => `rgb(${c[0]}, ${c[1]}, ${c[2]})`;

/** A small picture of an object's stitches (redrawn when its version changes). */
export function Thumb({ editor, object, size = 28 }: { editor: Editor; object: StitchObject; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    const pts: Point[] = editor.stitches(object);
    ctx.clearRect(0, 0, size, size);
    if (pts.length < 2) return;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const [x, y] of pts) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
    const k = (size - 4) / Math.max(maxX - minX, maxY - minY, 0.1);
    const ox = (size - (maxX - minX) * k) / 2;
    const oy = (size - (maxY - minY) * k) / 2;
    ctx.strokeStyle = css(object.color);
    ctx.lineWidth = 1;
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i && !isJumpLanding(pts, i) ? ctx.lineTo(ox + (x - minX) * k, oy + (y - minY) * k) : ctx.moveTo(ox + (x - minX) * k, oy + (y - minY) * k)));
    ctx.stroke();
  }, [editor, object, object.version, size]);
  return <canvas ref={ref} width={size} height={size} className="thumb" aria-hidden />;
}

export function ObjectList({ editor }: { editor: Editor }) {
  useEditorState(editor);
  const [dragId, setDragId] = useState<number | null>(null);
  const objects = editor.doc.objects;

  const onRowClick = (o: StitchObject, e: React.MouseEvent) => {
    if (e.ctrlKey || e.metaKey) editor.toggleSelected(o.id);
    else if (e.shiftKey && editor.selectionOrder.length) {
      const last = objects.findIndex((x) => x.id === editor.selectionOrder[editor.selectionOrder.length - 1]);
      const here = objects.indexOf(o);
      const [a, b] = last < here ? [last, here] : [here, last];
      editor.setSelection([...editor.selectionOrder, ...objects.slice(a, b + 1).map((x) => x.id)]);
    } else editor.select(o.id);
  };

  const rows: React.ReactNode[] = [];
  let block = 0;
  objects.forEach((o, i) => {
    if (i === 0 || !sameColor(objects[i - 1]!.color, o.color)) {
      block++;
      rows.push(
        <li key={`block-${i}`} className="colour-block" aria-hidden>
          <span className="swatch" style={{ background: css(o.color) }} /> Colour {block}
          {o.thread ? ` · ${o.thread.chart} ${o.thread.code}` : ''}
        </li>,
      );
    }
    rows.push(
      <li
        key={o.id}
        className={`seq-row${editor.isSelected(o.id) ? ' selected' : ''}${o.visible ? '' : ' hidden-object'}`}
        data-testid="sequence-row"
        draggable
        onDragStart={() => setDragId(o.id)}
        onDragOver={(e) => e.preventDefault()}
        onDrop={() => {
          if (dragId !== null && dragId !== o.id) editor.moveObjects([dragId], objects.filter((x) => x.id !== dragId).indexOf(o));
          setDragId(null);
        }}
        onClick={(e) => onRowClick(o, e)}
      >
        <input
          className="seq-number"
          type="number"
          min={1}
          max={objects.length}
          defaultValue={i + 1}
          key={`${o.id}-${i}`}
          aria-label={`Sequence number of ${o.name}`}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') editor.setSequenceNumber(o.id, Number((e.target as HTMLInputElement).value));
          }}
          onBlur={(e) => {
            const n = Number(e.target.value);
            if (n && n !== i + 1) editor.setSequenceNumber(o.id, n);
          }}
        />
        <Thumb editor={editor} object={o} />
        <span className="seq-name">
          {o.name}
          {o.groupId !== null ? ' ⛓' : ''}
          {o.locked ? ' 🔒' : ''}
        </span>
        <span className="seq-count">{editor.stitchCount(o)}</span>
        <input
          type="checkbox"
          checked={o.visible}
          title="Visible"
          aria-label={`Show ${o.name}`}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => editor.setVisible(o.id, e.target.checked)}
        />
      </li>,
    );
    if (o.hoopOut) {
      rows.push(
        <li key={`hoop-${o.id}`} className="hoop-out-block">
          Hoop out — reposition, then continue
        </li>,
      );
    }
  });

  const B = (id: string, label?: string) => <CommandButton editor={editor} id={id} label={label} />;
  return (
    <section className="panel sequence-list" aria-label="Sequence">
      <h2>Sequence</h2>
      <div className="panel-buttons">
        {B('edit.group', 'Group')}
        {B('edit.ungroup', 'Ungroup')}
        {B('arrange.lock', 'Lock')}
        {B('arrange.unlock', 'Unlock')}
        {B('edit.delete', 'Delete')}
        {B('arrange.bySelection', 'By selection')}
      </div>
      <div className="panel-buttons">
        {B('arrange.start', '⤒ Start')}
        {B('arrange.up', '↑ Up')}
        {B('arrange.down', '↓ Down')}
        {B('arrange.end', '⤓ End')}
      </div>
      <ol className="seq-rows">{rows}</ol>
      {!objects.length && <p className="muted">Nothing digitized yet.</p>}
    </section>
  );
}
