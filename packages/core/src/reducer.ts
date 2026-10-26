import type {
  CharacterState,
  ConnectionState,
  KAGEEvent,
  KAGEState,
  SessionRuntime,
  TransientState,
} from "./types.js";

export interface KAGETimings {
  /** Wake-up animation length after a rest. */
  wakingMs: number;
  /** Celebration length after a completed session. */
  celebrationMs: number;
  /** Inactivity before KAGE dozes off. */
  sleepAfterMs: number;
  /** Sessions unseen for this long are forgotten. */
  staleSessionMs: number;
  /** Brief pixel burst after a file edit. */
  toolPulseMs: number;
  /** Minimum gap between two celebrations. */
  celebrationCooldownMs: number;
  /** Minimum visible time for a state before lower-priority states replace it. */
  stateHoldMs: number;
  /** Events older than this relative to a session's status are ignored. */
  staleEventMs: number;
}

export const DEFAULT_TIMINGS: KAGETimings = {
  wakingMs: 900,
  celebrationMs: 2400,
  sleepAfterMs: 5 * 60_000,
  staleSessionMs: 30 * 60_000,
  toolPulseMs: 900,
  celebrationCooldownMs: 6_000,
  stateHoldMs: 200,
  staleEventMs: 30_000,
};

const PRIORITY: Record<CharacterState, number> = {
  sleeping: 0,
  idle: 1,
  working: 2,
  tool_activity: 2,
  searching: 2,
  waking: 3,
  celebrating: 4,
  error: 5,
  attention: 6,
  disconnected: 7,
};

const WAKE_FROM = new Set<CharacterState>(["sleeping", "idle"]);
const UNKNOWN_SESSION = "unscoped";
const MAX_SEEN_KEYS = 64;

export function isWorkState(state: CharacterState): boolean {
  return state === "working" || state === "tool_activity" || state === "searching";
}

const WEB_SEARCH_PROVIDERS = new Set([
  "exa",
  "tavily",
  "brave",
  "perplexity",
  "serper",
  "searxng",
  "duckduckgo",
]);

/**
 * Recognizes the common names OpenCode and its MCP tools use for web access.
 * Tool arguments are never inspected, and an unknown name stays generic work.
 */
export function isWebSearchTool(name?: string): boolean {
  if (!name) return false;
  const tokens = name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token) continue;
    if (token === "websearch" || token === "webfetch") return true;
    const next = tokens[index + 1];
    if (token === "web" && (next === "search" || next === "fetch")) return true;
    if (token === "search" && next === "web") return true;
    const previous = tokens[index - 1];
    if (token === "search" && previous && WEB_SEARCH_PROVIDERS.has(previous)) return true;
  }
  return false;
}

export function createInitialState(now = Date.now()): KAGEState {
  return {
    connection: "connecting",
    sessions: {},
    primarySessionId: null,
    character: "sleeping",
    characterSince: now,
    transient: null,
    lastEvent: null,
    lastError: null,
    lastActivityAt: now,
    seen: {},
  };
}

function ensureSession(state: KAGEState, id: string, at: number): SessionRuntime {
  const existing = state.sessions[id];
  if (existing) return existing;
  const created: SessionRuntime = {
    id,
    status: "idle",
    activeTools: 0,
    activeSearches: 0,
    pendingPermissions: 0,
    lastActiveAt: at,
    lastStatusAt: at,
  };
  state.sessions[id] = created;
  return created;
}

function selectPrimary(sessions: Record<string, SessionRuntime>): string | null {
  let best: SessionRuntime | null = null;
  for (const session of Object.values(sessions)) {
    if (!best) {
      best = session;
      continue;
    }
    const bestPending = best.pendingPermissions > 0 ? 1 : 0;
    const candidatePending = session.pendingPermissions > 0 ? 1 : 0;
    if (candidatePending !== bestPending) {
      if (candidatePending > bestPending) best = session;
      continue;
    }
    if (session.lastActiveAt !== best.lastActiveAt) {
      if (session.lastActiveAt > best.lastActiveAt) best = session;
      continue;
    }
    if (session.id < best.id) best = session;
  }
  return best?.id ?? null;
}

function pruneSessions(
  sessions: Record<string, SessionRuntime>,
  now: number,
  timings: KAGETimings,
): Record<string, SessionRuntime> {
  const kept: Record<string, SessionRuntime> = {};
  for (const [id, session] of Object.entries(sessions)) {
    const expired = now - session.lastStatusAt > timings.staleSessionMs;
    if (!expired || session.pendingPermissions > 0) kept[id] = session;
  }
  return kept;
}

function expireTransient(transient: TransientState | null, now: number): TransientState | null {
  if (!transient) return null;
  return now >= transient.until ? null : transient;
}

function deriveCharacter(state: KAGEState, now: number, timings: KAGETimings): CharacterState {
  if (state.connection === "disconnected") return "disconnected";

  const sessionIds = Object.keys(state.sessions);
  if (state.connection === "connecting" && sessionIds.length === 0) return "sleeping";

  const sessions = Object.values(state.sessions);
  if (sessions.some((session) => session.pendingPermissions > 0)) return "attention";

  const transient = state.transient;
  if (transient && transient.kind === "celebrating") return "celebrating";
  if (transient && transient.kind === "waking") return "waking";

  const primary = state.primarySessionId ? state.sessions[state.primarySessionId] : undefined;
  if (primary?.status === "error") return "error";
  if (primary?.status === "active") {
    if (primary.activeSearches > 0) return "searching";
    return primary.activeTools > 0 ? "tool_activity" : "working";
  }

  if (transient && transient.kind === "tool_activity") return "tool_activity";
  if (now - state.lastActivityAt > timings.sleepAfterMs) return "sleeping";
  return "idle";
}

function settleCharacter(
  previous: KAGEState,
  draft: KAGEState,
  now: number,
  timings: KAGETimings,
): CharacterState {
  let candidate = deriveCharacter(draft, now, timings);

  if (
    isWorkState(candidate) &&
    WAKE_FROM.has(previous.character) &&
    draft.connection === "connected"
  ) {
    draft.transient = { kind: "waking", until: now + timings.wakingMs };
    candidate = "waking";
  }

  const held =
    candidate !== previous.character &&
    now - previous.characterSince < timings.stateHoldMs &&
    PRIORITY[candidate] <= PRIORITY[previous.character];
  return held ? previous.character : candidate;
}

/**
 * Advances decay-driven state: stale sessions, expired reactions, sleep.
 * Call at a modest interval (a few times per second) while the app runs.
 */
export function tick(
  state: KAGEState,
  now = Date.now(),
  timings: KAGETimings = DEFAULT_TIMINGS,
): KAGEState {
  const sessions = pruneSessions(state.sessions, now, timings);
  const transient = expireTransient(state.transient, now);
  const draft: KAGEState = { ...state, sessions, transient };
  draft.primarySessionId = selectPrimary(sessions);

  const character = settleCharacter(state, draft, now, timings);
  draft.character = character;
  draft.characterSince = character === state.character ? state.characterSince : now;
  return draft;
}

export function setConnection(
  state: KAGEState,
  connection: ConnectionState,
  now = Date.now(),
  timings: KAGETimings = DEFAULT_TIMINGS,
): KAGEState {
  if (connection === "disconnected") {
    return {
      ...state,
      connection,
      transient: null,
      character: "disconnected",
      characterSince: state.character === "disconnected" ? state.characterSince : now,
    };
  }
  return tick({ ...state, connection }, now, timings);
}

function pruneSeen(state: KAGEState, now: number): void {
  const keys = Object.keys(state.seen);
  for (const key of keys) {
    const at = state.seen[key];
    if (at === undefined || now - at > 10_000) delete state.seen[key];
  }
  const remaining = Object.keys(state.seen);
  if (remaining.length > MAX_SEEN_KEYS) {
    remaining
      .sort((a, b) => (state.seen[a] ?? 0) - (state.seen[b] ?? 0))
      .slice(0, remaining.length - MAX_SEEN_KEYS)
      .forEach((key) => delete state.seen[key]);
  }
}

function resolveSessionId(event: KAGEEvent, state: KAGEState): string | null {
  if (event.sessionId) return event.sessionId;
  if (event.type === "file_edited") return null;
  return state.primarySessionId ?? UNKNOWN_SESSION;
}

/**
 * Applies one normalized event. Pure: never mutates the input state.
 */
export function applyEvent(
  state: KAGEState,
  event: KAGEEvent,
  now = Date.now(),
  timings: KAGETimings = DEFAULT_TIMINGS,
): KAGEState {
  const duplicateKey = [
    event.type,
    event.sessionId ?? "",
    event.metadata?.toolName ?? "",
    event.timestamp,
  ].join("|");
  if (state.seen[duplicateKey] !== undefined) return state;

  const draft: KAGEState = { ...state, sessions: { ...state.sessions }, seen: { ...state.seen } };
  pruneSeen(draft, now);
  draft.seen[duplicateKey] = now;

  const sessionId = resolveSessionId(event, draft);
  let session: SessionRuntime | null = null;
  if (sessionId) {
    session = ensureSession(draft, sessionId, event.timestamp);
    if (event.timestamp + timings.staleEventMs < session.lastStatusAt) return state;
  }

  const at = event.timestamp;
  const detail = event.metadata?.detail;
  const toolName = event.metadata?.toolName;

  switch (event.type) {
    case "session_active": {
      if (!session) break;
      session.status = "active";
      session.lastStatusAt = Math.max(session.lastStatusAt, at);
      session.lastActiveAt = Math.max(session.lastActiveAt, at);
      if (event.metadata?.directory) session.directory = event.metadata.directory;
      if (event.metadata?.project) session.project = event.metadata.project;
      if (draft.transient?.kind === "celebrating") draft.transient = null;
      break;
    }
    case "session_idle": {
      if (!session) break;
      session.status = "idle";
      session.activeTools = 0;
      session.activeSearches = 0;
      session.pendingPermissions = 0;
      session.lastStatusAt = Math.max(session.lastStatusAt, at);
      if (draft.transient?.kind === "tool_activity") draft.transient = null;
      break;
    }
    case "session_completed": {
      if (!session) break;
      session.status = "completed";
      session.activeTools = 0;
      session.activeSearches = 0;
      session.pendingPermissions = 0;
      session.lastStatusAt = Math.max(session.lastStatusAt, at);
      const cooledDown =
        session.lastCelebratedAt === undefined ||
        at - session.lastCelebratedAt >= timings.celebrationCooldownMs;
      if (cooledDown) {
        session.lastCelebratedAt = at;
        draft.transient = {
          kind: "celebrating",
          until: now + timings.celebrationMs,
          sessionId: session.id,
        };
      }
      break;
    }
    case "session_error": {
      if (!session) break;
      session.status = "error";
      session.activeTools = 0;
      session.activeSearches = 0;
      session.lastStatusAt = Math.max(session.lastStatusAt, at);
      draft.lastError = { at, sessionId: session.id, message: detail ?? event.metadata?.status };
      draft.transient = null;
      break;
    }
    case "tool_started": {
      if (!session) break;
      session.status = "active";
      session.activeTools = Math.min(99, session.activeTools + 1);
      if (isWebSearchTool(toolName)) {
        session.activeSearches = Math.min(99, session.activeSearches + 1);
      }
      session.lastTool = toolName;
      session.lastActiveAt = Math.max(session.lastActiveAt, at);
      session.lastStatusAt = Math.max(session.lastStatusAt, at);
      if (draft.transient?.kind === "celebrating") draft.transient = null;
      break;
    }
    case "tool_finished": {
      if (!session) break;
      session.activeTools = Math.max(0, session.activeTools - 1);
      if (isWebSearchTool(toolName)) {
        session.activeSearches = Math.max(0, session.activeSearches - 1);
      }
      // A missing or unmatched finish frame must not leave a search stuck.
      if (session.activeTools === 0) session.activeSearches = 0;
      if (toolName) session.lastTool = toolName;
      session.lastActiveAt = Math.max(session.lastActiveAt, at);
      session.lastStatusAt = Math.max(session.lastStatusAt, at);
      break;
    }
    case "permission_requested": {
      if (!session) break;
      session.pendingPermissions = Math.min(99, session.pendingPermissions + 1);
      session.lastActiveAt = Math.max(session.lastActiveAt, at);
      session.lastStatusAt = Math.max(session.lastStatusAt, at);
      if (draft.transient?.kind === "celebrating") draft.transient = null;
      break;
    }
    case "permission_resolved": {
      if (!session) break;
      session.pendingPermissions = Math.max(0, session.pendingPermissions - 1);
      session.lastStatusAt = Math.max(session.lastStatusAt, at);
      break;
    }
    case "file_edited": {
      if (!(draft.transient?.kind === "tool_activity" && draft.transient.until > now)) {
        draft.transient = { kind: "tool_activity", until: now + timings.toolPulseMs };
      }
      break;
    }
  }

  draft.lastEvent = { type: event.type, at, sessionId: session?.id, toolName, detail };
  draft.lastActivityAt = Math.max(draft.lastActivityAt, at);
  return tick(draft, now, timings);
}
