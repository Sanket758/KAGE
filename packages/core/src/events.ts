import {
  KAGE_EVENT_TYPES,
  type KAGEEvent,
  type KAGEEventMetadata,
  type KAGEEventType,
} from "./types.js";

export const MAX_ID_LENGTH = 128;
export const MAX_TEXT_LENGTH = 240;
export const MAX_TOOL_LENGTH = 64;
export const MAX_INCOMING_BYTES = 8192;
export const MAX_CLOCK_SKEW_MS = 5 * 60_000;
export const MAX_EVENT_AGE_MS = 24 * 60 * 60_000;

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;

export type ValidationResult =
  | { ok: true; event: KAGEEvent }
  | { ok: false; reason: string };

export function isKAGEEventType(value: unknown): value is KAGEEventType {
  return typeof value === "string" && (KAGE_EVENT_TYPES as readonly string[]).includes(value);
}

/** Trims, strips control characters, and caps length. */
export function sanitizeText(value: unknown, maxLength = MAX_TEXT_LENGTH): string | undefined {
  if (typeof value !== "string") return undefined;
  const cleaned = value.replace(CONTROL_CHARS, " ").trim();
  if (!cleaned) return undefined;
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength - 1)}…` : cleaned;
}

function readMetadata(value: unknown): KAGEEventMetadata | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const source = value as Record<string, unknown>;
  const metadata: KAGEEventMetadata = {};
  const toolName = sanitizeText(source.toolName, MAX_TOOL_LENGTH);
  const status = sanitizeText(source.status, MAX_TOOL_LENGTH);
  const detail = sanitizeText(source.detail);
  const directory = sanitizeText(source.directory, 512);
  const project = sanitizeText(source.project, 160);
  if (toolName) metadata.toolName = toolName;
  if (status) metadata.status = status;
  if (detail) metadata.detail = detail;
  if (directory) metadata.directory = directory;
  if (project) metadata.project = project;
  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

/**
 * Runtime validation for untrusted input (socket, fixtures, tests).
 * Rejects anything that is not a well-formed KAGE event.
 */
export function validateKAGEEvent(input: unknown, now = Date.now()): ValidationResult {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, reason: "not an object" };
  }
  const source = input as Record<string, unknown>;
  if (!isKAGEEventType(source.type)) {
    return { ok: false, reason: "unknown event type" };
  }
  const timestamp = source.timestamp;
  if (typeof timestamp !== "number" || !Number.isFinite(timestamp) || timestamp <= 0) {
    return { ok: false, reason: "invalid timestamp" };
  }
  if (timestamp > now + MAX_CLOCK_SKEW_MS) {
    return { ok: false, reason: "timestamp too far in the future" };
  }
  if (timestamp < now - MAX_EVENT_AGE_MS) {
    return { ok: false, reason: "timestamp too old" };
  }
  if (source.sessionId !== undefined) {
    if (typeof source.sessionId !== "string") return { ok: false, reason: "invalid sessionId" };
    if (source.sessionId.length === 0 || source.sessionId.length > MAX_ID_LENGTH) {
      return { ok: false, reason: "sessionId length out of range" };
    }
  }

  const event: KAGEEvent = { type: source.type, timestamp: Math.round(timestamp) };
  const sessionId = sanitizeText(source.sessionId, MAX_ID_LENGTH);
  if (sessionId) event.sessionId = sessionId;
  const metadata = readMetadata(source.metadata);
  if (metadata) event.metadata = metadata;
  return { ok: true, event };
}

export function parseKAGEEvent(input: unknown, now = Date.now()): KAGEEvent | null {
  const result = validateKAGEEvent(input, now);
  return result.ok ? result.event : null;
}

/** Parses a newline-delimited JSON bridge frame. Never throws. */
export function parseBridgeLine(line: string, now = Date.now()): KAGEEvent | null {
  if (line.length > MAX_INCOMING_BYTES) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  return parseKAGEEvent(parsed, now);
}
