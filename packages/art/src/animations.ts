import type { CharacterState } from "@kage/core";
import type { SpriteFrame } from "./canvas.js";
import { COLORS } from "./palette.js";
import { drawPose, EMPTY_POSE, type Particle, type Pose } from "./creature.js";

export interface Animation {
  frames: SpriteFrame[];
  frameMs: number;
  loop: boolean;
}

export type Animations = Record<CharacterState, Animation>;

function pose(overrides: Partial<Pose>): Pose {
  return { ...EMPTY_POSE, ...overrides };
}

/** Cyan sparks drifting up from the tail and paws while a tool runs. */
function sparks(step: number, strength: number): Particle[] {
  const pair: Particle[] = [
    { x: 34, y: 26 - step, color: COLORS.eye },
    { x: 36, y: 21 - step, color: COLORS.eyeGlow },
    { x: 31, y: 20 + (step % 2), color: COLORS.eyeDim },
  ];
  if (strength < 2) return pair;
  return [
    ...pair,
    { x: 29, y: 38 - step, color: COLORS.eyeDim },
    { x: 10, y: 36 - step, color: COLORS.eye },
  ];
}

function sparkle(x: number, y: number, color: number): Particle[] {
  return [
    { x, y, color },
    { x: x - 1, y, color },
    { x: x + 1, y, color },
    { x, y: y - 1, color },
    { x, y: y + 1, color },
  ];
}

export function buildAnimations(): Animations {
  const sleeping: SpriteFrame[] = [0, 1, 2, 3].map((frame) =>
    drawPose(
      pose({
        bob: 1,
        eye: "blink",
        eyeColor: COLORS.eyeDim,
        mouth: "none",
        ear: "droop",
        tail: -1,
        marker: "zzz",
        markerStep: frame,
      }),
    ),
  );

  const idle: SpriteFrame[] = [0, 1, 2, 3].map((frame) =>
    drawPose(
      pose({
        bob: frame === 2 ? 1 : 0,
        eye: frame === 3 ? "blink" : "open",
        mouth: "small",
        tail: frame === 0 ? -1 : frame === 2 ? 1 : 0,
      }),
    ),
  );

  const waking: SpriteFrame[] = [0, 1, 2].map((frame) =>
    drawPose(
      pose({
        bob: 2 - frame,
        eye: frame === 0 ? "blink" : frame === 1 ? "wide" : "open",
        mouth: "small",
        ear: frame === 0 ? "droop" : "perk",
        tail: frame === 1 ? 1 : 0,
      }),
    ),
  );

  const working: SpriteFrame[] = [0, 1, 2, 3].map((frame) =>
    drawPose(
      pose({
        bob: [0, 1, 0, -1][frame] ?? 0,
        eye: "focus",
        mouth: "small",
        ear: "perk",
        tail: frame % 2 === 0 ? 1 : -1,
        particles: sparks(frame, 1),
      }),
    ),
  );

  const toolActivity: SpriteFrame[] = [0, 1, 2, 3].map((frame) =>
    drawPose(
      pose({
        bob: [0, -1, 0, 1][frame] ?? 0,
        eye: frame % 2 === 0 ? "focus" : "wide",
        mouth: "small",
        ear: "perk",
        tail: frame % 2 === 0 ? -1 : 1,
        particles: sparks(frame, 2),
      }),
    ),
  );

  const searching: SpriteFrame[] = [0, 1, 2, 3].map((frame) =>
    drawPose(
      pose({
        bob: [0, 1, 0, -1][frame] ?? 0,
        eye: "focus",
        mouth: "small",
        ear: "perk",
        tail: frame % 2 === 0 ? 1 : -1,
        marker: "search",
        markerStep: frame,
        particles: [
          { x: 7, y: 18 - (frame % 2), color: COLORS.eyeDim },
          { x: 33, y: 14 + (frame % 2), color: COLORS.eyeGlow },
        ],
      }),
    ),
  );

  const attention: SpriteFrame[] = [0, 1].map((frame) =>
    drawPose(
      pose({
        bob: 0,
        eye: "wide",
        mouth: "small",
        ear: "perk",
        tail: 0,
        marker: "attention",
        markerStep: frame,
        particles: [{ x: 4, y: 20, color: COLORS.amberDim }],
      }),
    ),
  );

  const error: SpriteFrame[] = [0, 1].map((frame) =>
    drawPose(
      pose({
        bob: 1,
        eye: "cross",
        eyeColor: COLORS.amber,
        mouth: "worried",
        ear: "droop",
        tail: -1,
        brows: true,
        marker: "error",
        markerStep: frame,
      }),
    ),
  );

  const celebrating: SpriteFrame[] = [0, 1, 2, 3, 4, 5].map((frame) => {
    const burst =
      frame % 2 === 0
        ? [...sparkle(34, 13, COLORS.eyeGlow), ...sparkle(6, 20, COLORS.amberDim)]
        : [...sparkle(5, 30, COLORS.eye), ...sparkle(35, 25, COLORS.white)];
    return drawPose(
      pose({
        bob: [-1, 0, -2, -1, -1, 0][frame] ?? 0,
        eye: "happy",
        mouth: "smile",
        ear: "perk",
        tail: frame % 2 === 0 ? 1 : -1,
        particles: burst,
      }),
    );
  });

  const disconnected: SpriteFrame[] = [0, 1].map((frame) =>
    drawPose(
      pose({
        bob: 1,
        eye: "blink",
        eyeColor: COLORS.violet,
        body: "dim",
        ear: "droop",
        tail: -1,
        marker: "static",
        markerStep: frame,
      }),
    ),
  );

  return {
    sleeping: { frames: sleeping, frameMs: 420, loop: true },
    idle: { frames: idle, frameMs: 260, loop: true },
    waking: { frames: waking, frameMs: 150, loop: true },
    working: { frames: working, frameMs: 180, loop: true },
    tool_activity: { frames: toolActivity, frameMs: 130, loop: true },
    searching: { frames: searching, frameMs: 220, loop: true },
    attention: { frames: attention, frameMs: 500, loop: true },
    error: { frames: error, frameMs: 240, loop: true },
    celebrating: { frames: celebrating, frameMs: 130, loop: true },
    disconnected: { frames: disconnected, frameMs: 800, loop: true },
  };
}

export const ANIMATIONS: Animations = buildAnimations();

/** Selects the deterministic frame for a state at a point in time. */
export function frameAt(
  state: CharacterState,
  elapsedMs: number,
  intensity: number,
  reducedMotion: boolean,
): SpriteFrame {
  const animation = ANIMATIONS[state];
  if (reducedMotion) return animation.frames[0] as SpriteFrame;
  const frameMs = Math.max(60, Math.round(animation.frameMs / Math.max(0.5, intensity)));
  const index = Math.floor(Math.max(0, elapsedMs) / frameMs) % animation.frames.length;
  return animation.frames[index] as SpriteFrame;
}
