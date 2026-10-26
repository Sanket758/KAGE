/**
 * KAGE internal event contract.
 *
 * These types are owned by KAGE, not by OpenCode. The OpenCode plugin
 * normalizes provider events into this shape so that the state machine,
 * the bridge and the desktop UI never depend on OpenCode payload details.
 */

export const KAGE_EVENT_TYPES = [
  "session_active",
  "session_idle",
  "session_error",
  "session_completed",
  "tool_started",
  "tool_finished",
  "permission_requested",
  "permission_resolved",
  "file_edited",
] as const;

export type KAGEEventType = (typeof KAGE_EVENT_TYPES)[number];

export const CHARACTER_STATES = [
  "sleeping",
  "idle",
  "waking",
  "working",
  "tool_activity",
  "searching",
  "attention",
  "error",
  "celebrating",
  "disconnected",
] as const;

export type CharacterState = (typeof CHARACTER_STATES)[number];

export type ConnectionState = "connecting" | "connected" | "disconnected";

export type SessionStatus = "active" | "idle" | "error" | "completed";

export interface KAGEEventMetadata {
  toolName?: string;
  status?: string;
  detail?: string;
  directory?: string;
  project?: string;
}

/**
 * Normalized event. `timestamp` is the producer clock (epoch milliseconds).
 */
export interface KAGEEvent {
  type: KAGEEventType;
  sessionId?: string;
  timestamp: number;
  metadata?: KAGEEventMetadata;
}

export interface SessionRuntime {
  id: string;
  status: SessionStatus;
  directory?: string;
  project?: string;
  activeTools: number;
  /** Active tools that are doing web search or web access. */
  activeSearches: number;
  pendingPermissions: number;
  lastTool?: string;
  /** Last event that represented real agent work. */
  lastActiveAt: number;
  /** Last event of any kind, including idle/error status. */
  lastStatusAt: number;
  lastCelebratedAt?: number;
}

export interface LastEvent {
  type: KAGEEventType;
  at: number;
  sessionId?: string;
  toolName?: string;
  detail?: string;
}

export interface ErrorInfo {
  at: number;
  sessionId?: string;
  message?: string;
}

export type TransientKind = "waking" | "celebrating" | "tool_activity";

export interface TransientState {
  kind: TransientKind;
  until: number;
  sessionId?: string;
}

export interface KAGEState {
  connection: ConnectionState;
  sessions: Record<string, SessionRuntime>;
  primarySessionId: string | null;
  character: CharacterState;
  characterSince: number;
  transient: TransientState | null;
  lastEvent: LastEvent | null;
  lastError: ErrorInfo | null;
  lastActivityAt: number;
  seen: Record<string, number>;
}
