// Printing over several pages: a real-size placement template tiled over paper, the pages
// overlapping so they can be trimmed and taped together.

export interface PageSize {
  name: string;
  /** Portrait width and height, mm. */
  width: number;
  height: number;
}

export const PAGE_SIZES: readonly PageSize[] = [
  { name: 'Letter', width: 215.9, height: 279.4 },
  { name: 'Legal', width: 215.9, height: 355.6 },
  { name: 'Tabloid', width: 279.4, height: 431.8 },
  { name: 'A5', width: 148, height: 210 },
  { name: 'A4', width: 210, height: 297 },
  { name: 'A3', width: 297, height: 420 },
];

export type Orientation = 'portrait' | 'landscape' | 'auto';

export interface TileOptions {
  orientation?: Orientation;
  /** Unprinted border on every page, mm. */
  margin?: number;
  /** How far neighbouring pages show the same strip, mm. */
  overlap?: number;
}

/** One page: the part of the design (in design mm) it shows inside its margins. */
export interface Tile {
  row: number;
  col: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TileLayout {
  orientation: 'portrait' | 'landscape';
  /** Page size as printed, mm. */
  pageWidth: number;
  pageHeight: number;
  margin: number;
  rows: number;
  cols: number;
  tiles: Tile[];
}

export interface Area {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function layout(area: Area, pw: number, ph: number, margin: number, overlap: number, orientation: 'portrait' | 'landscape'): TileLayout {
  const cw = Math.max(1, pw - 2 * margin);
  const ch = Math.max(1, ph - 2 * margin);
  const w = Math.max(0, area.maxX - area.minX);
  const h = Math.max(0, area.maxY - area.minY);
  const count = (len: number, cell: number) => (len <= cell ? 1 : 1 + Math.ceil((len - cell) / Math.max(1, cell - overlap)));
  const cols = count(w, cw);
  const rows = count(h, ch);
  // The tiled block is centred on the area.
  const totalW = cols * cw - (cols - 1) * overlap;
  const totalH = rows * ch - (rows - 1) * overlap;
  const x0 = area.minX - (totalW - w) / 2;
  const y0 = area.minY - (totalH - h) / 2;
  const tiles: Tile[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) tiles.push({ row: r, col: c, x: x0 + c * (cw - overlap), y: y0 + r * (ch - overlap), width: cw, height: ch });
  }
  return { orientation, pageWidth: pw, pageHeight: ph, margin, rows, cols, tiles };
}

/** Tiles an area over pages; 'auto' picks the orientation that needs fewer pages (portrait on a tie). */
export function tilePages(area: Area, page: PageSize, opts: TileOptions = {}): TileLayout {
  const margin = opts.margin ?? 10;
  const overlap = opts.overlap ?? 10;
  const portrait = layout(area, page.width, page.height, margin, overlap, 'portrait');
  const landscape = layout(area, page.height, page.width, margin, overlap, 'landscape');
  if (opts.orientation === 'portrait') return portrait;
  if (opts.orientation === 'landscape') return landscape;
  return landscape.tiles.length < portrait.tiles.length ? landscape : portrait;
}
