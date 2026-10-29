# Testing

## What exists

| Layer | Command | Coverage |
| --- | --- | --- |
| Core | `npm test` | event validation, OpenCode normalization, every state transition, priorities, dedupe, out-of-order, multi-session, stale cleanup, sleep/wake, settings validation |
| Plugin | `npm test` | Unix socket handshake, token auth, reconnection with backoff, bounded queue, missing token, plugin hooks forwarding normalized events, graceful absence |
| Art | `npm test` | every state has frames, palette bounds, determinism, visual state uniqueness, reduced motion |
| Rust bridge | `cd apps/desktop/src-tauri && cargo test --lib` | frame parsing, event validation, token comparison, live accept/authenticate/stream/disconnect, unauthorized rejection, settings round-trip and corruption, legacy autostart cleanup, single-instance lock |
| UI (headless Chrome) | `node tests/e2e/ui-check.mjs` | real built frontend with mocked Tauri IPC: mount, canvas, details panel content, permission/error states, settings persistence, no console errors |
| Types | `npm run typecheck`, `cd apps/desktop && npm run check` | TypeScript and Svelte |

`tests/e2e/ui-check.mjs` serves `apps/desktop/dist`, so build it first:

```bash
npm run build --workspace @kage/desktop
node tests/e2e/ui-check.mjs
```

It exercises the same `bridge.ts`, reducer and Svelte components as the desktop
app, with a mocked `window.__TAURI_INTERNALS__`. It does **not** prove WebKitGTK
rendering or the Rust IPC layer; those have separate checks below.

## Results recorded for this build

- `npm test`: 5 files, 47 tests passed.
- `npm run typecheck`: no errors.
- `cd apps/desktop && npm run check`: no errors or warnings.
- `cargo test --lib`: 10 tests passed.
- `tests/e2e/ui-check.mjs`: all checks passed, no browser console errors. The
  checks include details-panel content, permission and error states, the draw
  loop pausing when hidden and resuming when shown, settings persistence, and
  that the settings panel fits the window (Quit visible).
- Live local bridge check: release app started under Xvfb, socket and token
  created, `scripts/simulate-events.mjs` authenticated and streamed all demo
  events; the app accepted every frame (no error responses).
- Real WebKit window: the release build under Xvfb was captured read-only with
  `tests/e2e/x11-capture.py`, confirming the creature renders in WebKitGTK, not
  only in Chromium. The capture only reads pixels of the KAGE window.
- Packaging: `npx tauri build --bundles deb` produced
  `KAGE_0.1.0_amd64.deb` (2.84 MiB, depends on `libwebkit2gtk-4.1-0`,
  `libgtk-3-0`).

## Not verified

- **A live OpenCode agent session.** The plugin is covered by integration tests
  against a fake companion and by the real event payloads of OpenCode 2.1.2, but
  no LLM-backed session was run in this environment. Scenario A–E in the spec are
  therefore unclaimed; the simulator only proves the transport, not the plugin
  inside a live agent.
- **Transparency and always-on-top across compositors.** The window is ARGB with
  the usual hints, and it rendered correctly on the bare Xvfb display, but
  compositor behaviour on a real GNOME/COSMIC session was not tested.
- **Window interaction on the real window.** Clicking the creature, hiding and
  dragging are covered by the DOM harness and were manually observed during
  development. There is deliberately no automated tool in this repository that
  injects mouse or keyboard events into an X session; such a helper existed
  briefly and was removed.
- **The bundled `.deb` was not installed system-wide during this work.** It was
  built and its control metadata inspected, not `dpkg -i`-ed.
- **AppImage.** Produced by `tauri build` alongside the deb since the v0.2.0 packaging work; release CI attaches it to GitHub Releases.
- **Live OpenCode lifecycle.** The single-instance lock and managed-exit behavior
  are covered by Rust unit tests, and the plugin spawn path by plugin tests, but
  no live OpenCode session was run to confirm the exit timing. Do not claim it
  unless actually run.

## Manual scenarios

With the desktop app and plugin installed:

1. Start an OpenCode session and send a prompt. KAGE should wake, show working
   and tool activity, then rest when the session is idle.
2. Trigger a permission prompt. KAGE should freeze with an amber marker until you
   answer in OpenCode; it never answers for you.
3. Force a recoverable provider error. KAGE should show the error expression
   until new activity arrives.
4. Quit KAGE while OpenCode runs, then restart it. The plugin should reconnect and
   KAGE should resume the latest state without blocking the agent.
5. Run two sessions. The most recently active session drives the animation; a
   permission request promotes that session.

Report which of these you actually ran when opening a PR or an issue.
