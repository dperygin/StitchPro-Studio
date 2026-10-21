// Zoom/pan transform between design millimetres and canvas pixels.

import type { Point } from '@stitchpro/engine';

export class View {
  /** Pixels per millimetre. */
  zoom = 4;
  /** Canvas pixel position of design origin. */
  panX = 0;
  panY = 0;

  toScreen(p: Point): Point {
    return { x: p.x * this.zoom + this.panX, y: p.y * this.zoom + this.panY };
  }

  toDesign(p: Point): Point {
    return { x: (p.x - this.panX) / this.zoom, y: (p.y - this.panY) / this.zoom };
  }
}
