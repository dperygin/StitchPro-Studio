// Canvas 2D renderer.

import type { Editor } from './editor';

export class Renderer {
  constructor(
    private readonly editor: Editor,
    private readonly ctx: CanvasRenderingContext2D,
  ) {}

  draw(): void {
    const { canvas } = this.ctx;
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.fillStyle = '#ffffff';
    this.ctx.fillRect(0, 0, canvas.width, canvas.height);
    // Design drawing arrives in a later step; touch the editor so the API is wired.
    void this.editor.design;
  }
}
