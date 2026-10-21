// Width/height and position of the selection, in the display units (stored as mm).

import { fromDisplay, toDisplay, type Editor } from '@stitchpro/editor';

export function SizeFields({ editor }: { editor: Editor }) {
  const box = editor.selectionBox();
  if (!box) return null;
  const u = editor.units;
  const digits = u === 'in' ? 3 : 2;
  const fields: { key: 'x' | 'y' | 'width' | 'height'; label: string; mm: number }[] = [
    { key: 'x', label: 'X', mm: box.minX },
    { key: 'y', label: 'Y', mm: box.minY },
    { key: 'width', label: 'W', mm: box.maxX - box.minX },
    { key: 'height', label: 'H', mm: box.maxY - box.minY },
  ];
  const apply = (key: (typeof fields)[number]['key'], text: string, current: number) => {
    const v = Number(text);
    if (!Number.isFinite(v)) return;
    const mm = fromDisplay(v, u);
    if (Math.abs(mm - current) < 1e-6) return;
    if ((key === 'width' || key === 'height') && !(mm > 0)) return;
    editor.setSelectionBox({ [key]: mm });
  };
  return (
    <div className="size-fields">
      {fields.map((f) => (
        <label key={f.key} className="field">
          {f.label}
          <input
            type="number"
            step={u === 'in' ? 0.01 : 0.1}
            defaultValue={toDisplay(f.mm, u).toFixed(digits)}
            key={`${f.key}-${f.mm}-${u}`}
            aria-label={`Selection ${f.key}`}
            onKeyDown={(e) => e.key === 'Enter' && apply(f.key, (e.target as HTMLInputElement).value, f.mm)}
            onBlur={(e) => apply(f.key, e.target.value, f.mm)}
          />
          <span className="unit">{u}</span>
        </label>
      ))}
    </div>
  );
}
