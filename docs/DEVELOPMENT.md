# Development

## Setup

```bash
npm install
npm run build:plugin        # bundles packages/opencode-plugin
```

Building the desktop shell needs Rust and the Tauri Linux prerequisites:
`webkit2gtk-4.1`, `gtk+-3.0`, `libsoup-3.0` development packages.

If the root filesystem is small, point Cargo at another disk:

```bash
CARGO_TARGET_DIR=/path/with/space cargo build --manifest-path apps/desktop/src-tauri/Cargo.toml
```

## Run in development

```bash
npm run dev
```

This starts Vite on port 1420 and the Tauri window. The window is transparent;
under a compositor without transparency support it will appear with a solid
background, which is expected and documented.

You can also develop the UI alone in a browser:

```bash
npm run dev --workspace @kage/desktop
```

Browser mode has no bridge. Settings use `localStorage` there, so the window can
be styled and clicked without Rust.

## Repository layout

```text
apps/desktop/            Svelte UI + Tauri shell (src-tauri)
packages/core/           events, validation, reducer, settings, selectors
packages/opencode-plugin bridge client + OpenCode hooks, bundled to dist/
packages/art/            palette, procedural sprite frames, animations
assets/                  reserved for alternate skins (see below)
scripts/                 plugin build, icon generation, simulator, previews
docs/                    architecture, testing, performance, troubleshooting
```

## Sprite art

KAGE's art is generated deterministically from primitives in
`packages/art/src/creature.ts`: a silhouette profile, ears, tendrils, antenna,
eyes, markings and particle effects. There are no binary sprite sheets to keep in
sync, and every frame is reproducible and unit tested.

Preview all states in a terminal:

```bash
npm run preview:sprites             # first frame of every state (ASCII)
npm run preview:sprites -- working  # every frame of one state
npm run preview:sprites -- idle --color   # truecolor blocks
```

### Adding a skin

Create a palette module and a pose builder that returns the same `SpriteFrame`
shape. The renderer only needs `32×32` palette-indexed frames; the rest of the
app (state machine, animation timing) is independent of the artwork. A
`SKIN` selector is intentionally not wired into settings yet — that is future
work, not a claim of support.

## Bridge paths

Both sides resolve paths the same way. For local experiments you can override:

```bash
export KAGE_SOCKET_PATH=/tmp/kage-dev.sock
export KAGE_TOKEN_PATH=/tmp/kage-dev-token
```

The app creates the token on startup. The plugin re-reads it on every attempt, so
restarting the app is safe.

## Event simulator

```bash
node scripts/simulate-events.mjs                    # demo
node scripts/simulate-events.mjs --scenario error
node scripts/simulate-events.mjs --scenario permission
```

It speaks the real bridge protocol with the real token. It does not run OpenCode
or the plugin, so it is a fixture, not a live integration test.

## Checks

```bash
npm test                                  # TypeScript unit + integration
npm run typecheck
cd apps/desktop && npm run check          # svelte-check
cd apps/desktop/src-tauri && cargo test --lib
```

## Release build

```bash
npm run build --workspace @kage/desktop
cd apps/desktop/src-tauri && cargo build --release
# bundles (requires the Tauri bundler, network for AppImage tooling):
npm run tauri:build --workspace @kage/desktop
```

Packaging is configured for `deb` and `appimage` in `tauri.conf.json`. Verify
artifacts exist before claiming a release.
