#!/usr/bin/env node
/**
 * Renders KAGE sprite frames in the terminal.
 *
 *   npm run preview:sprites             all states, first frame
 *   npm run preview:sprites -- working  every frame of one state
 *   npm run preview:sprites -- idle --color
 */
import {
  ANIMATIONS,
  COLORS,
  PALETTE_RGB,
  type Animations,
  type SpriteFrame,
} from "../packages/art/src/index.js";
import type { CharacterState } from "../packages/core/src/index.js";

const GLYPHS: Record<number, string> = {
  [COLORS.outline]: "#",
  [COLORS.shade]: ".",
  [COLORS.body]: "+",
  [COLORS.bodyLight]: "*",
  [COLORS.rim]: ":",
  [COLORS.eye]: "o",
  [COLORS.eyeGlow]: "O",
  [COLORS.eyeDim]: "o",
  [COLORS.amber]: "!",
  [COLORS.amberDim]: "!",
  [COLORS.violet]: "z",
  [COLORS.white]: "@",
  [COLORS.mist]: "-",
  [COLORS.shadowBody]: "+",
  [COLORS.shadowRim]: ":",
};

function asciiRow(frame: SpriteFrame, y: number): string {
  let line = "";
  for (let x = 0; x < frame.width; x += 1) {
    const value = frame.pixels[y * frame.width + x] ?? 0;
    line += value === 0 ? " " : (GLYPHS[value] ?? "?");
  }
  return line.replace(/\s+$/, "");
}

function colorRow(frame: SpriteFrame, y: number): string {
  let line = "";
  for (let x = 0; x < frame.width; x += 1) {
    const value = frame.pixels[y * frame.width + x] ?? 0;
    const rgb = PALETTE_RGB[value];
    line += rgb
      ? `\u001b[48;2;${rgb[0]};${rgb[1]};${rgb[2]}m  \u001b[0m`
      : "  ";
  }
  return line;
}

function printFrames(title: string, frames: SpriteFrame[], color: boolean): void {
  const rows = frames[0]?.height ?? 0;
  const columns = Math.min(frames.length, 4);
  console.log(`\n${title}`);
  for (let chunk = 0; chunk < frames.length; chunk += columns) {
    const group = frames.slice(chunk, chunk + columns);
    const lines: string[] = [];
    for (let y = 0; y < rows; y += 1) {
      lines.push(
        group
          .map((frame) => (color ? colorRow(frame, y) : asciiRow(frame, y).padEnd(frame.width)))
          .join("   "),
      );
    }
    console.log(lines.join("\n"));
  }
}

const args = process.argv.slice(2);
const color = args.includes("--color");
const stateArg = args.find((arg) => !arg.startsWith("--")) as CharacterState | undefined;
const states: CharacterState[] = stateArg
  ? [stateArg]
  : (Object.keys(ANIMATIONS) as CharacterState[]);

for (const state of states) {
  const animation = (ANIMATIONS as Animations)[state];
  if (!animation) {
    console.error(`Unknown state: ${state}`);
    process.exit(1);
  }
  const frames = stateArg ? animation.frames : [animation.frames[0] as SpriteFrame];
  printFrames(`${state} (${animation.frameMs}ms/frame)`, frames, color);
}
