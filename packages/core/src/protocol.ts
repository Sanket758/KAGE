import { sanitizeText } from "./events.js";
import type { KAGEEvent } from "./types.js";
import { validateKAGEEvent } from "./events.js";

export const PROTOCOL_VERSION = 1;
export const MAX_FRAME_BYTES = 8192;

export interface HelloMessage {
  type: "hello";
  version: number;
  token: string;
  directory?: string;
  pid?: number;
}

export interface WelcomeMessage {
  type: "welcome";
  version: number;
}

export interface ErrorMessage {
  type: "error";
  reason: string;
}

export type ClientMessage = HelloMessage | { type: "event"; event: KAGEEvent };

export type ClientMessageResult =
  | { ok: true; message: ClientMessage }
  | { ok: false; reason: string };

/**
 * Parses a single NDJSON line from the plugin. The socket is local but still
 * treated as untrusted: size, shape and version are all checked.
 */
export function parseClientMessage(line: string, now = Date.now()): ClientMessageResult {
  if (line.length === 0) return { ok: false, reason: "empty frame" };
  if (line.length > MAX_FRAME_BYTES) return { ok: false, reason: "frame too large" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return { ok: false, reason: "invalid json" };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ok: false, reason: "not an object" };
  }
  const frame = parsed as Record<string, unknown>;

  if (frame.type === "hello") {
    if (frame.version !== PROTOCOL_VERSION) return { ok: false, reason: "unsupported protocol" };
    const token = sanitizeText(frame.token, 256);
    if (!token) return { ok: false, reason: "missing token" };
    const directory = sanitizeText(frame.directory, 512);
    const pid = typeof frame.pid === "number" && Number.isInteger(frame.pid) ? frame.pid : undefined;
    const hello: HelloMessage = { type: "hello", version: PROTOCOL_VERSION, token };
    if (directory) hello.directory = directory;
    if (pid !== undefined) hello.pid = pid;
    return { ok: true, message: hello };
  }

  if (frame.type === "event") {
    const result = validateKAGEEvent(frame.event, now);
    if (!result.ok) return { ok: false, reason: result.reason };
    return { ok: true, message: { type: "event", event: result.event } };
  }

  return { ok: false, reason: "unknown message type" };
}
