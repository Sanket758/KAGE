import { describe, expect, it } from "vitest";
import {
  parseBridgeLine,
  parseKAGEEvent,
  validateKAGEEvent,
  validateSettings,
  DEFAULT_SETTINGS,
} from "../src/index.js";

const NOW = 1_700_000_000_000;

describe("event validation", () => {
  it("accepts a minimal valid event", () => {
    const event = parseKAGEEvent({ type: "session_idle", timestamp: NOW }, NOW);
    expect(event).toEqual({ type: "session_idle", timestamp: NOW });
  });

  it("accepts metadata and trims it", () => {
    const event = parseKAGEEvent(
      {
        type: "tool_started",
        timestamp: NOW,
        sessionId: "ses_1",
        metadata: { toolName: "  edit  ", detail: "a\u0000b", unknown: "ignored" },
      },
      NOW,
    );
    expect(event?.metadata).toEqual({ toolName: "edit", detail: "a b" });
  });

  it("rejects malformed events", () => {
    const cases: unknown[] = [
      null,
      "idle",
      [],
      { type: "unknown", timestamp: NOW },
      { type: "session_idle" },
      { type: "session_idle", timestamp: "now" },
      { type: "session_idle", timestamp: Number.NaN },
      { type: "session_idle", timestamp: NOW, sessionId: 42 },
      { type: "session_idle", timestamp: NOW, sessionId: "x".repeat(200) },
      { type: "session_idle", timestamp: NOW + 10 * 60_000 },
      { type: "session_idle", timestamp: NOW - 48 * 60 * 60_000 },
    ];
    for (const value of cases) {
      expect(validateKAGEEvent(value, NOW).ok, JSON.stringify(value)).toBe(false);
    }
  });

  it("parses bridge lines without throwing", () => {
    expect(parseBridgeLine("{not json", NOW)).toBeNull();
    expect(parseBridgeLine("[]", NOW)).toBeNull();
    expect(parseBridgeLine("x".repeat(10_000), NOW)).toBeNull();
    expect(parseBridgeLine(JSON.stringify({ type: "session_idle", timestamp: NOW }), NOW)).toEqual({
      type: "session_idle",
      timestamp: NOW,
    });
  });
});

describe("settings validation", () => {
  it("returns defaults for missing input", () => {
    const { settings, issues } = validateSettings(undefined);
    expect(settings).toEqual(DEFAULT_SETTINGS);
    expect(issues).toEqual([]);
  });

  it("clamps out-of-range values and reports them", () => {
    const { settings, issues } = validateSettings({
      scale: 99,
      opacity: 0,
      animationIntensity: "maximum",
    });
    expect(settings.scale).toBe(2);
    expect(settings.opacity).toBe(0.35);
    expect(settings.animationIntensity).toBe("normal");
    expect(issues.length).toBeGreaterThanOrEqual(3);
  });

  it("preserves valid values", () => {
    const { settings, issues } = validateSettings({
      scale: 1.5,
      opacity: 0.8,
      animationIntensity: "low",
      reducedMotion: true,
      sound: true,
      launchAtLogin: true,
      showStatusDetails: false,
      position: { x: 120.4, y: -30 },
    });
    expect(issues).toEqual([]);
    expect(settings).toEqual({
      scale: 1.5,
      opacity: 0.8,
      animationIntensity: "low",
      reducedMotion: true,
      sound: true,
      launchAtLogin: true,
      showStatusDetails: false,
      position: { x: 120, y: -30 },
    });
  });

  it("survives corrupted configuration", () => {
    const { settings, issues } = validateSettings("garbage");
    expect(settings).toEqual(DEFAULT_SETTINGS);
    expect(issues).toHaveLength(1);
  });
});
