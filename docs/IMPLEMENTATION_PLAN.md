# Implementation plan

Status reflects what is implemented in this repository, verified by tests or by
running the app. See [TESTING.md](TESTING.md) for evidence.

## Stage 1 — Environment audit

- [x] Inspect the repository and installed toolchain.
- [x] Confirm OpenCode `2.1.2` and inspect the documented plugin hooks and event
      payload types shipped with it.
- [x] Confirm Node 22, Rust, WebKitGTK 4.1 and a display for GUI checks.

Environment notes:

- The root filesystem had ~2 GB free, so Rust build artifacts were directed to a
  temporary target directory during development. This does not affect the code.
- The desktop session is Wayland/Pop!_OS. GUI checks were also run against an
  isolated Xvfb display.

## Stage 2 — Event model and state machine

- [x] Internal event contract with runtime validation.
- [x] OpenCode event normalization, including permission and error payloads.
- [x] Deterministic reducer with priorities, debouncing, dedupe, stale cleanup,
      multi-session primary selection, reconnect recovery and sleep.
- [x] Settings schema and validation.
- [x] Unit tests for all transitions and rejection paths.

## Stage 3 — OpenCode plugin

- [x] Documented hooks (`event`, `tool.execute.before`, `tool.execute.after`).
- [x] No tool arguments or file contents read.
- [x] Bounded, non-blocking Unix socket client with token authentication and
      bounded exponential backoff.
- [x] Integration tests against a fake companion, including unavailable server
      and token failure cases.
- [x] Single-file bundle and installer script.

## Stage 4 — Desktop shell and character

- [x] Original palette, procedural pixel creature and nine states.
- [x] Canvas renderer with crisp scaling, reduced motion and animation intensity.
- [x] Frameless, transparent, always-on-top window with drag strip.
- [x] Click-to-inspect panel and settings panel.
- [x] Persistent settings, window position restore, autostart entry.
- [x] App icons generated from the creature art.

## Stage 5 — Bridge

- [x] Rust Unix socket server with token auth, frame limits, schema validation,
      rate limiting, client cap and status reporting.
- [x] Integration tests for successful and rejected connections.

## Stage 6 — Integration

- [x] Simulated end-to-end scenario against the built app (see TESTING.md).
- [ ] Live OpenCode scenario driven through the real plugin in an agent session.
      The behavior is covered by fixtures and by the plugin integration tests,
      but a live agent run is not claimed unless performed.

## Stage 7 — Performance

- [x] Record methodology and measurements (CPU, RSS/PSS, startup, event flood)
      in [PERFORMANCE.md](PERFORMANCE.md).
- [x] Check for unbounded queues/timers; hide now unmounts the creature so the
      draw loop stops, and stale timer callbacks can no longer reschedule.
- [ ] Meet the idle (<1%) and memory (<150 MiB) targets. Working CPU is now
      4.7% (target <5%) after shrinking the window; idle is 1.8% and PSS is
      192 MiB, still above target on the software-rendered Xvfb display. See
      PERFORMANCE.md.
- [ ] End-to-end event-to-visible latency (target <100 ms p95) — not measured.

## Stage 8 — QA

- [x] TypeScript, Svelte and Rust checks.
- [x] Unit and integration suites.
- [x] Packaging artifact build: `KAGE_0.1.0_amd64.deb` (deb and AppImage; release CI attaches both to GitHub Releases).

## Stage 9 — Documentation

- [x] README, architecture, development, testing, performance, troubleshooting,
      security and contributing docs.
- [x] Known limitations documented without invented compatibility claims.

## Stage 10 — Focus the MVP on session status

The product direction is now a small, passive mascot that reflects the current
OpenCode session. The existing app still has interactive controls; the Stage 4
items above describe the current implementation, not the desired end state.

- [ ] Reduce the window to the passive mascot; remove the drag affordance and
      in-window panels or controls.
- [ ] Map reliable OpenCode events to the core states in [KAGE.md](../KAGE.md).
- [ ] Check the basic state mapping and update user-facing docs after the app
      matches this scope.
