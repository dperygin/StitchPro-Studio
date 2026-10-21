// mm/inch conversion. The ONLY place units are converted; everything is stored in mm.
// Inches are a display/input preference; stitch settings always show mm.

export type Units = 'mm' | 'in';

export const MM_PER_INCH = 25.4;

export function toDisplay(mm: number, units: Units): number {
  return units === 'in' ? mm / MM_PER_INCH : mm;
}

export function fromDisplay(value: number, units: Units): number {
  return units === 'in' ? value * MM_PER_INCH : value;
}

/** A length for display, e.g. "12.35 mm" or "0.486 in". */
export function formatLength(mm: number, units: Units, digits = units === 'in' ? 3 : 2): string {
  return `${toDisplay(mm, units).toFixed(digits)} ${units}`;
}

/** Parses a typed length ("12.5", "12.5 mm", "0.5in", "1,5"), in the given units unless it names its own; mm or null. */
export function parseLength(text: string, units: Units): number | null {
  const m = /^\s*(-?\d+(?:[.,]\d+)?|-?[.,]\d+)\s*(mm|in|"|)\s*$/i.exec(text);
  if (!m) return null;
  const value = Number(m[1]!.replace(',', '.'));
  const unit = m[2]!.toLowerCase();
  const u: Units = unit === 'mm' ? 'mm' : unit === 'in' || unit === '"' ? 'in' : units;
  return fromDisplay(value, u);
}
