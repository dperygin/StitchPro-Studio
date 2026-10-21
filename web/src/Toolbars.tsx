// The three toolbars and menus, all rendered from the editor's command registry.

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { command, shortcutLabel, type Editor } from '@stitchpro/editor';
import { HOOPS, HOOP_KIND_LABELS, SHAPE_KINDS, type HoopKind } from '@stitchpro/engine';
import logoMark from './assets/logo-mark.png';
import { usePreview } from './PreviewCard';
import { useEditorState } from './useEditor';

const EXPORT_FORMATS = ['dst', 'pes', 'exp', 'jef', 'vp3', 'xxx'] as const;

export function CommandButton({ editor, id, label, arg }: { editor: Editor; id: string; label?: string; arg?: unknown }) {
  const cmd = command(id);
  const keys = shortcutLabel(id);
  const title = !cmd ? '' : cmd.ready ? `${cmd.label}${keys ? ` (${keys})` : ''}` : `${cmd.label} (coming in a later step)`;
  // Top-row buttons show a stitched preview card instead of the plain tooltip.
  const { handlers, card } = usePreview(id, title);
  if (!cmd) return null;
  const enabled = editor.isEnabled(id);
  const checked = editor.isChecked(id);
  return (
    <>
      <button
        type="button"
        className={`tb-button${checked ? ' checked' : ''}`}
        disabled={!enabled}
        aria-pressed={checked || undefined}
        title={handlers ? undefined : title}
        data-command={id}
        onClick={() => editor.run(id, arg)}
        {...handlers}
      >
        {label ?? cmd.label}
      </button>
      {card}
    </>
  );
}

/** A dropdown menu of commands (closes on click outside). */
export function Menu({ label, children, testId, previewId }: { label: string; children: ReactNode; testId?: string; previewId?: string }) {
  const [open, setOpen] = useState(false);
  const { handlers, card } = usePreview(previewId ?? '', label);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);
  return (
    <div className="menu" ref={ref}>
      <button type="button" className="tb-button" aria-expanded={open} data-testid={testId} onClick={() => setOpen(!open)} {...(open ? {} : handlers)}>
        {label} ▾
      </button>
      {!open && card}
      {open && (
        <div className="menu-items" role="menu" onClick={() => setOpen(false)}>
          {children}
        </div>
      )}
    </div>
  );
}

const Sep = () => <span className="tb-sep" />;

export function Toolbars({ editor, serverOnline }: { editor: Editor; serverOnline: boolean }) {
  useEditorState(editor);
  const B = (id: string, label?: string, arg?: unknown) => <CommandButton key={id + String(label)} editor={editor} id={id} label={label} arg={arg} />;
  const [skew, setSkew] = useState('10');

  return (
    <header className="toolbars">
      {/* Digitize toolbar */}
      <div className="toolbar" data-testid="toolbar-digitize">
        {B('tool.select')}
        <Sep />
        {B('draw.open')}
        {B('draw.closed')}
        {B('draw.column')}
        {B('draw.twoRail')}
        {B('draw.manual')}
        <Sep />
        {B('shape.circle')}
        {B('shape.rectangle')}
        <Menu label="Shapes" previewId="menu.shapes">{SHAPE_KINDS.filter((k) => k !== 'circle' && k !== 'rectangle').map((k) => B(`shape.${k}`))}</Menu>
        <Sep />
        {B('mode.outline')}
        {B('mode.fill')}
        <Sep />
        {B('type.running')}
        {B('type.satin')}
        {B('type.zigzag')}
        {B('type.e_stitch')}
        {B('type.motif_line')}
        <Sep />
        {B('type.fill')}
        {B('type.satin_fill')}
        {B('type.outline')}
        {B('type.motif_fill')}
        {B('type.contour')}
        {B('type.stipple')}
        {B('type.cross_stitch')}
        <img className="toolbar-logo" src={logoMark} alt="StitchPro Studio" title="StitchPro Studio" />
      </div>

      {/* Edit toolbar */}
      <div className="toolbar" data-testid="toolbar-edit">
        <Menu label="File" testId="menu-file">
          {B('file.new')}
          {B('file.open')}
          {B('file.save')}
          {B('file.saveAs')}
          {B('file.importMachine')}
          {serverOnline
            ? EXPORT_FORMATS.map((f) => B('file.export', `Export ${f.toUpperCase()}`, f))
            : B('file.export', 'Export (server offline)')}
          {B('file.exportSvg')}
          {B('file.printWorksheet')}
          {B('file.printTemplate')}
          {B('file.printImage')}
        </Menu>
        {B('file.settings')}
        <select
          className="tb-select"
          title="Hoop"
          aria-label="Hoop"
          value={editor.doc.hoopId}
          onChange={(e) => editor.setHoop(e.target.value)}
        >
          {!editor.doc.hoopId && <option value="">{`${editor.doc.hoopWidth} x ${editor.doc.hoopHeight} mm`}</option>}
          {(Object.keys(HOOP_KIND_LABELS) as HoopKind[]).map((kind) => (
            <optgroup key={kind} label={HOOP_KIND_LABELS[kind]}>
              {HOOPS.filter((h) => h.kind === kind).map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <Sep />
        {B('edit.finish')}
        {B('edit.finishClosed')}
        {B('edit.cancel')}
        <Sep />
        {B('edit.undo')}
        {B('edit.redo')}
        {B('edit.cut')}
        {B('edit.copy')}
        {B('edit.paste')}
        {B('edit.delete')}
        <Sep />
        {B('tool.reshape')}
        {B('tool.angle')}
        {B('tool.polygon')}
        {B('tool.stitches')}
        {B('tool.cut')}
        {B('edit.addHole')}
        {B('pick.entry')}
        {B('pick.exit')}
        <Sep />
        {B('view.zoomOut', '−')}
        {B('view.zoomIn', '+')}
        {B('view.fit')}
        {B('view.grid')}
        <input
          className="tb-number"
          type="number"
          min={1}
          step={1}
          title="Grid spacing (mm)"
          aria-label="Grid spacing"
          value={editor.gridSpacing}
          onChange={(e) => editor.setGridSpacing(Number(e.target.value))}
        />
        {B('view.snap')}
        {B('view.rulers')}
        {B('tool.measure')}
        {B('edit.centerInHoop')}
        {B('view.units', editor.units === 'mm' ? 'mm' : 'in')}
        {B('view.simStitch')}
        {B('view.marks')}
      </div>

      {/* Tools toolbar */}
      <div className="toolbar" data-testid="toolbar-tools">
        {B('file.importArtwork')}
        {B('file.importSvg')}
        {B('dialog.autoDigitize')}
        <Menu label="Arrange" testId="menu-arrange">
          {(['left', 'centre', 'right', 'top', 'middle', 'bottom'] as const).map((side) => B('arrange.align', `Align ${side} with the last selected`, side))}
          {B('arrange.weld')}
          {B('arrange.byColour')}
          {B('arrange.backColour')}
          {B('arrange.forwardColour')}
          {B('arrange.optimize')}
          {B('arrange.spaceEvenly', 'Space evenly across', 'x')}
          {B('arrange.spaceEvenly', 'Space evenly down', 'y')}
          {B('arrange.bySelection')}
        </Menu>
        {B('edit.duplicate')}
        {B('edit.backtrack')}
        {B('edit.repeat')}
        {B('edit.closestJoin')}
        {B('pick.hoopOut')}
        {B('edit.flip')}
        {B('edit.rotate15')}
        <label className="tb-field" title="Skew angle (degrees, up to 70)">
          Skew
          <input className="tb-number" type="number" min={-70} max={70} value={skew} onChange={(e) => setSkew(e.target.value)} aria-label="Skew angle" />
          <button type="button" className="tb-button" disabled={!editor.isEnabled('edit.skew')} onClick={() => editor.run('edit.skew', Math.max(-70, Math.min(70, Number(skew) || 0)))}>
            Apply
          </button>
        </label>
        <Sep />
        <Menu label="Tools" testId="menu-tools">
          {B('dialog.motifStamp')}
          {B('dialog.array')}
          {B('dialog.mirror')}
          {B('dialog.kaleidoscope')}
          {B('dialog.insertOffset')}
          {B('dialog.addBorder')}
          {B('dialog.autoApplique')}
          {B('dialog.smooth')}
          {B('dialog.knockout')}
          {B('dialog.laydown')}
          {B('dialog.fillHoles')}
          {B('dialog.partialApplique')}
          {B('dialog.saveMotif')}
        </Menu>
        <Menu label="Text">
          {B('text.add')}
          {B('text.edit')}
          {B('tool.letters')}
          {B('dialog.fontEditor')}
        </Menu>
      </div>
    </header>
  );
}
