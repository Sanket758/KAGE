#!/usr/bin/env node
/**
 * Generates the app icons from KAGE's idle frame so the desktop icon and the
 * companion are the same character. Run with `npx tsx scripts/generate-icons.ts`.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import { ANIMATIONS, PALETTE_RGB } from "../packages/art/src/index.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "apps/desktop/src-tauri/icons");

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([length, typeAndData, crc]);
}

function encodePng(width: number, height: number, rgba: Uint8Array): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(
      raw,
      y * (width * 4 + 1) + 1,
    );
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function renderFrame(width: number, height: number): Uint8Array {
  const frame = ANIMATIONS.idle.frames[0]!;
  const out = new Uint8Array(width * height * 4);
  const scale = Math.floor(Math.min(width, height) / 32);
  const offsetX = Math.floor((width - 32 * scale) / 2);
  const offsetY = Math.floor((height - 32 * scale) / 2);

  // Circular badge so the dark creature stays visible on dark taskbars.
  const center = (width - 1) / 2;
  const radius = width / 2 - 0.5;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const distance = Math.hypot(x - center, y - center);
      if (distance > radius) continue;
      const edge = distance > radius - Math.max(1, width / 32);
      const rgb = edge ? [58, 49, 96] : [10, 17, 32];
      const offset = (y * width + x) * 4;
      out[offset] = rgb[0]!;
      out[offset + 1] = rgb[1]!;
      out[offset + 2] = rgb[2]!;
      out[offset + 3] = 255;
    }
  }

  for (let y = 0; y < 32; y += 1) {
    for (let x = 0; x < 32; x += 1) {
      const color = PALETTE_RGB[frame.pixels[y * 32 + x] ?? 0];
      if (!color) continue;
      for (let sy = 0; sy < scale; sy += 1) {
        for (let sx = 0; sx < scale; sx += 1) {
          const px = offsetX + x * scale + sx;
          const py = offsetY + y * scale + sy;
          if (px < 0 || py < 0 || px >= width || py >= height) continue;
          const offset = (py * width + px) * 4;
          out[offset] = color[0];
          out[offset + 1] = color[1];
          out[offset + 2] = color[2];
          out[offset + 3] = 255;
        }
      }
    }
  }
  return out;
}

mkdirSync(OUT_DIR, { recursive: true });
const sizes: Array<[string, number]> = [
  ["32x32.png", 32],
  ["128x128.png", 128],
  ["128x128@2x.png", 256],
  ["icon.png", 512],
];
for (const [name, size] of sizes) {
  writeFileSync(join(OUT_DIR, name), encodePng(size, size, renderFrame(size, size)));
  console.log(`wrote ${name} (${size}x${size})`);
}
