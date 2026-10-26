#!/usr/bin/env node
/**
 * Sends scripted KAGE events to a running companion.
 *
 * This is SIMULATED activity for demos and integration checks. It is not a
 * live OpenCode session and does not exercise the plugin inside OpenCode.
 *
 *   node scripts/simulate-events.mjs
 *   node scripts/simulate-events.mjs --scenario permission
 *   node scripts/simulate-events.mjs --socket /tmp/kage.sock --token /tmp/token
 */
import { readFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import net from "node:net";

const args = process.argv.slice(2);
function option(name, fallback) {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
}

const runtimeDir = join(process.env.XDG_RUNTIME_DIR || tmpdir(), "kage");
const socketPath =
  option("socket", process.env.KAGE_SOCKET_PATH) || join(runtimeDir, "kage.sock");
const tokenPath = option("token", process.env.KAGE_TOKEN_PATH) || join(runtimeDir, "token");
const scenario = option("scenario", "demo");
const sessionId = option("session", "ses_demo");
const directory = option("directory", process.cwd());

let token;
try {
  token = readFileSync(tokenPath, "utf8").trim();
} catch {
  console.error(`No token at ${tokenPath}. Start the KAGE desktop app first.`);
  process.exit(1);
}

const socket = net.createConnection(socketPath);
socket.setNoDelay(true);
socket.on("error", (error) => {
  console.error(`Could not reach KAGE at ${socketPath}: ${error.message}`);
  process.exit(1);
});

let authenticated = false;
let buffer = "";

socket.on("data", (chunk) => {
  buffer += chunk.toString("utf8");
  let newline = buffer.indexOf("\n");
  while (newline >= 0) {
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    newline = buffer.indexOf("\n");
    if (!line) continue;
    const frame = JSON.parse(line);
    if (frame.type === "welcome") {
      authenticated = true;
      runScenario();
    } else if (frame.type === "error") {
      console.error(`KAGE rejected the connection: ${frame.reason}`);
      process.exit(1);
    }
  }
});

socket.on("connect", () => {
  socket.write(
    `${JSON.stringify({ type: "hello", version: 1, token, directory, pid: process.pid })}\n`,
  );
});

function send(type, metadata) {
  const event = { type, sessionId, timestamp: Date.now() };
  if (metadata) event.metadata = metadata;
  socket.write(`${JSON.stringify({ type: "event", event })}\n`);
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function runScenario() {
  const now = () => new Date().toLocaleTimeString();
  const scenarios = {
    demo: async () => {
      send("session_active", { status: "busy", directory });
      await wait(900);
      send("tool_started", { toolName: "read" });
      await wait(1200);
      send("tool_finished", { toolName: "read" });
      await wait(600);
      send("tool_started", { toolName: "edit" });
      await wait(700);
      send("file_edited", { detail: "app.ts" });
      await wait(1200);
      send("tool_finished", { toolName: "edit" });
      await wait(1800);
      send("session_completed", { status: "completed" });
    },
    permission: async () => {
      send("session_active", { status: "busy", directory });
      await wait(700);
      send("tool_started", { toolName: "shell" });
      await wait(500);
      send("permission_requested", { status: "pending", detail: "Run a local command" });
      await wait(5000);
      send("permission_resolved", { status: "resolved" });
      await wait(1200);
      send("tool_finished", { toolName: "shell" });
      await wait(1200);
      send("session_idle", { status: "idle" });
    },
    error: async () => {
      send("session_active", { status: "busy", directory });
      await wait(700);
      send("tool_started", { toolName: "read" });
      await wait(900);
      send("session_error", { status: "error", detail: "provider overloaded" });
      await wait(3000);
      send("session_active", { status: "busy" });
      await wait(900);
      send("tool_started", { toolName: "grep" });
      await wait(1200);
      send("tool_finished", { toolName: "grep" });
      await wait(900);
      send("session_idle", { status: "idle" });
    },
  };

  const run = scenarios[scenario];
  if (!run) {
    console.error(`Unknown scenario "${scenario}". Use demo, permission, or error.`);
    process.exit(1);
  }
  console.log(`[${now()}] sending simulated "${scenario}" events to ${socketPath}`);
  await run();
  await wait(300);
  socket.end();
}

socket.on("close", () => {
  if (!authenticated) {
    console.error("KAGE closed the connection before the demo started.");
    process.exit(1);
  }
  console.log("simulation finished");
});
