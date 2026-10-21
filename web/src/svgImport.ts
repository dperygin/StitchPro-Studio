// SVG files: sanitizing, and reading shapes (final fill, stroke and transform from the browser)
// for "Import SVG as stitches".

import type { Editor } from '@stitchpro/editor';
import { vectorObjects, type Affine, type NewObject, type RGB, type VectorShape } from '@stitchpro/engine';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Elements removed outright: scripts, foreign content, pictures, embeds and animations. */
const BANNED = ['script', 'foreignObject', 'image', 'iframe', 'object', 'embed', 'audio', 'video', 'animate', 'animateMotion', 'animateTransform', 'animateColor', 'set', 'discard', 'handler', 'listener'];

/** A local reference (#id) is the only kind of link kept. */
const isLocal = (v: string) => v.trim().startsWith('#');

/**
 * Sanitizes SVG text: removes scripts, foreignObject, images, animations, event handler (on*)
 * attributes, external links and style imports. Throws on text that is not SVG.
 */
export function sanitizeSvg(text: string): string {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const root = doc.documentElement;
  if (doc.getElementsByTagName('parsererror').length || root.localName !== 'svg') throw new Error('This is not a readable SVG file.');
  for (const name of BANNED) for (const el of [...doc.getElementsByTagNameNS('*', name)]) el.remove();
  for (const el of [root, ...root.querySelectorAll('*')]) {
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase();
      const value = attr.value;
      const link = attr.localName === 'href' || name === 'src';
      if (name.startsWith('on') || (link && !isLocal(value)) || /javascript:/i.test(value) || (name === 'style' && /url\(\s*['"]?(?!#)/i.test(value))) {
        el.removeAttributeNode(attr);
      }
    }
    if (el.localName === 'style') el.textContent = (el.textContent ?? '').replace(/@import[^;]*;?/gi, '').replace(/url\(\s*['"]?(?!#)[^)]*\)/gi, 'none');
  }
  return new XMLSerializer().serializeToString(doc);
}

/** CSS px -> mm. */
const MM_PER_PX = 25.4 / 96;

function paint(value: string, opacity: string): RGB | null {
  if (!value || value === 'none' || Number(opacity) === 0) return null;
  const m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?\s*\)/.exec(value);
  if (!m) return null;
  if (m[4] !== undefined && parseFloat(m[4]) === 0) return null;
  return [Math.round(Number(m[1])), Math.round(Number(m[2])), Math.round(Number(m[3]))];
}

const len = (a: SVGAnimatedLength) => a.baseVal.value;

/** A basic shape element as path data in its own user units. */
function shapeData(el: SVGGraphicsElement): string | null {
  switch (el.localName) {
    case 'path':
      return el.getAttribute('d');
    case 'rect': {
      const r = el as SVGRectElement;
      const [x, y, w, h] = [len(r.x), len(r.y), len(r.width), len(r.height)];
      if (!(w > 0 && h > 0)) return null;
      let rx = len(r.rx);
      let ry = len(r.ry);
      if (!r.hasAttribute('rx')) rx = ry;
      if (!r.hasAttribute('ry')) ry = rx;
      rx = Math.min(rx, w / 2);
      ry = Math.min(ry, h / 2);
      if (!(rx > 0 && ry > 0)) return `M${x} ${y}H${x + w}V${y + h}H${x}Z`;
      return `M${x + rx} ${y}H${x + w - rx}A${rx} ${ry} 0 0 1 ${x + w} ${y + ry}V${y + h - ry}A${rx} ${ry} 0 0 1 ${x + w - rx} ${y + h}H${x + rx}A${rx} ${ry} 0 0 1 ${x} ${y + h - ry}V${y + ry}A${rx} ${ry} 0 0 1 ${x + rx} ${y}Z`;
    }
    case 'circle':
    case 'ellipse': {
      const c = el as SVGCircleElement & SVGEllipseElement;
      const cx = len(c.cx);
      const cy = len(c.cy);
      const rx = el.localName === 'circle' ? len(c.r) : len(c.rx);
      const ry = el.localName === 'circle' ? len(c.r) : len(c.ry);
      if (!(rx > 0 && ry > 0)) return null;
      return `M${cx + rx} ${cy}A${rx} ${ry} 0 1 1 ${cx - rx} ${cy}A${rx} ${ry} 0 1 1 ${cx + rx} ${cy}Z`;
    }
    case 'line': {
      const l = el as SVGLineElement;
      return `M${len(l.x1)} ${len(l.y1)}L${len(l.x2)} ${len(l.y2)}`;
    }
    case 'polyline':
    case 'polygon': {
      const pts = [...(el as SVGPolylineElement).points];
      if (pts.length < 2) return null;
      return `M${pts.map((p) => `${p.x} ${p.y}`).join('L')}${el.localName === 'polygon' ? 'Z' : ''}`;
    }
    default:
      return null;
  }
}

/** Whether an element or an ancestor is not rendered. */
function hidden(el: Element): boolean {
  for (let e: Element | null = el; e && e.localName !== 'svg'; e = e.parentElement) {
    if (['defs', 'clipPath', 'mask', 'symbol', 'marker', 'pattern'].includes(e.localName)) return true;
    if (getComputedStyle(e).display === 'none') return true;
  }
  return getComputedStyle(el).visibility === 'hidden';
}

/**
 * Reads the shapes of (sanitized) SVG text with the browser: each element's path data, its
 * full transform to mm, and its final fill and stroke.
 */
export function readSvgShapes(text: string): VectorShape[] {
  const parsed = new DOMParser().parseFromString(sanitizeSvg(text), 'image/svg+xml');
  const svg = document.importNode(parsed.documentElement, true) as unknown as SVGSVGElement;
  // Without a size the viewBox's user units count as CSS pixels.
  const vb = svg.viewBox?.baseVal;
  if (!svg.getAttribute('width') && vb && vb.width) svg.setAttribute('width', String(vb.width));
  if (!svg.getAttribute('height') && vb && vb.height) svg.setAttribute('height', String(vb.height));
  const host = document.createElement('div');
  // Off-screen but rendered: visibility would be inherited and read as hidden shapes.
  host.style.cssText = 'position:fixed;left:-100000px;top:0;opacity:0;pointer-events:none';
  host.append(svg);
  document.body.append(host);
  try {
    const shapes: VectorShape[] = [];
    for (const el of svg.querySelectorAll<SVGGraphicsElement>('path, rect, circle, ellipse, line, polyline, polygon')) {
      if (el.namespaceURI !== SVG_NS || hidden(el)) continue;
      const d = shapeData(el);
      const ctm = el.getCTM();
      if (!d || !ctm) continue;
      const style = getComputedStyle(el);
      const k = MM_PER_PX;
      const matrix: Affine = [ctm.a * k, ctm.b * k, ctm.c * k, ctm.d * k, ctm.e * k, ctm.f * k];
      // A line never fills.
      const fill = el.localName === 'line' ? null : paint(style.fill, style.fillOpacity);
      shapes.push({ d, matrix, fill, stroke: paint(style.stroke, style.strokeOpacity), strokeWidth: parseFloat(style.strokeWidth) || 0 });
    }
    return shapes;
  } finally {
    host.remove();
  }
}

/** Moves imported objects so their bounding box is centred on the hoop centre (0, 0). */
function centre(objects: NewObject[]): NewObject[] {
  const all = objects.flatMap((o) => [...(o.points ?? []), ...(o.holes ?? []).flat()]);
  if (!all.length) return objects;
  const xs = all.map((n) => n.x);
  const ys = all.map((n) => n.y);
  const dx = -(Math.min(...xs) + Math.max(...xs)) / 2;
  const dy = -(Math.min(...ys) + Math.max(...ys)) / 2;
  const move = (n: { x: number; y: number }) => ({ ...n, x: n.x + dx, y: n.y + dy });
  return objects.map((o) => ({ ...o, points: (o.points ?? []).map(move) as NewObject['points'], holes: (o.holes ?? []).map((h) => h.map(move)) as NewObject['holes'] }));
}

/** Import SVG as stitches: fills become tatami, strokes satin or run; centred in the hoop. */
export async function importSvgFile(editor: Editor, file: File): Promise<number> {
  const objects = centre(vectorObjects(readSvgShapes(await file.text())));
  if (!objects.length) {
    editor.setStatus(`"${file.name}" has no filled or stroked shapes to stitch`);
    return 0;
  }
  const ids = editor.insertObjects(objects, 'Import SVG');
  editor.setStatus(`Imported ${ids.length} object${ids.length === 1 ? '' : 's'} from ${file.name}`);
  return ids.length;
}
