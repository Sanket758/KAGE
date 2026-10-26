import { sanitizeText } from "./events.js";
import type { KAGEEvent, KAGEEventMetadata } from "./types.js";

/**
 * Converts documented OpenCode plugin events into KAGE's internal contract.
 *
 * Unknown events are ignored rather than guessed at. Every mapping is
 * defensive about payload shape so a provider upgrade cannot crash a plugin
 * inside an active OpenCode session.
 */
export function normalizeOpencodeEvent(input: unknown, now = Date.now()): KAGEEvent[] {
  if (typeof input !== "object" || input === null) return [];
  const event = input as Record<string, unknown>;
  const type = typeof event.type === "string" ? event.type : "";
  // OpenCode V2 publishes payload fields under `data`; V1 used `properties`.
  // Accept both so the companion survives a runtime upgrade.
  const properties = {
    ...(record(event.data) ?? {}),
    ...(record(event.properties) ?? {}),
  };

  switch (type) {
    case "session.status": {
      const status =
        typeof properties.status === "object" && properties.status !== null
          ? (properties.status as Record<string, unknown>)
          : {};
      const sessionId = str(properties.sessionID);
      if (status.type === "busy") {
        return [make("session_active", sessionId, now, { status: "busy" })];
      }
      if (status.type === "idle") {
        return [make("session_idle", sessionId, now, { status: "idle" })];
      }
      if (status.type === "retry") {
        const attempt = typeof status.attempt === "number" ? status.attempt : undefined;
        return [
          make("session_error", sessionId, now, {
            status: "retry",
            detail:
              attempt !== undefined
                ? `provider retry ${attempt}${str(status.message) ? `: ${str(status.message)}` : ""}`
                : undefined,
          }),
        ];
      }
      return [];
    }
    case "session.idle":
      return [make("session_idle", str(properties.sessionID), now, { status: "idle" })];
    case "session.error": {
      return [
        make("session_error", str(properties.sessionID), now, {
          status: "error",
          detail: errorMessage(properties.error),
        }),
      ];
    }
    case "session.created": {
      const info = record(properties.info);
      const location = record(properties.location);
      return [
        make("session_active", str(properties.sessionID) ?? str(info?.id), now, {
          status: "created",
          directory: str(location?.directory) ?? str(info?.directory),
          project: str(properties.projectID) ?? str(info?.projectID),
        }),
      ];
    }
    case "session.deleted": {
      const info = record(properties.info);
      return [
        make("session_idle", str(properties.sessionID) ?? str(info?.id), now, {
          status: "deleted",
        }),
      ];
    }
    case "session.compacted":
      return [make("session_active", str(properties.sessionID), now, { status: "compacting" })];
    // Newer OpenCode versions report execution outcomes separately from idle.
    // When these are absent, KAGE falls back to session.idle and never invents
    // a completion.
    case "session.execution.started":
      return [make("session_active", str(properties.sessionID), now, { status: "started" })];
    case "session.execution.succeeded":
      return [
        make("session_completed", str(properties.sessionID), now, { status: "succeeded" }),
      ];
    case "session.execution.failed":
      return [
        make("session_error", str(properties.sessionID), now, {
          status: "failed",
          detail: errorMessage(properties.error),
        }),
      ];
    case "session.execution.interrupted":
      return [
        make("session_idle", str(properties.sessionID), now, {
          status: "interrupted",
          detail: str(properties.reason),
        }),
      ];
    case "permission.updated":
    case "permission.asked": {
      const metadata = record(properties.metadata);
      return [
        make("permission_requested", str(properties.sessionID), now, {
          status: "pending",
          detail: str(properties.title) ?? str(properties.message) ?? str(properties.action),
          toolName: str(metadata?.tool) ?? str(properties.type) ?? str(properties.tool),
        }),
      ];
    }
    case "permission.replied":
      return [
        make("permission_resolved", str(properties.sessionID), now, { status: "resolved" }),
      ];
    case "file.edited":
    case "filesystem.changed": {
      // V2 reports unlink as a filesystem change; removing a file is not an edit.
      if (type === "filesystem.changed" && properties.event === "unlink") return [];
      const file = str(properties.file);
      return [make("file_edited", undefined, now, { detail: file ? basename(file) : undefined })];
    }
    default:
      return [];
  }
}

function make(
  type: KAGEEvent["type"],
  sessionId: string | undefined,
  now: number,
  metadata: KAGEEventMetadata,
): KAGEEvent {
  const event: KAGEEvent = { type, timestamp: now };
  if (sessionId) event.sessionId = sessionId;
  const cleaned: KAGEEventMetadata = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (typeof value === "string" && value) {
      cleaned[key as keyof KAGEEventMetadata] = value;
    }
  }
  if (Object.keys(cleaned).length > 0) event.metadata = cleaned;
  return event;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function str(value: unknown): string | undefined {
  return sanitizeText(value);
}

function errorMessage(value: unknown): string | undefined {
  const error = record(value);
  if (!error) return undefined;
  const data = record(error.data);
  return str(data?.message) ?? str(error.message) ?? str(error.name);
}

function basename(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}
