import { spawn } from "node:child_process";
import { normalizeOpencodeEvent, type KAGEEvent } from "@kage/core";
import { resolveCompanionCommand } from "./companion.js";
import { BridgeClient, type BridgeClientOptions } from "./client.js";

/**
 * Minimal structural mirror of the OpenCode V2 plugin context.
 * Keeping it local means the bundle has no runtime dependency on the SDK.
 */
export interface OpencodeToolHookEvent {
  tool: string;
  sessionID: string;
  id?: string;
  input?: unknown;
  status?: "completed" | "error";
  result?: unknown;
  error?: unknown;
  [key: string]: unknown;
}

export interface OpencodePluginContext {
  location?: { directory?: string };
  event: {
    subscribe(options?: { signal?: AbortSignal }): AsyncIterable<unknown>;
  };
  tool: {
    hook(
      name: "execute.before" | "execute.after",
      callback: (event: OpencodeToolHookEvent) => void | Promise<void>,
    ): Promise<unknown>;
  };
}

export interface OpencodePluginDefinition {
  readonly id: string;
  readonly setup: (context: OpencodePluginContext) => Promise<() => void>;
}

export interface KagePluginOptions {
  /** Overrides for tests or unusual setups. */
  bridge?: BridgeClientOptions;
  logger?: (message: string) => void;
}

const FILE_EDIT_THROTTLE_MS = 250;

function spawnCompanion(): void {
  const command = resolveCompanionCommand();
  if (!command) return;
  spawn(command, [], { detached: true, stdio: "ignore", env: process.env }).unref();
}

/**
 * KAGE plugin: observes OpenCode and mirrors activity to the local companion.
 *
 * It never modifies tool calls, never executes commands, never approves
 * permissions, and does not read prompts or file contents. All bridge work is
 * best-effort; OpenCode keeps running when the companion is not installed.
 */
export function createKagePlugin(pluginOptions: KagePluginOptions = {}): OpencodePluginDefinition {
  return {
    id: "kage",
    async setup(context) {
      const client = new BridgeClient({
        spawnCompanion,
        ...pluginOptions.bridge,
        directory: pluginOptions.bridge?.directory ?? context.location?.directory,
        logger: pluginOptions.bridge?.logger ?? pluginOptions.logger,
      });
      client.start();

      const controller = new AbortController();
      let lastFileEditAt = 0;

      const emit = (events: KAGEEvent[]): void => {
        for (const event of events) client.send(event);
      };

      const observe = async (): Promise<void> => {
        try {
          for await (const event of context.event.subscribe({ signal: controller.signal })) {
            if (controller.signal.aborted) break;
            try {
              const normalized = normalizeOpencodeEvent(event);
              const throttled = normalized.filter((item) => {
                if (item.type !== "file_edited") return true;
                const now = Date.now();
                if (now - lastFileEditAt < FILE_EDIT_THROTTLE_MS) return false;
                lastFileEditAt = now;
                return true;
              });
              emit(throttled);
            } catch {
              // Observation must never break the session.
            }
          }
        } catch (error) {
          if (!controller.signal.aborted) {
            pluginOptions.logger?.(
              `KAGE event subscription stopped: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }
      };

      try {
        await context.tool.hook("execute.before", (toolInput) => {
          try {
            const event: KAGEEvent = {
              type: "tool_started",
              sessionId: toolInput.sessionID,
              timestamp: Date.now(),
              metadata: { toolName: toolInput.tool },
            };
            client.send(event);
          } catch {
            // ignore
          }
        });

        await context.tool.hook("execute.after", (toolInput) => {
          try {
            const event: KAGEEvent = {
              type: "tool_finished",
              sessionId: toolInput.sessionID,
              timestamp: Date.now(),
              metadata: { toolName: toolInput.tool },
            };
            client.send(event);
          } catch {
            // ignore
          }
        });
      } catch (error) {
        client.stop();
        throw error;
      }

      void observe();

      return () => {
        controller.abort();
        client.stop();
      };
    },
  };
}

export const KagePlugin = createKagePlugin();
export default KagePlugin;
