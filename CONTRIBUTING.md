# Contributing

KAGE aims to stay small: a reliable event bridge, a deterministic state machine,
and original pixel art. Contributions that add dashboards, cloud services,
autonomous behavior, or heavyweight dependencies are out of scope for v0.1.

## Before you start

- Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
- Run `npm test` and `npm run typecheck` before and after changes.
- Keep event normalization inside `packages/core`; the UI must not parse raw
  OpenCode payloads.
- Do not let individual events drive arbitrary UI behavior. Route everything
  through the reducer.

## Code style

- TypeScript strict mode, ES modules, no new runtime dependencies without a
  concrete need.
- Rust: standard formatting (`cargo fmt`), no `unwrap` on untrusted input,
  bounded reads and no busy loops.
- Svelte: runes mode, accessible controls, no focus stealing from the agent.

## Tests

New behavior needs a test at the lowest layer that can prove it:

- state mapping, priorities, dedupe, multi-session, stale cleanup → reducer tests;
- payload handling → normalization tests;
- bridge behavior → plugin integration test or Rust test;
- visual state coverage → `packages/art/test`.

## Art

The character is original. Do not submit extracted or traced assets from other
projects. Sprite frames are generated procedurally; add poses and palettes in
`packages/art` and run `npm run preview:sprites` to review them in a terminal.

## Pull requests

Describe what changed, what you verified (commands and outcomes), and any
limitation you could not test. Do not claim a live integration you did not run.
