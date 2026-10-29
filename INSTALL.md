# Installing KAGE

KAGE is a little desktop mascot that mirrors your [OpenCode](https://opencode.ai)
session activity. It has two pieces:

| Piece | What it is | Where it lives |
| --- | --- | --- |
| Companion app | Tauri desktop overlay that renders the mascot | `~/.local/bin/KAGE.AppImage` |
| OpenCode plugin | Watches your OpenCode session and drives the mascot | `~/.config/opencode/plugins/kage.js` |

## Requirements

- Linux (x86_64). Windows support is planned — see [Limitations](#limitations).
- OpenCode CLI already installed and working.
- System libraries: `libwebkit2gtk-4.1-0` and `libgtk-3-0`
  (preinstalled on Pop!_OS and most Ubuntu-family desktops; the installer
  checks and tells you the exact command if they are missing).

## One-line install

```bash
curl -fsSL https://raw.githubusercontent.com/Sanket758/KAGE/main/scripts/install.sh | bash
```

or from a release artifact:

```bash
bash install.sh
```

The installer downloads the latest release, puts the AppImage in
`~/.local/bin`, and installs the plugin. KAGE does not register login
autostart: the plugin starts the companion when OpenCode runs, and it exits when
OpenCode's server stops. **Then restart OpenCode** (or run
`opencode service restart`) so the plugin loads — the mascot appears the moment
a session starts.

Useful flags:

```bash
bash install.sh --version v0.2.0   # pin a release
bash install.sh --uninstall        # remove the app and plugin
```

## Install from the .deb (Debian/Ubuntu/Pop!_OS)

Download `KAGE_*_amd64.deb` from
[Releases](https://github.com/Sanket758/KAGE/releases), then:

```bash
sudo apt install ./KAGE_*_amd64.deb
```

The deb installs the `kage` binary, but **not** the OpenCode plugin — still grab
`kage.js` from the release and put it in
`~/.config/opencode/plugins/`. The plugin is what starts the companion, so the
binary alone will not appear on screen.

## Plugin-only install (already have the companion?)

```bash
bash install.sh            # full install, or:
curl -fsSL <release-url>/kage.js -o ~/.config/opencode/plugins/kage.js
```

OpenCode also supports installing straight from this repository:

```bash
opencode plugin add github:Sanket758/KAGE
```

## What it looks like when it works

- A small mascot floats above your windows (it is click-through everywhere
  except the sprite itself — **grab the sprite to drag it**, the position is
  remembered).
- Working → it debugs; tool calls → it searches; errors → it panics; session
  success → it celebrates (once).
- If the companion is not running when a session starts, the plugin launches
  it automatically (up to 5 attempts).

## Troubleshooting

- **No mascot appears.** Is the companion running? `pgrep -x kage`. Are the
  socket and token there? `ls "$XDG_RUNTIME_DIR/kage/"`. After installing the
  plugin you must restart OpenCode once.
- **Check the lifecycle.** Start `opencode`; exactly one mascot appears and
  `pgrep -a kage` shows one process. After OpenCode stops, the mascot exits
  within about 10 seconds. If a second copy is launched, it asks the running
  instance to show its window and exits.
- **A rounded card / border around the mascot.** COSMIC (Pop!_OS): Settings →
  Appearance → Floating windows → turn **off** "Match system corners and
  apply shadows".
- **Plugin is loaded but silent.** `opencode plugin add` and the file-drop
  install are equivalent; check the plugin file is non-empty and restart
  `opencode serve`.

## Windows (beta)

Download `KAGE_*_x64-setup.exe` (or the `.msi`) from
[Releases](https://github.com/Sanket758/KAGE/releases) and run it. The plugin
is the same single file — put `kage.js` in
`%APPDATA%\opencode\plugins\` (or install it with
`opencode plugin add github:Sanket758/KAGE`).

Notes:

- The companion uses WebView2 (auto-installed with Edge on up-to-date
  Windows); no WebKitGTK is needed.
- Transport on Windows is loopback TCP (`127.0.0.1`, ephemeral port published
  in `%LOCALAPPDATA%\kage\kage.port`) with the same per-run token auth.
- Beta caveats: the whole mascot rectangle captures the mouse on Windows (the
  Linux build only captures the sprite), and the release has passed CI build +
  headless smoke tests but has not been exercised on real desktops yet.

## Limitations

- Linux x86_64 (stable) and Windows x64 (beta). The app cannot run inside
  Docker/containers — it needs your real desktop session.
- The overlay needs a compositor; headless/Xvfb setups will not show it.
