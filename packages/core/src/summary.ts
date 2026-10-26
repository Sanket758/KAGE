import type { CharacterState, KAGEEventType, KAGEState, SessionRuntime } from "./types.js";

export interface KAGESummary {
  connection: KAGEState["connection"];
  connectionLabel: string;
  character: CharacterState;
  statusLabel: string;
  directory: string | null;
  project: string | null;
  tool: string | null;
  sessionCount: number;
  busySessionCount: number;
  pendingPermissions: number;
  lastEventLabel: string | null;
  lastEventAt: number | null;
  lastErrorLabel: string | null;
  lastErrorAt: number | null;
}

const EVENT_LABELS: Record<KAGEEventType, string> = {
  session_active: "Session active",
  session_idle: "Session idle",
  session_error: "Session error",
  session_completed: "Session complete",
  tool_started: "Tool started",
  tool_finished: "Tool finished",
  permission_requested: "Permission requested",
  permission_resolved: "Permission resolved",
  file_edited: "File edited",
};

const CONNECTION_LABELS: Record<KAGEState["connection"], string> = {
  connecting: "Waiting for OpenCode",
  connected: "Connected",
  disconnected: "Connection lost",
};

export function summarize(state: KAGEState): KAGESummary {
  const primary = state.primarySessionId ? state.sessions[state.primarySessionId] : undefined;
  const sessions = Object.values(state.sessions).filter((session) => session.id !== "unscoped");
  const pendingPermissions = sessions.reduce(
    (total, session) => total + session.pendingPermissions,
    0,
  );

  const last = state.lastEvent;
  const lastEventLabel = last ? describeEvent(last.type, last.toolName, last.detail) : null;

  return {
    connection: state.connection,
    connectionLabel: CONNECTION_LABELS[state.connection],
    character: state.character,
    statusLabel: statusLabel(state, primary),
    directory: primary?.directory ?? null,
    project: primary?.project ?? null,
    tool: primary?.lastTool ?? last?.toolName ?? null,
    sessionCount: sessions.length,
    busySessionCount: sessions.filter((session) => session.status === "active").length,
    pendingPermissions,
    lastEventLabel,
    lastEventAt: last?.at ?? null,
    lastErrorLabel: state.lastError ? describeError(state.lastError.message) : null,
    lastErrorAt: state.lastError?.at ?? null,
  };
}

function statusLabel(state: KAGEState, primary: SessionRuntime | undefined): string {
  if (state.connection === "disconnected") return "Waiting to reconnect";
  if (state.connection === "connecting") return "Waiting for OpenCode";
  if (!primary) return "No active session";
  switch (primary.status) {
    case "active":
      if (primary.pendingPermissions > 0) return "Waiting for your approval";
      if (primary.activeSearches > 0) return "Searching the web";
      if (primary.activeTools > 0) {
        return primary.lastTool ? `Running ${primary.lastTool}` : "Running a tool";
      }
      return "Working";
    case "error":
      return "Error";
    case "completed":
      return "Task complete";
    default:
      return "Idle";
  }
}

function describeEvent(type: KAGEEventType, toolName?: string, detail?: string): string {
  const label = EVENT_LABELS[type];
  if (type === "tool_started" || type === "tool_finished") {
    return toolName ? `${label}: ${toolName}` : label;
  }
  if (detail) return `${label}: ${detail}`;
  return label;
}

function describeError(message?: string): string {
  return message ? `Error: ${message}` : "Error reported by OpenCode";
}
