export interface SpriteFrame {
  width: number;
  height: number;
  /** Palette indices; 0 is transparent. */
  pixels: Uint8Array;
}

export const SPRITE_WIDTH = 40;
export const SPRITE_HEIGHT = 40;

export class PixelCanvas {
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8Array;

  constructor(width = SPRITE_WIDTH, height = SPRITE_HEIGHT) {
    this.width = width;
    this.height = height;
    this.pixels = new Uint8Array(width * height);
  }

  set(x: number, y: number, color: number): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    this.pixels[y * this.width + x] = color;
  }

  get(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return 0;
    return this.pixels[y * this.width + x] ?? 0;
  }

  span(x0: number, x1: number, y: number, color: number): void {
    const start = Math.min(x0, x1);
    const end = Math.max(x0, x1);
    for (let x = start; x <= end; x += 1) this.set(x, y, color);
  }

  /** Draws the same pixel on both sides of the sprite's vertical axis. */
  mirror(x: number, y: number, color: number): void {
    this.set(x, y, color);
    this.set(this.width - 1 - x, y, color);
  }

  frame(): SpriteFrame {
    return { width: this.width, height: this.height, pixels: new Uint8Array(this.pixels) };
  }
}
