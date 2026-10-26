import { describe, expect, it } from "vitest";
import { normalizeOpencodeEvent } from "../src/index.js";

const NOW = 1_700_000_000_000;

describe("OpenCode event normalization", () => {
  it("maps session status events", () => {
    expect(
      normalizeOpencodeEvent(
        { type: "session.status", properties: { sessionID: "ses_1", status: { type: "busy" } } },
        NOW,
      ),
    ).toEqual([
      { type: "session_active", sessionId: "ses_1", timestamp: NOW, metadata: { status: "busy" } },
    ]);

    expect(
      normalizeOpencodeEvent(
        { type: "session.status", properties: { sessionID: "ses_1", status: { type: "idle" } } },
        NOW,
      )[0]?.type,
    ).toBe("session_idle");
  });

  it("maps retries to a warning rather than success", () => {
    const [event] = normalizeOpencodeEvent(
      {
        type: "session.status",
        properties: {
          sessionID: "ses_1",
          status: { type: "retry", attempt: 2, message: "overloaded" },
        },
      },
      NOW,
    );
    expect(event?.type).toBe("session_error");
    expect(event?.metadata?.detail).toContain("provider retry 2");
  });

  it("extracts nested provider error messages", () => {
    const [event] = normalizeOpencodeEvent(
      {
        type: "session.error",
        properties: { sessionID: "ses_1", error: { name: "ApiError", data: { message: "nope" } } },
      },
      NOW,
    );
    expect(event?.type).toBe("session_error");
    expect(event?.metadata?.detail).toBe("nope");
  });

  it("maps newer execution outcome events when the runtime provides them", () => {
    expect(
      normalizeOpencodeEvent(
        { type: "session.execution.succeeded", properties: { sessionID: "s" } },
        NOW,
      )[0]?.type,
    ).toBe("session_completed");

    const failed = normalizeOpencodeEvent(
      {
        type: "session.execution.failed",
        properties: { sessionID: "s", error: { message: "boom" } },
      },
      NOW,
    );
    expect(failed[0]?.type).toBe("session_error");
    expect(failed[0]?.metadata?.detail).toBe("boom");

    expect(
      normalizeOpencodeEvent(
        { type: "session.execution.interrupted", properties: { sessionID: "s" } },
        NOW,
      )[0]?.type,
    ).toBe("session_idle");
  });

  it("maps permission events from both documented and SDK shapes", () => {
    const asked = normalizeOpencodeEvent(
      { type: "permission.asked", properties: { sessionID: "s", title: "Run shell" } },
      NOW,
    );
    expect(asked[0]?.type).toBe("permission_requested");
    expect(asked[0]?.metadata?.detail).toBe("Run shell");

    const updated = normalizeOpencodeEvent(
      {
        type: "permission.updated",
        properties: { sessionID: "s", title: "Write file", metadata: { tool: "write" } },
      },
      NOW,
    );
    expect(updated[0]?.metadata?.toolName).toBe("write");

    const replied = normalizeOpencodeEvent(
      { type: "permission.replied", properties: { sessionID: "s", response: "once" } },
      NOW,
    );
    expect(replied[0]?.type).toBe("permission_resolved");
  });

  it("records only the file name of an edited file", () => {
    const [event] = normalizeOpencodeEvent(
      { type: "file.edited", properties: { file: "/home/me/secret-project/src/app.ts" } },
      NOW,
    );
    expect(event?.type).toBe("file_edited");
    expect(event?.metadata?.detail).toBe("app.ts");
    expect(JSON.stringify(event)).not.toContain("secret-project");
  });

  it("carries session directory on creation", () => {
    const [event] = normalizeOpencodeEvent(
      {
        type: "session.created",
        properties: { info: { id: "ses_1", directory: "/home/me/work", projectID: "prj_1" } },
      },
      NOW,
    );
    expect(event).toMatchObject({
      type: "session_active",
      sessionId: "ses_1",
      metadata: { directory: "/home/me/work", project: "prj_1" },
    });
  });

  it("maps OpenCode V2 data envelopes", () => {
    expect(
      normalizeOpencodeEvent(
        { type: "session.status", data: { sessionID: "ses_2", status: { type: "busy" } } },
        NOW,
      ),
    ).toEqual([
      { type: "session_active", sessionId: "ses_2", timestamp: NOW, metadata: { status: "busy" } },
    ]);

    expect(
      normalizeOpencodeEvent(
        { type: "session.idle", data: { sessionID: "ses_2" } },
        NOW,
      )[0]?.type,
    ).toBe("session_idle");

    expect(
      normalizeOpencodeEvent(
        { type: "session.execution.succeeded", data: { sessionID: "ses_2" } },
        NOW,
      )[0]?.type,
    ).toBe("session_completed");

    const failed = normalizeOpencodeEvent(
      {
        type: "session.execution.failed",
        data: { sessionID: "ses_2", error: { message: "boom" } },
      },
      NOW,
    );
    expect(failed[0]?.type).toBe("session_error");
    expect(failed[0]?.metadata?.detail).toBe("boom");
  });

  it("maps V2 session creation and deletion payloads", () => {
    const [created] = normalizeOpencodeEvent(
      {
        type: "session.created",
        data: {
          sessionID: "ses_1",
          projectID: "prj_1",
          location: { directory: "/home/me/work" },
        },
      },
      NOW,
    );
    expect(created).toMatchObject({
      type: "session_active",
      sessionId: "ses_1",
      metadata: { directory: "/home/me/work", project: "prj_1" },
    });

    expect(
      normalizeOpencodeEvent(
        { type: "session.deleted", data: { sessionID: "ses_1" } },
        NOW,
      )[0]?.type,
    ).toBe("session_idle");
  });

  it("maps V2 permission and file payloads", () => {
    const [asked] = normalizeOpencodeEvent(
      {
        type: "permission.asked",
        data: {
          sessionID: "s",
          action: "read",
          message: "Allow reading this file?",
          metadata: { tool: "read" },
        },
      },
      NOW,
    );
    expect(asked?.type).toBe("permission_requested");
    expect(asked?.metadata?.detail).toBe("Allow reading this file?");
    expect(asked?.metadata?.toolName).toBe("read");

    const [edited] = normalizeOpencodeEvent(
      { type: "file.edited", data: { file: "/home/me/secret-project/src/app.ts" } },
      NOW,
    );
    expect(edited?.type).toBe("file_edited");
    expect(edited?.metadata?.detail).toBe("app.ts");
    expect(JSON.stringify(edited)).not.toContain("secret-project");

    expect(
      normalizeOpencodeEvent(
        {
          type: "filesystem.changed",
          data: { file: "/home/me/secret-project/src/app.ts", event: "change" },
        },
        NOW,
      )[0]?.type,
    ).toBe("file_edited");

    expect(
      normalizeOpencodeEvent(
        {
          type: "filesystem.changed",
          data: { file: "/home/me/secret-project/src/app.ts", event: "unlink" },
        },
        NOW,
      ),
    ).toEqual([]);
  });

  it("ignores unknown or malformed events", () => {
    expect(normalizeOpencodeEvent({ type: "message.updated", properties: {} }, NOW)).toEqual([]);
    expect(normalizeOpencodeEvent(null, NOW)).toEqual([]);
    expect(normalizeOpencodeEvent({ type: "session.status" }, NOW)).toEqual([]);
  });
});
