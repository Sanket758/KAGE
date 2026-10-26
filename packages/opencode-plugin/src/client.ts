import { readFileSync } from "node:fs";
import net from "node:net";
import { PROTOCOL_VERSION, type KAGEEvent } from "@kage/core";
import { resolveBridgePaths, type BridgePaths } from "./paths.js";

export type BridgeStatus = "idle" | "connecting" | "connected";

export interface BackoffOptions {
  baseMs: number;
  maxMs: number;
  jitter: number;
}

export interface BridgeClientOptions {
  paths?: BridgePaths;
  directory?: string;
  maxQueue?: number;
  connectTimeoutMs?: number;
  backoff?: Partial<BackoffOptions>;
  tokenReader?: (path: string) => string | null;
  logger?: (message: string) => void;
}

const DEFAULT_BACKOFF: BackoffOptions = { baseMs: 500, maxMs: 10_000, jitter: 0.2 };

/**
 * Fire-and-forget NDJSON client for the KAGE desktop companion.
 *
 * Guarantees:
 *  - never throws into OpenCode's hot path;
 *  - never awaits the socket;
 *  - bounded queue, dropping the oldest events when the desktop is absent;
 *  - bounded exponential backoff with jitter and unref'd timers.
 */
export class BridgeClient {
  readonly paths: BridgePaths;
  readonly maxQueue: number;
  #directory?: string;
  #logger: (message: string) => void;
  #connectTimeoutMs: number;
  #backoff: BackoffOptions;
  #tokenReader: (path: string) => string | null;

  #socket: net.Socket | null = null;
  #queue: KAGEEvent[] = [];
  #timer: NodeJS.Timeout | null = null;
  #started = false;
  #connected = false;
  #attempts = 0;
  #dropped = 0;
  #sent = 0;

  constructor(options: BridgeClientOptions = {}) {
    this.paths = options.paths ?? resolveBridgePaths();
    this.#directory = options.directory;
    this.maxQueue = options.maxQueue ?? 128;
    this.#connectTimeoutMs = options.connectTimeoutMs ?? 1000;
    this.#backoff = { ...DEFAULT_BACKOFF, ...options.backoff };
    this.#logger = options.logger ?? (() => {});
    this.#tokenReader = options.tokenReader ?? readToken;
  }

  get status(): BridgeStatus {
    if (this.#connected) return "connected";
    if (!this.#started) return "idle";
    return "connecting";
  }

  get queueSize(): number {
    return this.#queue.length;
  }

  get droppedCount(): number {
    return this.#dropped;
  }

  get sentCount(): number {
    return this.#sent;
  }

  start(): void {
    if (this.#started) return;
    this.#started = true;
    this.#connect();
  }

  stop(): void {
    this.#started = false;
    if (this.#timer) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
    this.#socket?.destroy();
    this.#socket = null;
    this.#connected = false;
    this.#queue = [];
  }

  /** Queues an event. Returns false when it was dropped immediately. */
  send(event: KAGEEvent): boolean {
    if (!this.#started) return false;
    if (this.#queue.length >= this.maxQueue) {
      this.#queue.shift();
      this.#dropped += 1;
    }
    this.#queue.push(event);
    if (this.#connected) this.#flush();
    else if (!this.#socket && !this.#timer) this.#schedule(0);
    return true;
  }

  #connect(): void {
    if (!this.#started || this.#socket) return;

    const token = this.#tokenReader(this.paths.tokenPath);
    if (!token) {
      this.#logger("bridge token not available; is the KAGE desktop app running?");
      this.#scheduleNext();
      return;
    }

    const socket = net.createConnection(this.paths.socketPath);
    this.#socket = socket;
    socket.setNoDelay(true);

    const timeout = setTimeout(() => {
      socket.destroy(new Error("bridge connect timeout"));
    }, this.#connectTimeoutMs);
    timeout.unref?.();

    socket.once("connect", () => {
      clearTimeout(timeout);
      this.#connected = true;
      this.#attempts = 0;
      const hello = JSON.stringify({
        type: "hello",
        version: PROTOCOL_VERSION,
        token,
        directory: this.#directory,
        pid: process.pid,
      });
      socket.write(`${hello}\n`);
      this.#flush();
    });

    socket.on("data", (chunk) => {
      const text = chunk.toString("utf8");
      if (text.includes('"type":"error"')) {
        this.#logger("bridge rejected the connection");
        socket.destroy();
      }
    });

    socket.on("error", () => {
      // Close always follows; reconnect is handled there.
    });

    socket.on("close", () => {
      clearTimeout(timeout);
      if (this.#socket === socket) this.#socket = null;
      const wasConnected = this.#connected;
      this.#connected = false;
      if (wasConnected) this.#logger("bridge connection closed");
      this.#scheduleNext();
    });
  }

  #flush(): void {
    const socket = this.#socket;
    if (!socket || !this.#connected) return;
    while (this.#queue.length > 0) {
      const event = this.#queue.shift();
      if (!event) break;
      try {
        socket.write(`${JSON.stringify({ type: "event", event })}\n`);
        this.#sent += 1;
      } catch {
        this.#queue.unshift(event);
        return;
      }
    }
  }

  #scheduleNext(): void {
    if (!this.#started) return;
    const { baseMs, maxMs, jitter } = this.#backoff;
    const exponential = Math.min(maxMs, baseMs * Math.pow(1.7, this.#attempts));
    this.#attempts = Math.min(this.#attempts + 1, 24);
    const offset = exponential * jitter * (Math.random() * 2 - 1);
    this.#schedule(Math.max(0, Math.round(exponential + offset)));
  }

  #schedule(delay: number): void {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = setTimeout(() => {
      this.#timer = null;
      this.#connect();
    }, delay);
    this.#timer.unref?.();
  }
}

function readToken(path: string): string | null {
  try {
    const token = readFileSync(path, "utf8").trim();
    return token.length >= 16 && token.length <= 256 ? token : null;
  } catch {
    return null;
  }
}
