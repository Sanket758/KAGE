import type { SpriteFrame } from "./canvas.js";
import { PALETTE_RGB } from "./palette.js";

const offscreen = new WeakMap<SpriteFrame, HTMLCanvasElement>();

/** Converts an indexed frame into a cached 1x canvas for nearest-neighbor scaling. */
export function frameToCanvas(frame: SpriteFrame): HTMLCanvasElement {
  const cached = offscreen.get(frame);
  if (cached) return cached;

  const canvas = document.createElement("canvas");
  canvas.width = frame.width;
  canvas.height = frame.height;
  const context = canvas.getContext("2d");
  if (!context) return canvas;

  const image = context.createImageData(frame.width, frame.height);
  for (let index = 0; index < frame.pixels.length; index += 1) {
    const color = PALETTE_RGB[frame.pixels[index] ?? 0];
    if (!color) continue;
    const offset = index * 4;
    image.data[offset] = color[0];
    image.data[offset + 1] = color[1];
    image.data[offset + 2] = color[2];
    image.data[offset + 3] = 255;
  }
  context.putImageData(image, 0, 0);
  offscreen.set(frame, canvas);
  return canvas;
}

export interface DrawOptions {
  x?: number;
  y?: number;
  scale?: number;
  alpha?: number;
}

export function drawFrame(
  context: CanvasRenderingContext2D,
  frame: SpriteFrame,
  options: DrawOptions = {},
): void {
  const scale = options.scale ?? 1;
  const alpha = options.alpha ?? 1;
  context.save();
  context.globalAlpha = Math.min(1, Math.max(0, alpha));
  context.imageSmoothingEnabled = false;
  context.drawImage(
    frameToCanvas(frame),
    Math.round(options.x ?? 0),
    Math.round(options.y ?? 0),
    frame.width * scale,
    frame.height * scale,
  );
  context.restore();
}
