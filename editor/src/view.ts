// Zoom/pan transform between design millimetres and canvas pixels.

import type { Point } from '@stitchpro/engine';

export class View {
  /** Pixels per millimetre. */
  zoom = 4;
  /** Canvas pixel position of design origin. */
  panX = 0;
  panY = 0;

  toScreen([x, y]: Point): Point {
    return [x * this.zoom + this.panX, y * this.zoom + this.panY];
  }

  toDesign([x, y]: Point): Point {
    return [(x - this.panX) / this.zoom, (y - this.panY) / this.zoom];
  }
}
