import { describe, expect, it } from "vitest";
import { CHARACTER_STATES } from "@kage/core";
import {
  ANIMATIONS,
  COLORS,
  drawPose,
  EMPTY_POSE,
  frameAt,
  PALETTE,
  SPRITE_HEIGHT,
  SPRITE_WIDTH,
} from "../src/index.js";

describe("KAGE sprite art", () => {
  it("has an animation for every character state", () => {
    for (const state of CHARACTER_STATES) {
      const animation = ANIMATIONS[state];
      expect(animation, state).toBeDefined();
      expect(animation.frames.length).toBeGreaterThan(1);
      expect(animation.frameMs).toBeGreaterThan(0);
    }
  });

  it("renders correctly sized, palette-valid frames", () => {
    for (const animation of Object.values(ANIMATIONS)) {
      for (const frame of animation.frames) {
        expect(frame.width).toBe(SPRITE_WIDTH);
        expect(frame.height).toBe(SPRITE_HEIGHT);
        expect(frame.pixels).toHaveLength(SPRITE_WIDTH * SPRITE_HEIGHT);
        for (const value of frame.pixels) {
          expect(value).toBeLessThan(PALETTE.length);
        }
      }
    }
  });

  it("is deterministic", () => {
    const first = drawPose({ ...EMPTY_POSE });
    const second = drawPose({ ...EMPTY_POSE });
    expect(Buffer.from(first.pixels)).toEqual(Buffer.from(second.pixels));
  });

  it("draws a visible creature with glowing eyes", () => {
    const frame = ANIMATIONS.idle.frames[0];
    expect(frame).toBeDefined();
    const visible = Array.from(frame?.pixels ?? []).filter((value) => value !== 0).length;
    expect(visible).toBeGreaterThan(120);
    const eyes = Array.from(frame?.pixels ?? []).filter(
      (value) => value === COLORS.eye || value === COLORS.white,
    ).length;
    expect(eyes).toBeGreaterThan(3);
  });

  it("makes states visually distinguishable", () => {
    const signature = (state: keyof typeof ANIMATIONS): string =>
      Buffer.from(ANIMATIONS[state].frames[0]?.pixels ?? []).toString("base64");
    const seen = new Set<string>();
    for (const state of CHARACTER_STATES) {
      const value = signature(state);
      expect(seen.has(value), `${state} has a unique first frame`).toBe(false);
      seen.add(value);
    }
  });

  it("advances frames over time and honours reduced motion", () => {
    const first = frameAt("working", 0, 1, false);
    const later = frameAt("working", 500, 1, false);
    expect(Buffer.from(first.pixels)).not.toEqual(Buffer.from(later.pixels));

    const reduced = frameAt("working", 500, 1, true);
    expect(Buffer.from(reduced.pixels)).toEqual(Buffer.from(ANIMATIONS.working.frames[0]?.pixels ?? []));
  });
});
