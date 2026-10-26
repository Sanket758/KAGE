#!/usr/bin/env node
/**
 * UI end-to-end check.
 *
 * Serves the built desktop frontend, opens it in headless Chrome with a mocked
 * Tauri IPC layer, drives real bridge events, and asserts the passive mascot
 * reflects the resulting state. It verifies the Svelte UI, reducer wiring and
 * event listener code. It does NOT verify WebKitGTK or the Rust bridge.
 *
 * Run: npm run build --workspace @kage/desktop && node tests/e2e/ui-check.mjs
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const DIST = join(ROOT, "apps/desktop/dist");
const ARTIFACTS = join(ROOT, "tests/e2e/artifacts");
const PORT = 4173;
const DEBUG_PORT = 9222;
const VIEWPORT = { width: 192, height: 176 };

if (!existsSync(join(DIST, "index.html"))) {
  console.error("Build the frontend first: npm run build --workspace @kage/desktop");
  process.exit(1);
}
mkdirSync(ARTIFACTS, { recursive: true });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const server = spawn("python3", ["-m", "http.server", String(PORT), "--directory", DIST], {
  stdio: "ignore",
});
const chromeProfile = `/tmp/kage-chrome-${process.pid}`;
const chrome = spawn(
  "google-chrome",
  [
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--hide-scrollbars",
    `--window-size=${VIEWPORT.width},${VIEWPORT.height}`,
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${chromeProfile}`,
    "about:blank",
  ],
  { stdio: "ignore" },
);

const failures = [];
function check(condition, message) {
  if (condition) {
    console.log(`  ok  ${message}`);
  } else {
    console.log(`  FAIL ${message}`);
    failures.push(message);
  }
}

function cleanup() {
  chrome.kill("SIGKILL");
  server.kill("SIGKILL");
}
process.on("exit", cleanup);
process.on("SIGINT", () => {
  cleanup();
  process.exit(130);
});

async function waitForJson(url, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return await response.json();
    } catch {
      // not ready yet
    }
    await sleep(150);
  }
  throw new Error(`timed out waiting for ${url}`);
}

const targets = await waitForJson(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
const page = targets.find((target) => target.type === "page");
if (!page) throw new Error("no Chrome page target");

const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.onopen = resolve;
  socket.onerror = reject;
});

let nextId = 0;
const pending = new Map();
const consoleErrors = [];

socket.onmessage = (message) => {
  const payload = JSON.parse(message.data);
  if (payload.id !== undefined) {
    const waiter = pending.get(payload.id);
    if (!waiter) return;
    pending.delete(payload.id);
    if (payload.error) waiter.reject(new Error(payload.error.message));
    else waiter.resolve(payload.result);
    return;
  }
  if (payload.method === "Runtime.exceptionThrown") {
    consoleErrors.push(payload.params.exceptionDetails.text);
  }
  if (payload.method === "Runtime.consoleAPICalled" && payload.params.type === "error") {
    consoleErrors.push(
      payload.params.args.map((arg) => arg.value ?? arg.description ?? "").join(" "),
    );
  }
};

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const result = await send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? "evaluation failed");
  }
  return result.result.value;
}

async function screenshot(name) {
  const result = await send("Page.captureScreenshot", { format: "png", fromSurface: true });
  const path = join(ARTIFACTS, name);
  writeFileSync(path, Buffer.from(result.data, "base64"));
  console.log(`  screenshot ${path}`);
}

async function docsScreenshot() {
  const result = await send("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    clip: { x: 0, y: 0, width: VIEWPORT.width, height: VIEWPORT.height, scale: 2 },
  });
  writeFileSync(join(ROOT, "docs/kage-window.png"), Buffer.from(result.data, "base64"));
  console.log("  screenshot docs/kage-window.png");
}

const MOCK_TAURI = `
(() => {
  window.isTauri = true;
  const callbacks = new Map();
  const listeners = new Map();
  let nextCallback = 1;
  window.__TAURI_INTERNALS__ = {
    metadata: {
      currentWindow: { label: 'main' },
      currentWebview: { label: 'main' },
      currentWebviewWindow: { label: 'main' },
    },
    transformCallback(callback, once) {
      const id = nextCallback++;
      callbacks.set(id, { callback, once });
      return id;
    },
    unregisterCallback(id) { callbacks.delete(id); },
    convertFileSrc(path) { return path; },
    async invoke(command, args = {}) {
      if (command === 'plugin:event|listen') {
        const set = listeners.get(args.event) ?? new Set();
        set.add(args.handler);
        listeners.set(args.event, set);
        return args.handler;
      }
      if (command === 'plugin:event|unlisten') {
        listeners.get(args.event)?.delete(args.handler);
        return null;
      }
      if (command === 'get_settings') return {};
      if (command === 'get_bridge_status') return 'connected';
      return null;
    },
  };
  window.__KAGE_TEST_EMIT__ = (event, payload) => {
    for (const id of listeners.get(event) ?? []) {
      const entry = callbacks.get(id);
      if (entry) entry.callback({ event, id, payload });
    }
  };
})();
`;

await send("Page.enable");
await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", {
  ...VIEWPORT,
  deviceScaleFactor: 2,
  mobile: false,
});
await send("Emulation.setDefaultBackgroundColorOverride", {
  color: { r: 0, g: 0, b: 0, a: 0 },
});
await send("Page.addScriptToEvaluateOnNewDocument", { source: MOCK_TAURI });
await send("Page.navigate", { url: `http://127.0.0.1:${PORT}/` });

const readyDeadline = Date.now() + 15_000;
let ready = false;
while (Date.now() < readyDeadline) {
  try {
    ready = await evaluate(
      "Boolean(document.querySelector('.app') && document.querySelector('canvas'))",
    );
  } catch {
    ready = false;
  }
  if (ready) break;
  await sleep(150);
}
check(ready, "app mounts and renders the creature canvas");

await sleep(350);
check(
  (await evaluate("document.querySelector('.app')?.dataset.character")) === "idle",
  "connected with no session starts in idle",
);

const layout = await evaluate(`
  (() => {
    const app = document.querySelector('.app');
    const canvas = document.querySelector('canvas');
    const appRect = app?.getBoundingClientRect();
    return {
      appWidth: appRect?.width,
      appHeight: appRect?.height,
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight,
      canvasWidth: canvas?.getBoundingClientRect().width,
      canvasHeight: canvas?.getBoundingClientRect().height,
    };
  })()
`);
check(
  layout.appWidth === 192 && layout.appHeight === 176,
  "window is content-sized around the mascot",
);
check(
  layout.scrollWidth === 192 && layout.scrollHeight === 176,
  "the page has no extra scrollable surface",
);
check(
  layout.canvasWidth === 192 && layout.canvasHeight === 176,
  "the sprite canvas fills the window",
);

const passive = await evaluate(`
  (() => {
    const controls = document.querySelectorAll(
      'button, a, input, select, textarea, [tabindex], [data-tauri-drag-region]'
    );
    return {
      controls: controls.length,
      cards: document.querySelectorAll('.card').length,
      appPointer: getComputedStyle(document.querySelector('.app')).pointerEvents,
      canvasPointer: getComputedStyle(document.querySelector('canvas')).pointerEvents,
      activeTag: document.activeElement?.tagName,
    };
  })()
`);
check(passive.controls === 0, "there are no interactive controls");
check(passive.cards === 0, "there is no status card or settings panel");
check(passive.appPointer === "none", "the mascot surface ignores pointer events");
check(passive.canvasPointer === "none", "the sprite canvas ignores pointer events");
check(passive.activeTag === "BODY", "nothing inside KAGE takes focus");

await screenshot("01-idle.png");

const now = Date.now();
const emit = async (event) => {
  await evaluate(
    `window.__KAGE_TEST_EMIT__('kage://event', ${JSON.stringify({ timestamp: now, ...event })})`,
  );
};
const character = () => evaluate("document.querySelector('.app')?.dataset.character");

await emit({
  type: "session_active",
  sessionId: "ses_e2e",
  metadata: { status: "busy", directory: "/home/me/kage-demo" },
});
await emit({ type: "tool_started", sessionId: "ses_e2e", metadata: { toolName: "edit" } });
await sleep(1200);
check((await character()) === "tool_activity", "an active tool shows the tool state");
await screenshot("02-tool.png");

await emit({ type: "tool_finished", sessionId: "ses_e2e", metadata: { toolName: "edit" } });
await sleep(400);
check((await character()) === "working", "finishing the tool returns to working");

await emit({ type: "tool_started", sessionId: "ses_e2e", metadata: { toolName: "websearch" } });
await sleep(500);
check((await character()) === "searching", "a web search tool shows the searching state");
await screenshot("03-searching.png");
await docsScreenshot();

await emit({ type: "tool_finished", sessionId: "ses_e2e", metadata: { toolName: "websearch" } });
await sleep(400);
check((await character()) === "working", "finishing the search returns to working");

await emit({
  type: "permission_requested",
  sessionId: "ses_e2e",
  metadata: { status: "pending", detail: "Run a local command" },
});
await sleep(350);
check((await character()) === "attention", "a permission request shows attention");
await screenshot("04-permission.png");

await emit({ type: "permission_resolved", sessionId: "ses_e2e" });
await emit({
  type: "session_error",
  sessionId: "ses_e2e",
  metadata: { status: "error", detail: "provider overloaded" },
});
await sleep(450);
check((await character()) === "error", "a session error shows the error state");
await screenshot("05-error.png");

// Hiding the window must stop the draw timer, not merely skip drawing.
await evaluate(`
  window.__kage_clears = 0;
  const proto = CanvasRenderingContext2D.prototype;
  if (!proto.__kageWrapped) {
    const original = proto.clearRect;
    proto.clearRect = function (...args) {
      window.__kage_clears += 1;
      return original.apply(this, args);
    };
    proto.__kageWrapped = true;
  }
  Object.defineProperty(document, 'hidden', {
    configurable: true,
    get: () => true,
  });
  document.dispatchEvent(new Event('visibilitychange'));
`);
await sleep(400);
const clearsBefore = await evaluate("window.__kage_clears");
await sleep(1200);
const clearsWhileHidden = await evaluate("window.__kage_clears");
check(clearsWhileHidden === clearsBefore, "animation work stops while the window is hidden");

await evaluate(`
  Object.defineProperty(document, 'hidden', {
    configurable: true,
    get: () => false,
  });
  document.dispatchEvent(new Event('visibilitychange'));
`);
await sleep(1200);
const clearsAfterShow = await evaluate("window.__kage_clears");
check(clearsAfterShow > clearsWhileHidden, "animation resumes when the window is visible");

await emit({ type: "session_completed", sessionId: "ses_e2e", metadata: { status: "completed" } });
await sleep(300);
check((await character()) === "celebrating", "a genuine completion celebrates");
await screenshot("06-celebration.png");

check(consoleErrors.length === 0, `no browser errors (${consoleErrors.join(" | ")})`);

console.log("");
if (failures.length > 0) {
  console.error(`${failures.length} UI check(s) failed`);
  process.exit(1);
}
console.log("all UI checks passed");
process.exit(0);
