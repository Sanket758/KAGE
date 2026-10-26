import { PixelCanvas, SPRITE_HEIGHT, SPRITE_WIDTH, type SpriteFrame } from "./canvas.js";
import { COLORS } from "./palette.js";

export type EyeExpression = "open" | "focus" | "wide" | "blink" | "happy" | "worried" | "cross";
export type Mouth = "none" | "small" | "smile" | "worried";
export type Marker = "none" | "attention" | "error" | "zzz" | "static" | "search";
export type BodyMode = "normal" | "dim";
export type EarPose = "normal" | "perk" | "droop";

export interface Particle {
  x: number;
  y: number;
  color: number;
}

export interface Pose {
  /** Vertical breathing offset in pixels, applied to the whole creature. */
  bob: number;
  eye: EyeExpression;
  eyeColor: number;
  mouth: Mouth;
  marker: Marker;
  markerStep: number;
  body: BodyMode;
  brows: boolean;
  ear: EarPose;
  /** Tail sway, -2..2 pixels. */
  tail: number;
  particles: Particle[];
}

/* ------------------------------------------------------------------ *
 * KAGE is a small egg-shaped shadow spirit: two tall ears, a single
 * glowing pair of eyes, a chest spark and a thin curling tail. Drawn
 * on a 40x40 grid so the silhouette stays compact on the desktop.
 * ------------------------------------------------------------------ */

class Mask {
  readonly cells = new Uint8Array(SPRITE_WIDTH * SPRITE_HEIGHT);

  set(x: number, y: number): void {
    if (x < 0 || y < 0 || x >= SPRITE_WIDTH || y >= SPRITE_HEIGHT) return;
    this.cells[y * SPRITE_WIDTH + x] = 1;
  }

  has(x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= SPRITE_WIDTH || y >= SPRITE_HEIGHT) return false;
    return this.cells[y * SPRITE_WIDTH + x] === 1;
  }
}

function triangle(
  mask: Mask,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
): void {
  const minX = Math.floor(Math.min(ax, bx, cx));
  const maxX = Math.ceil(Math.max(ax, bx, cx));
  const minY = Math.floor(Math.min(ay, by, cy));
  const maxY = Math.ceil(Math.max(ay, by, cy));
  const area = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
  if (area === 0) return;
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const w0 = ((bx - ax) * (y - ay) - (x - ax) * (by - ay)) / area;
      const w1 = ((cx - bx) * (y - by) - (x - bx) * (cy - by)) / area;
      const w2 = ((ax - cx) * (y - cy) - (x - cx) * (ay - cy)) / area;
      if (w0 >= -0.001 && w1 >= -0.001 && w2 >= -0.001) mask.set(x, y);
    }
  }
}

const CENTER = 20;
const EYE_Y = 17;
const LEFT_EYE_X = 14;
const RIGHT_EYE_X = 22;

/**
 * Body silhouette, authored row by row: [y, left, right].
 * One continuous egg from the crown to the base, so there is no neck seam.
 */
const BODY_ROWS: ReadonlyArray<readonly [number, number, number]> = [
  [12, 10, 29],
  [13, 9, 30],
  [14, 8, 31],
  [15, 8, 31],
  [16, 8, 31],
  [17, 8, 31],
  [18, 8, 31],
  [19, 8, 31],
  [20, 8, 31],
  [21, 8, 31],
  [22, 8, 31],
  [23, 8, 31],
  [24, 9, 30],
  [25, 9, 30],
  [26, 11, 28],
  // Body.
  [26, 13, 26],
  [27, 12, 27],
  [28, 12, 27],
  [29, 11, 28],
  [30, 11, 28],
  [31, 11, 28],
  [32, 11, 28],
  [33, 12, 27],
  [34, 12, 27],
  [35, 13, 26],
  [36, 13, 26],
  [37, 14, 25],
];

function earTip(pose: Pose): number {
  return pose.ear === "perk" ? 2 : pose.ear === "droop" ? 7 : 4;
}

function bodyColor(mode: BodyMode): number {
  return mode === "dim" ? COLORS.shadowBody : COLORS.body;
}

function lightColor(mode: BodyMode): number {
  return mode === "dim" ? COLORS.shadowRim : COLORS.bodyLight;
}

function rimColor(mode: BodyMode): number {
  return mode === "dim" ? COLORS.shadowRim : COLORS.rim;
}

function shadeColor(mode: BodyMode): number {
  return mode === "dim" ? COLORS.outline : COLORS.shade;
}

function buildSilhouette(pose: Pose): Mask {
  const mask = new Mask();
  const bob = pose.bob;

  for (const [baseY, left, right] of BODY_ROWS) {
    for (let x = left; x <= right; x += 1) mask.set(x, baseY + bob);
  }

  const tip = earTip(pose) + bob;
  triangle(mask, 9, 13 + bob, 16, 13 + bob, 12.5, tip);
  triangle(mask, 23, 13 + bob, 30, 13 + bob, 27.5, tip);

  // Tail: a short comma curling up behind the haunch.
  const tail = pose.tail;
  const blocks: ReadonlyArray<readonly [number, number, number]> = [
    [30, 26, 29],
    [31, 28, 31],
    [32, 29, 32],
    [33, 29, 31],
    [34, 28, 30],
    [35, 27, 28],
  ];
  for (const [y, left, right] of blocks) {
    for (let x = left; x <= right; x += 1) mask.set(x + tail, y + bob);
  }

  return mask;
}

function drawBody(canvas: PixelCanvas, mask: Mask, pose: Pose): void {
  const base = bodyColor(pose.body);
  const light = lightColor(pose.body);
  const rim = rimColor(pose.body);
  const shade = shadeColor(pose.body);

  for (let y = 0; y < SPRITE_HEIGHT; y += 1) {
    for (let x = 0; x < SPRITE_WIDTH; x += 1) {
      if (!mask.has(x, y)) continue;
      let color = base;
      if (!mask.has(x, y - 1)) color = light;
      else if (!mask.has(x - 1, y)) color = rim;
      if (!mask.has(x, y + 1)) color = shade;
      canvas.set(x, y, color);
    }
  }
}

function drawEars(canvas: PixelCanvas, mask: Mask, pose: Pose): void {
  const bob = pose.bob;
  const tip = earTip(pose);
  const inner = new Mask();
  triangle(inner, 10.5, 12 + bob, 14.5, 12 + bob, 12.5, tip + 4 + bob);
  triangle(inner, 24.5, 12 + bob, 28.5, 12 + bob, 27.5, tip + 4 + bob);

  const innerColor = pose.body === "dim" ? COLORS.mist : COLORS.body;
  for (let y = 0; y < SPRITE_HEIGHT; y += 1) {
    for (let x = 0; x < SPRITE_WIDTH; x += 1) {
      if (inner.has(x, y) && mask.has(x, y)) canvas.set(x, y, innerColor);
    }
  }

  const accent = pose.body === "dim" ? COLORS.mist : COLORS.eyeDim;
  canvas.set(12, tip + 6 + bob, accent);
  canvas.set(27, tip + 6 + bob, accent);
}

function drawFace(canvas: PixelCanvas, pose: Pose): void {
  const bob = pose.bob;

  if (pose.brows) {
    const browY = EYE_Y - 3 + bob;
    canvas.set(12, browY + 1, COLORS.amberDim);
    canvas.set(13, browY, COLORS.amberDim);
    canvas.set(25, browY, COLORS.amberDim);
    canvas.set(26, browY + 1, COLORS.amberDim);
  }

  drawEye(canvas, LEFT_EYE_X, pose, false);
  drawEye(canvas, RIGHT_EYE_X, pose, true);

  // A small recessed muzzle gives the face a centre without a face plate.
  const muzzle = pose.body === "dim" ? COLORS.outline : COLORS.shade;
  for (let y = 20; y <= 23; y += 1) {
    for (let x = 18; x <= 21; x += 1) {
      if ((x === 18 || x === 21) && (y === 20 || y === 23)) continue;
      canvas.set(x, y + bob, muzzle);
    }
  }
  const nose = pose.body === "dim" ? COLORS.mist : COLORS.violet;
  canvas.set(19, 21 + bob, nose);
  canvas.set(20, 21 + bob, nose);

  const mouthY = 22 + bob;
  if (pose.mouth === "small") {
    canvas.set(19, mouthY, COLORS.eyeDim);
    canvas.set(20, mouthY, COLORS.eyeDim);
  } else if (pose.mouth === "smile") {
    canvas.set(18, mouthY, COLORS.eye);
    canvas.set(21, mouthY, COLORS.eye);
    canvas.set(19, mouthY + 1, COLORS.eyeDim);
    canvas.set(20, mouthY + 1, COLORS.eyeDim);
  } else if (pose.mouth === "worried") {
    canvas.set(19, mouthY, COLORS.amberDim);
    canvas.set(20, mouthY + 1, COLORS.amberDim);
  }
}

const EYE_SHAPES: Record<EyeExpression, readonly string[]> = {
  open: [".oo.", "oooo", ".oo."],
  focus: [".oo.", ".oo.", "...."],
  wide: [".oo.", "oooo", "oooo", ".oo."],
  blink: ["....", "oooo", "...."],
  happy: [".oo.", "o..o", "...."],
  worried: [".oo.", ".oo.", "o..o"],
  cross: ["o..o", ".oo.", "o..o"],
};

function drawEye(canvas: PixelCanvas, x0: number, pose: Pose, mirrored: boolean): void {
  const shape = EYE_SHAPES[pose.eye];
  const y0 = EYE_Y + pose.bob;
  const color = pose.eyeColor;
  for (let row = 0; row < shape.length; row += 1) {
    const line = shape[row] ?? "";
    for (let column = 0; column < line.length; column += 1) {
      const mark = line[column];
      if (mark !== "o" && mark !== "g") continue;
      const columnIndex = mirrored ? line.length - 1 - column : column;
      const x = x0 + columnIndex;
      const y = y0 + row;
      const glint = row === 0 && columnIndex === (mirrored ? 2 : 1);
      canvas.set(x, y, glint ? COLORS.white : mark === "g" ? COLORS.eyeGlow : color);
    }
  }
}

function drawDetails(canvas: PixelCanvas, pose: Pose): void {
  const bob = pose.bob;
  const dim = pose.body === "dim";

  // Chest spark.
  const sparkY = 27 + bob;
  canvas.set(CENTER, sparkY, dim ? COLORS.mist : COLORS.eyeDim);
  canvas.set(CENTER - 1, sparkY + 1, dim ? COLORS.mist : COLORS.eyeDim);
  canvas.set(CENTER, sparkY + 1, dim ? COLORS.violet : COLORS.eye);
  canvas.set(CENTER + 1, sparkY + 1, dim ? COLORS.mist : COLORS.eyeDim);
  canvas.set(CENTER, sparkY + 2, dim ? COLORS.mist : COLORS.eyeDim);

  // Tail tip catches the light.
  const tipX = 27 + pose.tail;
  const tipY = 34 + bob;
  canvas.set(tipX, tipY, dim ? COLORS.violet : COLORS.eye);
  canvas.set(tipX - 1, tipY - 1, dim ? COLORS.mist : COLORS.eyeDim);

  // Toe hints.
  const paw = dim ? COLORS.outline : COLORS.shade;
  canvas.set(16, 33 + bob, paw);
  canvas.set(18, 33 + bob, paw);
  canvas.set(22, 33 + bob, paw);
  canvas.set(24, 33 + bob, paw);
}

function drawParticles(canvas: PixelCanvas, pose: Pose): void {
  for (const particle of pose.particles) {
    canvas.set(particle.x, particle.y + pose.bob, particle.color);
  }
}

function drawMarker(canvas: PixelCanvas, pose: Pose): void {
  if (pose.marker === "attention") {
    const x = 33;
    const y = 4 + (pose.markerStep % 2);
    for (let offset = 0; offset < 5; offset += 1) {
      canvas.set(x, y + offset, COLORS.amber);
      canvas.set(x + 1, y + offset, offset === 0 ? COLORS.white : COLORS.amber);
    }
    canvas.set(x, y + 6, COLORS.amber);
    canvas.set(x + 1, y + 6, COLORS.amberDim);
    const aura = pose.markerStep % 2 === 0 ? COLORS.amber : COLORS.amberDim;
    canvas.set(4, 20 + pose.bob, aura);
    canvas.set(35, 17 + pose.bob, aura);
  } else if (pose.marker === "error") {
    const ember = pose.markerStep % 2 === 0 ? COLORS.amberDim : COLORS.amber;
    canvas.set(6, 31 + pose.bob, ember);
    canvas.set(32, 33 + pose.bob, ember);
    canvas.set(4, 26 + pose.bob, COLORS.amberDim);
  } else if (pose.marker === "zzz") {
    const drift = pose.markerStep % 2;
    drawZ(canvas, 29, 9 + pose.bob - drift, COLORS.violet);
    drawZ(canvas, 33, 4 + pose.bob, COLORS.mist);
  } else if (pose.marker === "static") {
    const flicker = pose.markerStep % 2 === 0;
    canvas.set(4, 17 + pose.bob, flicker ? COLORS.violet : COLORS.mist);
    canvas.set(34, 19 + pose.bob, flicker ? COLORS.mist : COLORS.violet);
    canvas.set(30, 6 + pose.bob, COLORS.mist);
    canvas.set(8, 30 + pose.bob, COLORS.mist);
  } else if (pose.marker === "search") {
    // A small original magnifying lens, held beside the right ear.
    const x = 32;
    const y = 5 + (pose.markerStep % 2);
    canvas.set(x + 1, y, COLORS.eyeGlow);
    canvas.set(x + 2, y, COLORS.eye);
    canvas.set(x + 3, y, COLORS.eye);
    canvas.set(x, y + 1, COLORS.eye);
    canvas.set(x + 4, y + 1, COLORS.eye);
    canvas.set(x, y + 2, COLORS.eye);
    canvas.set(x + 4, y + 2, COLORS.eye);
    canvas.set(x + 1, y + 3, COLORS.eye);
    canvas.set(x + 2, y + 3, COLORS.eye);
    canvas.set(x + 3, y + 3, COLORS.eyeDim);
    canvas.set(x + 1, y + 1, COLORS.white);
    // A tiny scan spark keeps the search pose alive without a second prop.
    canvas.set(x + 2, y + 5, COLORS.eyeDim);
    canvas.set(x + 3, y + 6, COLORS.eyeDim);
    canvas.set(6, 24 + pose.bob, pose.markerStep % 2 === 0 ? COLORS.eye : COLORS.eyeDim);
  }
}

function drawZ(canvas: PixelCanvas, x: number, y: number, color: number): void {
  canvas.set(x, y, color);
  canvas.set(x + 1, y, color);
  canvas.set(x + 2, y, color);
  canvas.set(x + 1, y + 1, color);
  canvas.set(x, y + 2, color);
  canvas.set(x + 1, y + 2, color);
  canvas.set(x + 2, y + 2, color);
}

export function drawPose(pose: Pose): SpriteFrame {
  const canvas = new PixelCanvas(SPRITE_WIDTH, SPRITE_HEIGHT);
  const mask = buildSilhouette(pose);

  drawParticles(canvas, pose);
  drawBody(canvas, mask, pose);
  drawEars(canvas, mask, pose);
  drawFace(canvas, pose);
  drawDetails(canvas, pose);
  drawMarker(canvas, pose);

  // One-pixel outline around the silhouette.
  for (let y = 0; y < SPRITE_HEIGHT; y += 1) {
    for (let x = 0; x < SPRITE_WIDTH; x += 1) {
      if (mask.has(x, y)) continue;
      const neighbor =
        mask.has(x - 1, y) ||
        mask.has(x + 1, y) ||
        mask.has(x, y - 1) ||
        mask.has(x, y + 1) ||
        mask.has(x - 1, y - 1) ||
        mask.has(x + 1, y - 1) ||
        mask.has(x - 1, y + 1) ||
        mask.has(x + 1, y + 1);
      if (neighbor) canvas.set(x, y, COLORS.outline);
    }
  }

  return canvas.frame();
}

export function createPose(overrides: Partial<Pose> = {}): Pose {
  return { ...EMPTY_POSE, ...overrides };
}

export const EMPTY_POSE: Pose = {
  bob: 0,
  eye: "open",
  eyeColor: COLORS.eye,
  mouth: "none",
  marker: "none",
  markerStep: 0,
  body: "normal",
  brows: false,
  ear: "normal",
  tail: 0,
  particles: [],
};
