// The command registry: every toolbar button, menu item and shortcut. A UI shell renders these
// and calls editor.run(id); the editor matches shortcuts itself. Commands whose feature is
// built in a later step are listed with ready: false (shown disabled).

import { SHAPE_KINDS, STITCH_TYPE_LABELS, type ShapeKind, type StitchType } from '@stitchpro/engine';
import type { Editor, KeyInput } from './editor';

export type CommandGroup = 'digitize' | 'shapes' | 'stitch' | 'file' | 'edit' | 'view' | 'tools' | 'arrange' | 'dialogs' | 'player';

export interface Command {
  id: string;
  label: string;
  group: CommandGroup;
  /** Shortcuts, e.g. 'Ctrl+Shift+K', 'Shift+Z', 'O', 'Tab', '['. */
  keys?: string[];
  /** False: listed but not built yet (shown disabled). */
  ready: boolean;
  enabled?: (ed: Editor) => boolean;
  checked?: (ed: Editor) => boolean;
  run: (ed: Editor, arg?: unknown) => void;
}

export type CommandId = string;

const selected = (ed: Editor) => ed.selectionOrder.length > 0;
const later = (id: string, label: string, group: CommandGroup, keys?: string[]): Command => ({ id, label, group, keys, ready: false, run: () => {} });

/** A copy tool whose options the host asks for in a dialog (then calls the editor method). */
const dialog = (id: string, label: string): Command => ({ id, label, group: 'dialogs', ready: true, enabled: selected, run: (ed) => ed.requestAction('dialog', id) });

const OUTLINE: StitchType[] = ['running', 'satin', 'zigzag', 'e_stitch', 'motif_line'];
const FILL: StitchType[] = ['fill', 'satin_fill', 'outline', 'motif_fill', 'contour', 'stipple', 'cross_stitch'];

const typeCommand = (t: StitchType): Command => ({
  id: `type.${t}`,
  label: STITCH_TYPE_LABELS[t],
  group: 'stitch',
  ready: true,
  checked: (ed) => {
    const sel = ed.selectedObjects();
    return sel.length ? sel.every((o) => o.settings.stitchType === t) : ed.drawMode.stitchType === t;
  },
  run: (ed) => ed.setStitchType(t),
});

const shapeCommand = (k: ShapeKind): Command => ({
  id: `shape.${k}`,
  label: k[0]!.toUpperCase() + k.slice(1),
  group: 'shapes',
  ready: true,
  checked: (ed) => ed.toolName === 'shape' && ed.shapeKind === k,
  run: (ed) => ed.startShape(k),
});

export const COMMANDS: readonly Command[] = [
  // ---- digitize ----
  { id: 'tool.select', label: 'Select', group: 'digitize', keys: ['O'], ready: true, checked: (ed) => ed.toolName === 'select', run: (ed) => ed.setTool('select') },
  {
    id: 'draw.open',
    label: 'Open Shape',
    group: 'digitize',
    ready: true,
    checked: (ed) => ed.toolName === 'draw' && !ed.drawMode.closed && !['radial_satin', 'manual'].includes(ed.drawMode.stitchType),
    run: (ed) => ed.startDrawing({ closed: false, stitchType: OUTLINE.includes(ed.drawMode.stitchType) ? ed.drawMode.stitchType : 'running' }),
  },
  {
    id: 'draw.closed',
    label: 'Closed Shape',
    group: 'digitize',
    ready: true,
    checked: (ed) => ed.toolName === 'draw' && ed.drawMode.closed && !ed.drawMode.hole,
    run: (ed) => ed.startDrawing({ closed: true, stitchType: FILL.includes(ed.drawMode.stitchType) || OUTLINE.includes(ed.drawMode.stitchType) ? ed.drawMode.stitchType : 'fill' }),
  },
  {
    id: 'draw.column',
    label: 'Column',
    group: 'digitize',
    ready: true,
    checked: (ed) => ed.toolName === 'draw' && ed.drawMode.stitchType === 'radial_satin' && !!ed.drawMode.paired,
    run: (ed) => ed.startDrawing({ closed: false, stitchType: 'radial_satin', paired: true }),
  },
  {
    id: 'draw.twoRail',
    label: 'Two-Rail Satin',
    group: 'digitize',
    ready: true,
    checked: (ed) => ed.toolName === 'draw' && ed.drawMode.stitchType === 'radial_satin' && !ed.drawMode.paired,
    run: (ed) => ed.startDrawing({ closed: false, stitchType: 'radial_satin', paired: false }),
  },
  {
    id: 'draw.manual',
    label: 'Manual',
    group: 'digitize',
    ready: true,
    checked: (ed) => ed.toolName === 'draw' && ed.drawMode.stitchType === 'manual',
    run: (ed) => ed.startDrawing({ closed: false, stitchType: 'manual' }),
  },
  ...SHAPE_KINDS.map(shapeCommand),
  { id: 'mode.outline', label: 'Outline', group: 'stitch', ready: true, checked: (ed) => !ed.drawMode.closed, run: (ed) => ed.setFillMode(false) },
  { id: 'mode.fill', label: 'Fill', group: 'stitch', ready: true, checked: (ed) => ed.drawMode.closed, run: (ed) => ed.setFillMode(true) },
  ...OUTLINE.map(typeCommand),
  ...FILL.map(typeCommand),

  // ---- file ----
  { id: 'file.new', label: 'New', group: 'file', keys: ['Ctrl+N'], ready: true, run: (ed) => ed.requestAction('new') },
  { id: 'file.open', label: 'Open…', group: 'file', keys: ['Ctrl+O'], ready: true, run: (ed) => ed.requestAction('open') },
  { id: 'file.save', label: 'Save', group: 'file', keys: ['Ctrl+S'], ready: true, run: (ed) => ed.requestAction('save') },
  { id: 'file.saveAs', label: 'Save as…', group: 'file', keys: ['Ctrl+Shift+S'], ready: true, run: (ed) => ed.requestAction('saveAs') },
  later('file.importMachine', 'Import machine file…', 'file'),
  { id: 'file.export', label: 'Export machine file…', group: 'file', ready: true, enabled: (ed) => ed.doc.objects.length > 0, run: (ed, fmt) => ed.requestAction('export', fmt) },
  later('file.exportSvg', 'Export SVG…', 'file'),
  later('file.printWorksheet', 'Print worksheet', 'file'),
  later('file.printTemplate', 'Print placement template', 'file'),
  later('file.printImage', 'Print design image', 'file'),
  { id: 'file.settings', label: 'Settings…', group: 'file', ready: true, run: (ed) => ed.requestAction('settings') },

  // ---- edit ----
  { id: 'edit.finish', label: 'Finish', group: 'edit', keys: ['Enter'], ready: true, enabled: (ed) => ed.toolName === 'draw', run: (ed) => ed.tool.keyDown({ key: 'Enter' }) },
  { id: 'edit.finishClosed', label: 'Finish closed', group: 'edit', keys: ['Shift+Enter'], ready: true, enabled: (ed) => ed.toolName === 'draw', run: (ed) => ed.tool.keyDown({ key: 'Enter', shift: !ed.drawMode.closed }) },
  { id: 'edit.cancel', label: 'Cancel', group: 'edit', ready: true, run: (ed) => ed.keyDown({ key: 'Escape' }) },
  { id: 'edit.undo', label: 'Undo', group: 'edit', keys: ['Ctrl+Z'], ready: true, enabled: (ed) => ed.canUndo, run: (ed) => ed.undo() },
  { id: 'edit.redo', label: 'Redo', group: 'edit', keys: ['Ctrl+Y', 'Ctrl+Shift+Z'], ready: true, enabled: (ed) => ed.canRedo, run: (ed) => ed.redo() },
  { id: 'edit.cut', label: 'Cut', group: 'edit', keys: ['Ctrl+X'], ready: true, enabled: selected, run: (ed) => ed.cut() },
  { id: 'edit.copy', label: 'Copy', group: 'edit', keys: ['Ctrl+C'], ready: true, enabled: selected, run: (ed) => ed.copy() },
  { id: 'edit.paste', label: 'Paste', group: 'edit', keys: ['Ctrl+V'], ready: true, enabled: (ed) => ed.clipboard.objects.length > 0, run: (ed) => ed.paste() },
  { id: 'edit.delete', label: 'Delete', group: 'edit', keys: ['Delete', 'Backspace'], ready: true, enabled: selected, run: (ed) => ed.deleteSelection() },
  { id: 'edit.selectAll', label: 'Select all', group: 'edit', keys: ['Ctrl+A'], ready: true, run: (ed) => ed.selectAll() },
  { id: 'select.next', label: 'Next object', group: 'edit', keys: ['Tab'], ready: true, run: (ed) => ed.selectNext(1) },
  { id: 'select.previous', label: 'Previous object', group: 'edit', keys: ['Shift+Tab'], ready: true, run: (ed) => ed.selectNext(-1) },
  { id: 'tool.reshape', label: 'Reshape', group: 'edit', keys: ['R'], ready: true, checked: (ed) => ed.toolName === 'reshape', run: (ed) => ed.setTool('reshape') },
  { id: 'tool.angle', label: 'Stitch angle', group: 'edit', keys: ['G'], ready: true, checked: (ed) => ed.toolName === 'angle', run: (ed) => ed.setTool('angle') },
  { id: 'tool.polygon', label: 'Polygon select', group: 'edit', keys: ['U'], ready: true, checked: (ed) => ed.toolName === 'polygon', run: (ed) => ed.setTool('polygon') },
  { id: 'tool.stitches', label: 'Edit stitches', group: 'edit', keys: ['E'], ready: true, checked: (ed) => ed.toolName === 'stitches', run: (ed) => ed.setTool('stitches') },
  {
    id: 'tool.cut',
    label: 'Cut shapes',
    group: 'edit',
    keys: ['Ctrl+Shift+K'],
    ready: true,
    enabled: (ed) => ed.doc.objects.length > 0,
    checked: (ed) => ed.toolName === 'cut',
    run: (ed) => ed.setTool(ed.toolName === 'cut' ? 'select' : 'cut'),
  },
  {
    id: 'edit.addHole',
    label: 'Add hole',
    group: 'edit',
    ready: true,
    enabled: (ed) => ed.selectedObjects().some((o) => o.closed),
    checked: (ed) => ed.toolName === 'draw' && !!ed.drawMode.hole,
    run: (ed) => ed.startDrawing({ closed: true, hole: true }),
  },
  { id: 'pick.entry', label: 'Set entry', group: 'edit', ready: true, enabled: selected, run: (ed) => ed.pick('entry') },
  { id: 'pick.exit', label: 'Set exit', group: 'edit', ready: true, enabled: selected, run: (ed) => ed.pick('exit') },

  // ---- view ----
  { id: 'view.zoomOut', label: 'Zoom out', group: 'view', keys: ['Shift+Z'], ready: true, run: (ed) => ed.zoomBy(1 / 1.25) },
  { id: 'view.zoomIn', label: 'Zoom in', group: 'view', keys: ['Z'], ready: true, run: (ed) => ed.zoomBy(1.25) },
  { id: 'view.fit', label: 'Fit', group: 'view', keys: ['0'], ready: true, run: (ed) => ed.fit() },
  { id: 'view.grid', label: 'Grid', group: 'view', ready: true, checked: (ed) => ed.showGrid, run: (ed) => ed.toggle('showGrid') },
  { id: 'view.snap', label: 'Snap', group: 'view', ready: true, checked: (ed) => ed.snap, run: (ed) => ed.toggle('snap') },
  { id: 'view.rulers', label: 'Rulers', group: 'view', ready: true, checked: (ed) => ed.showRulers, run: (ed) => ed.toggle('showRulers') },
  { id: 'tool.measure', label: 'Measure', group: 'view', keys: ['M'], ready: true, checked: (ed) => ed.toolName === 'measure', run: (ed) => ed.setTool('measure') },
  { id: 'edit.centerInHoop', label: 'Center in hoop', group: 'view', ready: true, enabled: (ed) => ed.doc.objects.length > 0, run: (ed) => ed.centerInHoop() },
  { id: 'view.units', label: 'Units', group: 'view', ready: true, checked: (ed) => ed.units === 'in', run: (ed) => ed.setUnits(ed.units === 'mm' ? 'in' : 'mm') },
  { id: 'view.simStitch', label: 'SimStitch', group: 'view', keys: ['S'], ready: true, checked: (ed) => ed.simStitch, run: (ed) => ed.toggle('simStitch') },
  { id: 'view.marks', label: 'Machine commands', group: 'view', ready: true, checked: (ed) => ed.showMarks, run: (ed) => ed.toggle('showMarks') },
  { id: 'view.stitchList', label: 'Stitch list', group: 'view', keys: ['Shift+J'], ready: true, checked: (ed) => ed.stitchListOpen, run: (ed) => ed.toggle('stitchListOpen') },

  // ---- tools ----
  later('file.importArtwork', 'Import artwork…', 'tools'),
  later('file.importSvg', 'Import SVG as stitches…', 'tools'),
  { id: 'edit.duplicate', label: 'Duplicate', group: 'tools', keys: ['Ctrl+D'], ready: true, enabled: selected, run: (ed) => ed.duplicate() },
  { id: 'edit.backtrack', label: 'Backtrack', group: 'tools', ready: true, enabled: selected, run: (ed) => ed.backtrack() },
  { id: 'edit.repeat', label: 'Repeat', group: 'tools', ready: true, enabled: selected, run: (ed) => ed.repeat() },
  { id: 'edit.closestJoin', label: 'Closest join', group: 'tools', keys: ['J'], ready: true, checked: (ed) => ed.doc.closestJoin, run: (ed) => ed.toggleClosestJoin() },
  { id: 'pick.hoopOut', label: 'Hoop out', group: 'tools', ready: true, enabled: selected, run: (ed) => ed.pick('hoop') },
  { id: 'edit.flip', label: 'Flip', group: 'tools', ready: true, enabled: selected, run: (ed, vertical) => ed.flipSelection(vertical === true) },
  { id: 'edit.rotate15', label: 'Rotate 15°', group: 'tools', keys: ['Ctrl+R'], ready: true, enabled: selected, run: (ed) => ed.rotateSelection(15) },
  { id: 'edit.skew', label: 'Skew', group: 'tools', ready: true, enabled: selected, run: (ed, deg) => typeof deg === 'number' && ed.skewSelection(deg) },
  { id: 'edit.group', label: 'Group', group: 'tools', keys: ['Ctrl+G'], ready: true, enabled: (ed) => ed.selectionOrder.length > 1, run: (ed) => ed.group() },
  { id: 'edit.ungroup', label: 'Ungroup', group: 'tools', keys: ['Ctrl+Shift+G'], ready: true, enabled: selected, run: (ed) => ed.ungroup() },
  { id: 'edit.copyProperties', label: 'Copy properties', group: 'tools', ready: true, enabled: selected, run: (ed) => ed.copyProperties() },
  { id: 'edit.applyProperties', label: 'Apply properties', group: 'tools', ready: true, enabled: (ed) => selected(ed) && ed.hasCopiedProperties, run: (ed) => ed.applyProperties() },

  // ---- arrange (prompt 18) ----
  {
    id: 'arrange.align',
    label: 'Align with the last selected',
    group: 'arrange',
    ready: true,
    enabled: (ed) => ed.selectionOrder.length > 1,
    run: (ed, side) => ed.alignSelection((side as 'left' | 'centre' | 'right' | 'top' | 'middle' | 'bottom') ?? 'left'),
  },
  { id: 'arrange.weld', label: 'Weld', group: 'arrange', ready: true, enabled: (ed) => ed.selectionOrder.length > 1, run: (ed) => ed.weldSelection() },
  { id: 'arrange.byColour', label: 'Sequence by colour', group: 'arrange', ready: true, enabled: (ed) => ed.doc.objects.length > 1, run: (ed) => ed.sequenceByColour() },
  { id: 'arrange.backColour', label: 'Back 1 colour', group: 'arrange', ready: true, enabled: selected, run: (ed) => ed.moveByColour(-1) },
  { id: 'arrange.forwardColour', label: 'Forward 1 colour', group: 'arrange', ready: true, enabled: selected, run: (ed) => ed.moveByColour(1) },
  { id: 'arrange.optimize', label: 'Optimize colour changes', group: 'arrange', ready: true, enabled: (ed) => ed.doc.objects.length > 1, run: (ed) => ed.optimizeColourChanges() },
  {
    id: 'arrange.spaceEvenly',
    label: 'Space evenly',
    group: 'arrange',
    ready: true,
    enabled: (ed) => ed.selectionOrder.length > 2,
    run: (ed, axis) => ed.spaceEvenly(axis === 'y' ? 'y' : 'x'),
  },
  { id: 'arrange.bySelection', label: 'Sequence by selection', group: 'arrange', ready: true, enabled: (ed) => ed.selectionOrder.length > 1, run: (ed) => ed.sequenceBySelection() },
  { id: 'arrange.start', label: 'Move to start', group: 'arrange', ready: true, enabled: selected, run: (ed) => ed.moveSelectionIn('start') },
  { id: 'arrange.up', label: 'Move up', group: 'arrange', ready: true, enabled: selected, run: (ed) => ed.moveSelectionIn('up') },
  { id: 'arrange.down', label: 'Move down', group: 'arrange', ready: true, enabled: selected, run: (ed) => ed.moveSelectionIn('down') },
  { id: 'arrange.end', label: 'Move to end', group: 'arrange', ready: true, enabled: selected, run: (ed) => ed.moveSelectionIn('end') },
  { id: 'arrange.lock', label: 'Lock', group: 'arrange', ready: true, enabled: selected, run: (ed) => ed.setLocked(true) },
  { id: 'arrange.unlock', label: 'Unlock', group: 'arrange', ready: true, enabled: selected, run: (ed) => ed.setLocked(false) },

  // ---- dialog tools ----
  later('dialog.motifStamp', 'Motif stamp…', 'dialogs'),
  dialog('dialog.array', 'Array…'),
  dialog('dialog.mirror', 'Mirror…'),
  dialog('dialog.kaleidoscope', 'Circle / Kaleidoscope…'),
  dialog('dialog.insertOffset', 'Insert offset…'),
  dialog('dialog.addBorder', 'Add border…'),
  dialog('dialog.autoApplique', 'Auto applique…'),
  { id: 'dialog.smooth', label: 'Smooth curves', group: 'dialogs', ready: true, enabled: selected, run: (ed) => ed.smoothSelection() },
  { id: 'dialog.knockout', label: 'Knockout overlaps', group: 'dialogs', ready: true, enabled: selected, run: (ed) => ed.knockoutOverlaps() },
  { ...dialog('dialog.laydown', 'Laydown…'), enabled: (ed) => ed.doc.objects.length > 0 },
  { ...dialog('dialog.fillHoles', 'Fill holes…'), enabled: (ed) => ed.selectedObjects().some((o) => o.holes.length > 0) },
  { id: 'dialog.partialApplique', label: 'Partial applique', group: 'dialogs', ready: true, enabled: (ed) => ed.selectionOrder.length > 1, run: (ed) => ed.partialApplique() },
  { id: 'text.add', label: 'Add text…', group: 'dialogs', keys: ['A'], ready: true, run: (ed) => ed.requestAction('text', null) },
  {
    id: 'text.edit',
    label: 'Edit text…',
    group: 'dialogs',
    ready: true,
    enabled: (ed) => ed.selectedTextId() !== null,
    run: (ed) => ed.requestAction('text', ed.selectedTextId()),
  },
  {
    id: 'tool.letters',
    label: 'Letters',
    group: 'dialogs',
    keys: ['L'],
    ready: true,
    enabled: (ed) => ed.selectedTextId() !== null || ed.toolName === 'letters',
    checked: (ed) => ed.toolName === 'letters',
    run: (ed) => ed.setTool(ed.toolName === 'letters' ? 'select' : 'letters'),
  },
  { id: 'dialog.fontEditor', label: 'Font editor', group: 'dialogs', ready: true, run: (ed) => ed.requestAction('fontEditor') },
  later('dialog.saveMotif', 'Save as motif…', 'dialogs'),

  // ---- colour and player ----
  { id: 'pick.colour', label: 'Pick Color', group: 'player', ready: true, run: (ed) => ed.pick('colour') },
  { id: 'player.toggle', label: 'Play / pause', group: 'player', keys: ['Space'], ready: true, enabled: (ed) => ed.doc.objects.length > 0, run: (ed) => ed.playerToggle() },
  { id: 'player.stop', label: 'Stop', group: 'player', ready: true, run: (ed) => ed.playerStop() },
];

/** The shortcut string of a key event: modifiers then the key ('Ctrl+Shift+K', 'O', 'Space'). */
export function keyCombo(e: KeyInput): string {
  let key = e.key;
  if (key === ' ') key = 'Space';
  else if (key.length === 1) key = key.toUpperCase();
  return [e.ctrl ? 'Ctrl' : '', e.alt ? 'Alt' : '', e.shift ? 'Shift' : '', key].filter(Boolean).join('+');
}

export function command(id: CommandId): Command | undefined {
  return COMMANDS.find((c) => c.id === id);
}

export function commandsIn(group: CommandGroup): Command[] {
  return COMMANDS.filter((c) => c.group === group);
}

/** The shortcut to show next to a command's label. */
export function shortcutLabel(id: CommandId): string {
  return command(id)?.keys?.[0] ?? '';
}
