import { mkdtempSync, writeFileSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { BridgePaths } from "../src/paths.js";
import { BridgeClient } from "../src/client.js";
import KagePlugin, {
  createKagePlugin,
  type OpencodeToolHookEvent,
} from "../src/index.js";
import type { KAGEEvent } from "@kage/core";

interface Harness {
  paths: BridgePaths;
  frames: Record<string, unknown>[];
  sockets: net.Socket[];
  close: () => Promise<void>;
}

function makePaths(): BridgePaths {
  const runtimeDir = mkdtempSync(join(tmpdir(), "kage-bridge-"));
  writeFileSync(join(runtimeDir, "token"), "unit-fake-token-0123456789\n", { mode: 0o600 });
  return {
    runtimeDir,
    socketPath: join(runtimeDir, "kage.sock"),
    tokenPath: join(runtimeDir, "token"),
  };
}

async function startServer(paths: BridgePaths, token = "unit-fake-token-0123456789"): Promise<Harness> {
  const frames: Record<string, unknown>[] = [];
  const sockets: net.Socket[] = [];
  const server = net.createServer((socket) => {
    sockets.push(socket);
    let buffer = "";
    let authenticated = false;
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");
        if (!line.trim()) continue;
        const rawFrame = JSON.parse(line) as Record<string, unknown>;
        if (!authenticated) {
          const frame = rawFrame;
          if (frame.type !== "hello" || frame.token !== token) {
            socket.write(`${JSON.stringify({ type: "error", reason: "unauthorized" })}\n`);
            socket.destroy();
            return;
          }
          authenticated = true;
          frames.push(frame);
          socket.write(`${JSON.stringify({ type: "welcome", version: 1 })}\n`);
          continue;
        }
        if (rawFrame.type === "event" && typeof rawFrame.event === "object") {
          frames.push(rawFrame.event as Record<string, unknown>);
        } else {
          frames.push(rawFrame);
        }
      }
    });
    socket.on("error", () => {});
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(paths.socketPath, () => resolve());
  });
  return {
    paths,
    frames,
    sockets,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

async function waitFor(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

const event = (type: KAGEEvent["type"], metadata?: KAGEEvent["metadata"]): KAGEEvent => {
  const value: KAGEEvent = { type, sessionId: "ses_1", timestamp: Date.now() };
  if (metadata) value.metadata = metadata;
  return value;
};

const live: BridgeClient[] = [];
const harnesses: Harness[] = [];

afterEach(async () => {
  for (const client of live.splice(0)) client.stop();
  for (const harness of harnesses.splice(0)) await harness.close();
});

describe("BridgeClient", () => {
  it("authenticates with the local token and delivers events", async () => {
    const paths = makePaths();
    const server = await startServer(paths);
    harnesses.push(server);

    const client = new BridgeClient({ paths, directory: "/home/me/project" });
    live.push(client);
    client.start();
    client.send(event("session_active", { status: "busy" }));

    await waitFor(() => server.frames.some((frame) => frame.type === "session_active"));
    const hello = server.frames.find((frame) => frame.type === "hello");
    expect(hello).toMatchObject({ version: 1, token: "unit-fake-token-0123456789" });
    expect(hello?.directory).toBe("/home/me/project");
    expect(client.sentCount).toBeGreaterThan(0);
  });

  it("reconnects once the companion appears", async () => {
    const paths = makePaths();
    const client = new BridgeClient({
      paths,
      backoff: { baseMs: 40, maxMs: 200, jitter: 0 },
    });
    live.push(client);
    client.start();
    client.send(event("session_idle"));
    expect(client.status).toBe("connecting");

    const server = await startServer(paths);
    harnesses.push(server);
    await waitFor(() => server.frames.some((frame) => frame.type === "session_idle"), 5000);
    expect(client.status).toBe("connected");
  });

  it("never blocks or throws when the companion is absent", async () => {
    const paths = makePaths();
    const client = new BridgeClient({ paths });
    live.push(client);
    client.start();
    expect(client.send(event("tool_started", { toolName: "read" }))).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(client.status).toBe("connecting");
  });

  it("keeps its queue bounded", async () => {
    const paths = makePaths();
    const client = new BridgeClient({ paths, maxQueue: 8 });
    live.push(client);
    client.start();
    for (let index = 0; index < 40; index += 1) {
      client.send(event("tool_finished", { toolName: `tool-${index}` }));
    }
    expect(client.queueSize).toBeLessThanOrEqual(8);
    expect(client.droppedCount).toBeGreaterThan(0);
  });

  it("ignores connections without a readable token", async () => {
    const paths = makePaths();
    const client = new BridgeClient({ paths, tokenReader: () => null });
    live.push(client);
    client.start();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(client.status).toBe("connecting");
  });

  it("stops cleanly", async () => {
    const client = new BridgeClient({ paths: makePaths() });
    live.push(client);
    client.start();
    client.stop();
    expect(client.status).toBe("idle");
    expect(client.send(event("session_idle"))).toBe(false);
  });
});

interface EventStream {
  push: (event: unknown) => void;
  iterable: AsyncIterable<unknown>;
}

function makeEventStream(signal?: AbortSignal): EventStream {
  const queue: unknown[] = [];
  let closed = false;
  let wake: (() => void) | null = null;

  const wakeUp = (): void => {
    const resolve = wake;
    wake = null;
    resolve?.();
  };
  const onAbort = (): void => {
    closed = true;
    wakeUp();
  };
  signal?.addEventListener("abort", onAbort, { once: true });

  return {
    push: (event) => {
      if (closed) return;
      queue.push(event);
      wakeUp();
    },
    iterable: {
      async *[Symbol.asyncIterator]() {
        try {
          while (!closed) {
            const next = queue.shift();
            if (next !== undefined) {
              yield next;
              continue;
            }
            await new Promise<void>((resolve) => {
              wake = resolve;
            });
          }
        } finally {
          signal?.removeEventListener("abort", onAbort);
        }
      },
    },
  };
}

interface PluginHarness {
  context: {
    location: { directory: string };
    event: { subscribe: (options?: { signal?: AbortSignal }) => AsyncIterable<unknown> };
    tool: {
      hook: (
        name: string,
        callback: (event: OpencodeToolHookEvent) => void | Promise<void>,
      ) => Promise<{ dispose: () => Promise<void> }>;
    };
  };
  toolHooks: Map<string, (event: OpencodeToolHookEvent) => void | Promise<void>>;
  emit: (event: unknown) => void;
  subscribed: () => boolean;
}

function makePluginHarness(): PluginHarness {
  const streams: EventStream[] = [];
  const toolHooks = new Map<string, (event: OpencodeToolHookEvent) => void | Promise<void>>();

  return {
    context: {
      location: { directory: "/home/me/project" },
      event: {
        subscribe: (options) => {
          const stream = makeEventStream(options?.signal);
          streams.push(stream);
          return stream.iterable;
        },
      },
      tool: {
        hook: async (name, callback) => {
          toolHooks.set(name, callback);
          return {
            dispose: async () => {
              toolHooks.delete(name);
            },
          };
        },
      },
    },
    toolHooks,
    emit: (event) => {
      const stream = streams[streams.length - 1];
      if (!stream) throw new Error("plugin has not subscribed yet");
      stream.push(event);
    },
    subscribed: () => streams.length > 0,
  };
}

describe("KAGE plugin", () => {
  it("exports an OpenCode V2 plugin definition", () => {
    expect(KagePlugin.id).toBe("kage");
    expect(typeof KagePlugin.setup).toBe("function");
  });

  it("subscribes to V2 events, registers tool hooks, and forwards them", async () => {
    const paths = makePaths();
    const server = await startServer(paths);
    harnesses.push(server);
    const harness = makePluginHarness();
    const plugin = createKagePlugin({ bridge: { paths }, logger: () => {} });

    const cleanup = await plugin.setup(harness.context);
    try {
      await waitFor(() => harness.subscribed(), 1000);

      harness.emit({
        type: "session.status",
        data: { sessionID: "ses_abc", status: { type: "busy" } },
      });
      await waitFor(() => server.frames.some((frame) => frame.type === "session_active"));

      await harness.toolHooks.get("execute.before")?.({
        tool: "edit",
        sessionID: "ses_abc",
        id: "call_1",
        input: { args: { secret: "must-not-leak" } },
      });
      await harness.toolHooks.get("execute.after")?.({
        tool: "edit",
        sessionID: "ses_abc",
        id: "call_1",
        status: "completed",
      });
      harness.emit({
        type: "permission.asked",
        data: { sessionID: "ses_abc", message: "Run shell", metadata: { tool: "bash" } },
      });
      harness.emit({
        type: "file.edited",
        data: { file: "/home/me/project/src/app.ts" },
      });

      await waitFor(
        () => server.frames.filter((frame) => frame.type !== "hello").length >= 5,
      );
      const types = server.frames.map((frame) => frame.type);
      expect(types).toContain("session_active");
      expect(types).toContain("tool_started");
      expect(types).toContain("tool_finished");
      expect(types).toContain("permission_requested");
      expect(types).toContain("file_edited");
      const toolStarted = server.frames.find((frame) => frame.type === "tool_started");
      expect(toolStarted?.metadata).toEqual({ toolName: "edit" });
      const permission = server.frames.find((frame) => frame.type === "permission_requested");
      expect(permission?.metadata).toMatchObject({ detail: "Run shell", toolName: "bash" });
      expect(JSON.stringify(server.frames)).not.toContain("must-not-leak");
    } finally {
      await cleanup();
    }
  });

  it("does not throw when the bridge is unavailable", async () => {
    const harness = makePluginHarness();
    const plugin = createKagePlugin({ bridge: { paths: makePaths() }, logger: () => {} });

    const cleanup = await plugin.setup(harness.context);
    try {
      await waitFor(() => harness.subscribed(), 1000);
      harness.emit({
        type: "session.error",
        data: { sessionID: "s", error: { name: "Boom" } },
      });
      await new Promise((resolve) => setTimeout(resolve, 50));
      await expect(
        Promise.resolve(
          harness.toolHooks.get("execute.after")?.({
            tool: "read",
            sessionID: "s",
            id: "c",
          }),
        ),
      ).resolves.toBeUndefined();
    } finally {
      await cleanup();
    }
  });
});
