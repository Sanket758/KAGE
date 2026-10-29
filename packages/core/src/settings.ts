export const ANIMATION_INTENSITIES = ["low", "normal", "high"] as const;
export type AnimationIntensity = (typeof ANIMATION_INTENSITIES)[number];

export interface KAGEPosition {
  x: number;
  y: number;
}

export interface KAGESettings {
  /** Character scale multiplier inside the fixed-size window. */
  scale: number;
  /** Character opacity (0.35 - 1). */
  opacity: number;
  animationIntensity: AnimationIntensity;
  /** Sprite skin id, resolved against the app's skins index at runtime. */
  skin: string;
  reducedMotion: boolean;
  sound: boolean;
  showStatusDetails: boolean;
  position: KAGEPosition | null;
}

export const DEFAULT_SETTINGS: KAGESettings = {
  scale: 1,
  opacity: 1,
  animationIntensity: "normal",
  skin: "kagekin",
  reducedMotion: false,
  sound: false,
  showStatusDetails: true,
  position: null,
};

export const DEFAULT_SKIN = "kagekin";
const SKIN_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/;

const MIN_SCALE = 0.75;
const MAX_SCALE = 2;
const MIN_OPACITY = 0.35;
const MAX_OPACITY = 1;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validates a persisted settings blob. Unknown or corrupted values fall back
 * to defaults and are reported so the UI can explain the reset.
 */
export function validateSettings(raw: unknown): {
  settings: KAGESettings;
  issues: string[];
} {
  const issues: string[] = [];
  const settings: KAGESettings = { ...DEFAULT_SETTINGS, position: null };
  if (!isRecord(raw)) {
    if (raw !== undefined && raw !== null) issues.push("settings are not an object");
    return { settings, issues };
  }

  if (typeof raw.scale === "number" && Number.isFinite(raw.scale)) {
    const scale = clamp(raw.scale, MIN_SCALE, MAX_SCALE);
    if (scale !== raw.scale) issues.push("scale was out of range");
    settings.scale = Math.round(scale * 4) / 4;
  } else if (raw.scale !== undefined) {
    issues.push("invalid scale");
  }

  if (typeof raw.opacity === "number" && Number.isFinite(raw.opacity)) {
    const opacity = clamp(raw.opacity, MIN_OPACITY, MAX_OPACITY);
    if (opacity !== raw.opacity) issues.push("opacity was out of range");
    settings.opacity = Math.round(opacity * 100) / 100;
  } else if (raw.opacity !== undefined) {
    issues.push("invalid opacity");
  }

  if (
    typeof raw.animationIntensity === "string" &&
    (ANIMATION_INTENSITIES as readonly string[]).includes(raw.animationIntensity)
  ) {
    settings.animationIntensity = raw.animationIntensity as AnimationIntensity;
  } else if (raw.animationIntensity !== undefined) {
    issues.push("invalid animation intensity");
  }

  if (typeof raw.skin === "string") {
    if (SKIN_ID_PATTERN.test(raw.skin)) {
      settings.skin = raw.skin;
    } else {
      issues.push("invalid skin id");
    }
  } else if (raw.skin !== undefined) {
    issues.push("invalid skin id");
  }

  for (const key of ["reducedMotion", "sound", "showStatusDetails"] as const) {
    const value = raw[key];
    if (typeof value === "boolean") {
      settings[key] = value;
    } else if (value !== undefined) {
      issues.push(`invalid ${key}`);
    }
  }

  if (isRecord(raw.position)) {
    const { x, y } = raw.position;
    if (
      typeof x === "number" &&
      typeof y === "number" &&
      Number.isFinite(x) &&
      Number.isFinite(y) &&
      Math.abs(x) < 100_000 &&
      Math.abs(y) < 100_000
    ) {
      settings.position = { x: Math.round(x), y: Math.round(y) };
    } else {
      issues.push("invalid window position");
    }
  } else if (raw.position !== undefined && raw.position !== null) {
    issues.push("invalid window position");
  }

  return { settings, issues };
}
