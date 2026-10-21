// mm/inch conversion. The ONLY place units are converted; everything is stored in mm.

export type Units = 'mm' | 'in';

export const MM_PER_INCH = 25.4;

export function toDisplay(mm: number, units: Units): number {
  return units === 'in' ? mm / MM_PER_INCH : mm;
}

export function fromDisplay(value: number, units: Units): number {
  return units === 'in' ? value * MM_PER_INCH : value;
}
