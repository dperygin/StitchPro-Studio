// Printouts: the design worksheet PDF, the real-size placement template PDF (tiled over
// pages), and a PNG picture of the design.

import { jsPDF } from 'jspdf';
import type { Editor } from '@stitchpro/editor';
import { PAGE_SIZES, designReport, stitchRuns, tilePages, type DesignReport, type Orientation, type Point, type RGB, type Tile } from '@stitchpro/engine';
import { download } from './saveFile';

type Runs = { color: RGB; runs: Point[][] }[];

/** Every visible object's needle runs, in sewing order. */
function designRuns(editor: Editor): Runs {
  return editor.doc.objects.filter((o) => o.visible).map((o) => ({ color: o.color, runs: stitchRuns(editor.stitches(o)) }));
}

const fileStem = (editor: Editor) => (editor.doc.name || 'design').replace(/[\\/:*?"<>|]+/g, '_');

/** The design drawn on a white canvas at pxPerMm (at most maxPx on its longer side). */
export function designCanvas(editor: Editor, report: DesignReport, pxPerMm = 10, maxPx = 4096): HTMLCanvasElement {
  const pad = 2;
  const w = report.width + 2 * pad;
  const h = report.height + 2 * pad;
  const k = Math.min(pxPerMm, maxPx / Math.max(w, h, 1));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * k));
  canvas.height = Math.max(1, Math.round(h * k));
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(k, 0, 0, k, (pad - report.minX) * k, (pad - report.minY) * k);
  ctx.lineWidth = Math.max(0.3, 1 / k);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  for (const { color, runs } of designRuns(editor)) {
    ctx.strokeStyle = `rgb(${color[0]}, ${color[1]}, ${color[2]})`;
    ctx.beginPath();
    for (const run of runs) run.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.stroke();
  }
  return canvas;
}

export function reportOf(editor: Editor): DesignReport {
  return designReport(editor.exportPlan());
}

/** Print design image: a PNG of the design. */
export function downloadPng(editor: Editor): void {
  const canvas = designCanvas(editor, reportOf(editor));
  canvas.toBlob((blob) => blob && download(`${fileStem(editor)}.png`, blob, 'image/png'), 'image/png');
}

const fmtMm = (mm: number) => `${mm.toFixed(1)} mm (${(mm / 25.4).toFixed(2)} in)`;
const fmtMinutes = (min: number) => (min < 1 ? `${Math.max(1, Math.round(min * 60))} s` : `${Math.floor(min)} min ${Math.round((min % 1) * 60)} s`);

/** The design worksheet: size, counts, thread length, run time, stop sequence and colour film. */
export function worksheetPdf(editor: Editor): jsPDF {
  const r = reportOf(editor);
  const pdf = new jsPDF({ unit: 'mm', format: 'letter' });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const m = 15;
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(16);
  pdf.text(editor.doc.name || 'Design', m, m + 4);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9);
  pdf.text(`Design worksheet · ${new Date().toLocaleDateString()}`, m, m + 10);

  // Picture of the design, top right.
  const box = 85;
  const canvas = designCanvas(editor, r, 12, 2400);
  const scale = Math.min(box / canvas.width, box / canvas.height);
  pdf.addImage(canvas.toDataURL('image/png'), 'PNG', pageW - m - canvas.width * scale, m + 14, canvas.width * scale, canvas.height * scale);

  // Facts.
  const facts: [string, string][] = [
    ['Width', fmtMm(r.width)],
    ['Height', fmtMm(r.height)],
    ['Stitches', r.stitches.toLocaleString()],
    ['Colours', String(r.blocks.length)],
    ['Colour changes', String(r.colourChanges)],
    ['Stops', String(r.stops)],
    ['Trims', String(r.trims)],
    ['Thread length', `${(r.threadLength / 1000).toFixed(1)} m`],
    ['Run time (800 stitches/min)', fmtMinutes(r.runMinutes)],
    ['Hoop', `${editor.doc.hoopWidth} x ${editor.doc.hoopHeight} mm`],
  ];
  let y = m + 20;
  pdf.setFontSize(10);
  for (const [k, v] of facts) {
    pdf.setTextColor(95, 102, 112);
    pdf.text(k, m, y);
    pdf.setTextColor(29, 35, 48);
    pdf.text(v, m + 52, y);
    y += 6;
  }

  // Stop sequence.
  y = Math.max(y, m + 14 + box) + 10;
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(11);
  pdf.text('Stop sequence', m, y);
  y += 6;
  pdf.setFontSize(9);
  const cols = [m, m + 10, m + 22, m + 120, m + 145];
  ['#', '', 'Thread', 'Stitches', 'Length'].forEach((h, i) => pdf.text(h, cols[i]!, y));
  pdf.setFont('helvetica', 'normal');
  y += 5;
  for (const b of r.blocks) {
    if (y > pageH - 40) {
      pdf.addPage();
      y = m + 5;
    }
    pdf.text(String(b.index), cols[0]!, y);
    pdf.setFillColor(b.color[0], b.color[1], b.color[2]);
    pdf.setDrawColor(150, 150, 150);
    pdf.rect(cols[1]!, y - 3.2, 8, 4, 'FD');
    const thread = [b.brand, b.code, b.name].filter(Boolean).join(' ') || `RGB ${b.color.join(', ')}`;
    pdf.text(thread + (b.stops ? `  (stop${b.stops > 1 ? ` x${b.stops}` : ''})` : ''), cols[2]!, y);
    pdf.text(b.stitches.toLocaleString(), cols[3]!, y);
    pdf.text(`${(b.threadLength / 1000).toFixed(1)} m`, cols[4]!, y);
    y += 6;
  }

  // Colour film: the colours in sewing order.
  const filmY = pageH - m - 14;
  pdf.setFont('helvetica', 'bold');
  pdf.text('Colour film', m, filmY - 3);
  const cell = Math.min(14, (pageW - 2 * m) / Math.max(1, r.blocks.length));
  r.blocks.forEach((b, i) => {
    pdf.setFillColor(b.color[0], b.color[1], b.color[2]);
    pdf.setDrawColor(120, 120, 120);
    pdf.rect(m + i * cell, filmY, cell, 10, 'FD');
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(6);
    pdf.setTextColor(95, 102, 112);
    pdf.text(String(b.index), m + i * cell + 1, filmY + 13);
  });
  return pdf;
}

export function downloadWorksheet(editor: Editor): void {
  download(`${fileStem(editor)} worksheet.pdf`, worksheetPdf(editor).output('arraybuffer'), 'application/pdf');
}

/** The part of segment a-b inside a tile (Liang-Barsky), or null. */
function clipSegment(a: Point, b: Point, t: Tile): [Point, Point] | null {
  let t0 = 0;
  let t1 = 1;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const edges: [number, number][] = [
    [-dx, a[0] - t.x],
    [dx, t.x + t.width - a[0]],
    [-dy, a[1] - t.y],
    [dy, t.y + t.height - a[1]],
  ];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return null;
    } else {
      const r = q / p;
      if (p < 0) t0 = Math.max(t0, r);
      else t1 = Math.min(t1, r);
      if (t0 > t1) return null;
    }
  }
  return [
    [a[0] + t0 * dx, a[1] + t0 * dy],
    [a[0] + t1 * dx, a[1] + t1 * dy],
  ];
}

export interface TemplateOptions {
  page: string;
  orientation: Orientation;
  overlap: number;
}

/** The real-size placement template, tiled over pages that overlap. */
export function templatePdf(editor: Editor, opts: TemplateOptions): jsPDF {
  const r = reportOf(editor);
  const page = PAGE_SIZES.find((p) => p.name === opts.page) ?? PAGE_SIZES[0]!;
  const area = { minX: r.minX - 5, minY: r.minY - 5, maxX: r.minX + r.width + 5, maxY: r.minY + r.height + 5 };
  const t = tilePages(area, page, { orientation: opts.orientation, overlap: opts.overlap, margin: 10 });
  const pdf = new jsPDF({ unit: 'mm', format: [page.width, page.height], orientation: t.orientation });
  const runs = designRuns(editor);
  t.tiles.forEach((tile, i) => {
    if (i) pdf.addPage([page.width, page.height], t.orientation);
    const ox = t.margin - tile.x;
    const oy = t.margin - tile.y;
    // Stitches inside this page.
    pdf.setLineWidth(0.15);
    for (const { color, runs: rs } of runs) {
      pdf.setDrawColor(color[0], color[1], color[2]);
      for (const run of rs) {
        for (let k = 1; k < run.length; k++) {
          const seg = clipSegment(run[k - 1]!, run[k]!, tile);
          if (seg) pdf.line(seg[0][0] + ox, seg[0][1] + oy, seg[1][0] + ox, seg[1][1] + oy);
        }
      }
    }
    // Hoop centre crosshair.
    pdf.setDrawColor(26, 115, 232);
    pdf.setLineWidth(0.25);
    if (clipSegment([-15, 0], [15, 0], tile)) {
      const s = clipSegment([-15, 0], [15, 0], tile)!;
      pdf.line(s[0][0] + ox, s[0][1] + oy, s[1][0] + ox, s[1][1] + oy);
    }
    if (clipSegment([0, -15], [0, 15], tile)) {
      const s = clipSegment([0, -15], [0, 15], tile)!;
      pdf.line(s[0][0] + ox, s[0][1] + oy, s[1][0] + ox, s[1][1] + oy);
    }
    // Page edge of the printed area, labels and a 10 mm check bar.
    pdf.setDrawColor(180, 180, 180);
    pdf.setLineDashPattern([2, 2], 0);
    pdf.rect(t.margin, t.margin, tile.width, tile.height);
    pdf.setLineDashPattern([], 0);
    pdf.setFontSize(7);
    pdf.setTextColor(95, 102, 112);
    const label = `${editor.doc.name || 'Design'} · placement template · page ${i + 1} of ${t.tiles.length} (row ${tile.row + 1}, column ${tile.col + 1}) · print at 100% (actual size)`;
    pdf.text(label, t.margin, t.margin - 3);
    pdf.setDrawColor(29, 35, 48);
    pdf.setLineWidth(0.3);
    pdf.line(t.margin, t.pageHeight - t.margin + 4, t.margin + 10, t.pageHeight - t.margin + 4);
    pdf.text('10 mm', t.margin + 12, t.pageHeight - t.margin + 5);
  });
  return pdf;
}

export function downloadTemplate(editor: Editor, opts: TemplateOptions): void {
  download(`${fileStem(editor)} template.pdf`, templatePdf(editor, opts).output('arraybuffer'), 'application/pdf');
}
