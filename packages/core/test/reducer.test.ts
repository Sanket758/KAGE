import { describe, expect, it } from "vitest";
import {
  applyEvent,
  createInitialState,
  DEFAULT_TIMINGS,
  isWebSearchTool,
  setConnection,
  tick,
  type KAGEEvent,
  type KAGEEventType,
  type KAGEState,
} from "../src/index.js";

const BASE = 1_700_000_000_000;

function connectedState(): KAGEState {
  return setConnection(createInitialState(BASE), "connected", BASE);
}

function event(
  type: KAGEEventType,
  at: number,
  sessionId = "ses_1",
  metadata?: KAGEEvent["metadata"],
): KAGEEvent {
  const value: KAGEEvent = { type, timestamp: at };
  if (sessionId) value.sessionId = sessionId;
  if (metadata) value.metadata = metadata;
  return value;
}

function advance(state: KAGEState, ms: number): KAGEState {
  return tick(state, BASE + ms);
}

function activate(state: KAGEState, sessionId = "ses_1", at = BASE + 100): KAGEState {
  const next = applyEvent(state, event("session_active", at, sessionId), at);
  return tick(next, at + DEFAULT_TIMINGS.wakingMs);
}

describe("session lifecycle", () => {
  it("wakes when work begins, then settles into working", () => {
    const idle = advance(connectedState(), 1);
    expect(idle.character).toBe("idle");

    const waking = applyEvent(idle, event("session_active", BASE + 100), BASE + 100);
    expect(waking.character).toBe("waking");

    const working = tick(waking, BASE + 100 + DEFAULT_TIMINGS.wakingMs);
    expect(working.character).toBe("working");
  });

  it("shows tool activity while a tool runs and returns to working after", () => {
    const working = activate(connectedState());
    expect(working.character).toBe("working");

    const running = applyEvent(
      working,
      event("tool_started", BASE + 1200, "ses_1", { toolName: "edit" }),
      BASE + 1200,
    );
    expect(running.character).toBe("tool_activity");
    expect(running.sessions["ses_1"]?.activeTools).toBe(1);

    const done = applyEvent(
      running,
      event("tool_finished", BASE + 1400, "ses_1", { toolName: "edit" }),
      BASE + 1400,
    );
    expect(done.character).toBe("working");
    expect(done.sessions["ses_1"]?.activeTools).toBe(0);
  });

  it("shows a distinct searching state for web tools", () => {
    const working = activate(connectedState());
    const searching = applyEvent(
      working,
      event("tool_started", BASE + 1200, "ses_1", { toolName: "websearch" }),
      BASE + 1200,
    );
    expect(searching.character).toBe("searching");
    expect(searching.sessions["ses_1"]?.activeSearches).toBe(1);

    const done = applyEvent(
      searching,
      event("tool_finished", BASE + 1400, "ses_1", { toolName: "websearch" }),
      BASE + 1400,
    );
    expect(done.character).toBe("working");
    expect(done.sessions["ses_1"]?.activeSearches).toBe(0);
  });

  it("keeps ordinary tools in the generic tool state", () => {
    const working = activate(connectedState());
    const running = applyEvent(
      working,
      event("tool_started", BASE + 1200, "ses_1", { toolName: "grep" }),
      BASE + 1200,
    );
    expect(running.character).toBe("tool_activity");
    expect(running.sessions["ses_1"]?.activeSearches).toBe(0);
  });

  it("recognizes common web tool names without guessing at arguments", () => {
    for (const name of [
      "websearch",
      "web_search",
      "web-fetch",
      "webfetch",
      "search_web",
      "exa_search",
      "mcp__exa__search",
      "brave_web_search",
    ]) {
      expect(isWebSearchTool(name), name).toBe(true);
    }
    for (const name of [undefined, "", "grep", "code_search", "edit"]) {
      expect(isWebSearchTool(name), String(name)).toBe(false);
    }
  });

  it("clears a search when all tools are finished", () => {
    const running = applyEvent(
      activate(connectedState()),
      event("tool_started", BASE + 1200, "ses_1", { toolName: "websearch" }),
      BASE + 1200,
    );
    const missingName = applyEvent(
      running,
      event("tool_finished", BASE + 1400, "ses_1"),
      BASE + 1400,
    );
    expect(missingName.sessions["ses_1"]?.activeTools).toBe(0);
    expect(missingName.sessions["ses_1"]?.activeSearches).toBe(0);
  });

  it("treats idle as idle, not as completion", () => {
    const state = activate(connectedState());
    const idle = applyEvent(state, event("session_idle", BASE + 2000), BASE + 2000);
    expect(idle.character).toBe("idle");
    expect(idle.transient).toBeNull();
    expect(idle.sessions["ses_1"]?.status).toBe("idle");
  });

  it("celebrates a completed session once and then rests", () => {
    const state = activate(connectedState());
    const done = applyEvent(state, event("session_completed", BASE + 2000), BASE + 2000);
    expect(done.character).toBe("celebrating");

    const later = tick(done, BASE + 2000 + DEFAULT_TIMINGS.celebrationMs + 10);
    expect(later.character).toBe("idle");

    const again = applyEvent(
      later,
      event("session_completed", BASE + 2600),
      BASE + 2600,
    );
    expect(again.character).not.toBe("celebrating");
  });

  it("promotes a newly active session to primary without disturbing others", () => {
    let state = activate(connectedState(), "ses_a", BASE + 100);
    state = applyEvent(state, event("session_active", BASE + 300, "ses_b"), BASE + 300);
    expect(state.primarySessionId).toBe("ses_b");

    state = applyEvent(state, event("session_idle", BASE + 400, "ses_a"), BASE + 400);
    expect(state.primarySessionId).toBe("ses_b");
    expect(state.sessions["ses_b"]?.status).toBe("active");
  });

  it("does not let an idle session mark another session idle", () => {
    let state = activate(connectedState(), "ses_a", BASE + 100);
    state = applyEvent(state, event("session_active", BASE + 1200, "ses_b"), BASE + 1200);
    state = applyEvent(state, event("tool_started", BASE + 1300, "ses_b", { toolName: "read" }), BASE + 1300);
    state = applyEvent(state, event("session_idle", BASE + 1400, "ses_a"), BASE + 1400);

    expect(state.sessions["ses_b"]?.status).toBe("active");
    expect(state.sessions["ses_b"]?.activeTools).toBe(1);
    expect(state.character).toBe("tool_activity");
  });

  it("forgets stale sessions", () => {
    const state = activate(connectedState());
    const forgotten = tick(state, BASE + DEFAULT_TIMINGS.staleSessionMs + 2000);
    expect(forgotten.sessions["ses_1"]).toBeUndefined();
  });
});

describe("priority and recovery", () => {
  it("permission requests override work and survive until resolved", () => {
    const running = applyEvent(
      activate(connectedState()),
      event("tool_started", BASE + 1200, "ses_1", { toolName: "shell" }),
      BASE + 1200,
    );

    const attention = applyEvent(
      running,
      event("permission_requested", BASE + 1300),
      BASE + 1300,
    );
    expect(attention.character).toBe("attention");

    const stillWaiting = tick(attention, BASE + 1200 + 60_000);
    expect(stillWaiting.character).toBe("attention");

    const resolved = applyEvent(
      stillWaiting,
      event("permission_resolved", BASE + 61_500),
      BASE + 61_500,
    );
    expect(resolved.character).toBe("tool_activity");
  });

  it("shows error priority and recovers on new activity", () => {
    const working = activate(connectedState());
    const failed = applyEvent(
      working,
      event("session_error", BASE + 1000, "ses_1", { detail: "rate limited" }),
      BASE + 1000,
    );
    expect(failed.character).toBe("error");
    expect(failed.lastError?.message).toBe("rate limited");

    const recovered = applyEvent(
      failed,
      event("session_active", BASE + 3000),
      BASE + 3000,
    );
    expect(recovered.character).toBe("working");
    expect(recovered.lastError?.message).toBe("rate limited");
  });

  it("keeps error visible until activity resumes", () => {
    const working = activate(connectedState());
    const failed = applyEvent(working, event("session_error", BASE + 1000), BASE + 1000);
    const muchLater = tick(failed, BASE + 20 * 60_000);
    expect(muchLater.character).toBe("error");
  });
});

describe("robustness", () => {
  it("ignores exact duplicate events", () => {
    const working = activate(connectedState());
    const start = event("tool_started", BASE + 1200, "ses_1", { toolName: "edit" });
    const once = applyEvent(working, start, BASE + 1200);
    const twice = applyEvent(once, start, BASE + 1250);
    expect(twice.sessions["ses_1"]?.activeTools).toBe(1);
    expect(twice).toBe(once);
  });

  it("ignores ancient replayed events but tolerates brief reordering", () => {
    const running = applyEvent(
      activate(connectedState()),
      event("tool_started", BASE + 40_000, "ses_1", { toolName: "edit" }),
      BASE + 40_000,
    );
    const replay = applyEvent(
      running,
      event("tool_finished", BASE + 1000, "ses_1"),
      BASE + 40_000,
    );
    expect(replay).toBe(running);
  });

  it("never lets tool counters go negative", () => {
    const working = activate(connectedState());
    const state = applyEvent(working, event("tool_finished", BASE + 1200), BASE + 1200);
    expect(state.sessions["ses_1"]?.activeTools).toBe(0);
  });

  it("does not extend a file-edit pulse on every edit", () => {
    const working = activate(connectedState());
    const first = applyEvent(working, event("file_edited", BASE + 1200, ""), BASE + 1200);
    expect(first.transient?.kind).toBe("tool_activity");
    const firstUntil = first.transient?.until;
    const second = applyEvent(
      first,
      event("file_edited", BASE + 1300, ""),
      BASE + 1300,
    );
    expect(second.transient?.until).toBe(firstUntil);
  });

  it("reports disconnected and restores the previous state after reconnect", () => {
    const working = activate(connectedState());
    const lost = setConnection(working, "disconnected", BASE + 2000);
    expect(lost.character).toBe("disconnected");
    expect(lost.sessions["ses_1"]?.status).toBe("active");

    const back = setConnection(lost, "connected", BASE + 4000);
    expect(back.character).toBe("working");
  });

  it("only dozes after a session is genuinely idle", () => {
    const working = activate(connectedState());
    const idleAt = BASE + 2000;
    const idle = applyEvent(working, event("session_idle", idleAt), idleAt);
    expect(idle.character).toBe("idle");

    const sleeping = tick(idle, idleAt + DEFAULT_TIMINGS.sleepAfterMs + 10_000);
    expect(sleeping.character).toBe("sleeping");

    const waking = applyEvent(
      sleeping,
      event("tool_started", idleAt + DEFAULT_TIMINGS.sleepAfterMs + 11_000, "ses_1", {
        toolName: "read",
      }),
      idleAt + DEFAULT_TIMINGS.sleepAfterMs + 11_000,
    );
    expect(waking.character).toBe("waking");
  });

  it("holds short flashes so working states do not flicker", () => {
    const working = activate(connectedState());
    const started = applyEvent(
      working,
      event("tool_started", BASE + 1200, "ses_1", { toolName: "edit" }),
      BASE + 1200,
    );
    expect(started.character).toBe("tool_activity");
    const finished = applyEvent(
      started,
      event("tool_finished", BASE + 1250, "ses_1", { toolName: "edit" }),
      BASE + 1250,
    );
    expect(finished.character).toBe("tool_activity");
    const settled = tick(finished, BASE + 1400);
    expect(settled.character).toBe("working");
  });
});
