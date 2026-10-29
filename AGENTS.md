# AGENTS.md

KAGE is a local-first pixel-art desktop companion for OpenCode: TypeScript
workspaces (`packages/core`, `packages/art`, `packages/opencode-plugin`), a
Svelte 5 UI, and a Tauri 2/Rust shell. Linux-first (WebKitGTK 4.1 + GTK 3);
Node 20+ and Rust 1.77+. Use npm with the existing workspaces and
`package-lock.json`.

Read `docs/ARCHITECTURE.md` before changing the event flow and
`docs/TESTING.md` for what is actually verified versus merely implemented.

## Commands

```bash
npm test                                   # Vitest: only packages/*/test/**/*.test.ts
npm run typecheck                          # tsc; does not check .svelte files
npm run check                              # typecheck + test; still no Svelte/Rust
(cd apps/desktop && npm run check)         # svelte-check
(cd apps/desktop/src-tauri && cargo test --lib)

npm run dev                                # Vite :1420 (strict) + Tauri window
npm run dev --workspace @kage/desktop      # browser-only UI, no bridge (localStorage settings)
npm run build                              # frontend only -> apps/desktop/dist
npm run tauri:build --workspace @kage/desktop  # bundle; tauri.conf runs the frontend build first
```

Single test: `npx vitest run packages/core/test/reducer.test.ts`, or
`npx vitest run -t "name"`. Rust: `cargo test --lib bridge::tests::...`.
There is no JS lint/format/CI script; match existing style (`cargo fmt` for Rust).

E2E UI check needs a fresh build and rewrites the README screenshot:

```bash
npm run build --workspace @kage/desktop
node tests/e2e/ui-check.mjs
```

It uses headless Chrome + `python3`, mocks Tauri IPC, and writes
`docs/kage-window.png` plus `tests/e2e/artifacts/*.png`. It does not prove
WebKitGTK rendering or the Rust bridge.

## Boundaries

- `packages/core`: event contract, validation, OpenCode normalization, pure
  reducer, settings, selectors. No DOM or I/O. The UI must never parse raw
  OpenCode payloads — normalize in core.
- `packages/opencode-plugin`: OpenCode hooks plus a non-blocking Unix-socket
  client. It must never throw into or slow OpenCode; sends are fire-and-forget
  with a bounded (128) queue and backoff.
- `packages/art`: procedural 40×40 palette-indexed sprites and the animation
  table. No sprite sheets; add poses/palettes in code. Preview with
  `npm run preview:sprites -- <state>` (append `--color` for truecolor).
- `apps/desktop`: Svelte 5 runes UI; `src-tauri` owns the socket server, auth,
  settings, single-instance lock and process lifetime. The window is fixed-size;
  panels widen it from 200×200 to 300×~500.
- All event-to-behavior changes go through `applyEvent`/`tick` in
  `packages/core/src/reducer.ts`. Do not branch UI or animation directly on
  individual events. Mapping and priority rules live in `docs/ARCHITECTURE.md`.

## Contracts duplicated across Rust and TypeScript

Keep these in sync; a change on one side silently rejects or ignores the other:

- Event names: `KAGE_EVENT_TYPES` (`packages/core/src/types.ts`) and
  `SUPPORTED_EVENT_TYPES` (`apps/desktop/src-tauri/src/bridge.rs`). New metadata
  fields also need the Rust allowlist in `validate_event`.
- Bridge paths: `packages/opencode-plugin/src/paths.ts` mirrors
  `resolve_bridge_paths` in `bridge.rs` (`KAGE_SOCKET_PATH` / `KAGE_TOKEN_PATH`,
  short `/tmp/kage-<uid>.sock` fallback).
- Character states: `CHARACTER_STATES` (core) ↔ `ANIMATIONS`
  (`packages/art/src/animations.ts`) ↔ `PRIORITY` (reducer).
- Settings: add fields to `KAGESettings`, `DEFAULT_SETTINGS` and
  `validateSettings` in `packages/core/src/settings.ts`, plus the settings UI.
  Rust persists a JSON object; the UI re-validates it.

## Gotchas

- `npm test` and `npm run build` do not rebuild the plugin. After core/plugin
  changes run `npm run build:plugin`, then
  `node scripts/install-plugin.mjs [--project|--uninstall]`. The bundle is
  ignored at `packages/opencode-plugin/dist/`.
- `cargo build --release` alone does not embed the frontend; add
  `--features custom-protocol` or use `tauri build`.
- Launching KAGE while an instance is running sends a "show" request and exits;
  it is not a second instance.
- Runtime files: `$XDG_RUNTIME_DIR/kage/{kage.sock,token}`; settings at
  `$XDG_CONFIG_HOME/kage/settings.json`.
- `scripts/simulate-events.mjs` needs a running app and token and speaks the
  real protocol, but it is a fixture, not OpenCode. Options include
  `--scenario permission|error`, `--socket`, `--token`.
- Event mapping targets documented OpenCode 2.1.2 events; no live agent session
  has been verified (see `docs/TESTING.md`). Do not claim live integration.
- Doc drift: `docs/ARCHITECTURE.md` and `SECURITY.md` describe a CSP, but
  `apps/desktop/src-tauri/tauri.conf.json` currently has `"csp": null`. Trust
  the config.

## Non-negotiable product boundaries

- Local only: no network listener, outbound calls, telemetry, accounts or cloud.
- Observe only: never add keyboard/mouse capture or injection, screen capture,
  remote control, or permission approval.
- Never send prompts, responses, file contents, diffs, environment variables or
  tool arguments. Allowed: tool name, session id, project directory, edited
  file's basename, OpenCode error text.
- Idle is not success; celebrate only a genuine completion signal.
  `tool.execute.after` does not expose tool success or failure.
- Art must be original. `mascot-ideas/`, `feedback.md` and the Clawd references
  are inspiration only; do not import or trace external assets.
- No new runtime dependencies without a concrete need.

`KAGE.md` and `IDEA.md` are product specs, not status. Use
`docs/IMPLEMENTATION_PLAN.md` to distinguish implemented work from unverified
targets.
