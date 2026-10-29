# Troubleshooting

## KAGE says "Waiting for OpenCode" and never connects

1. Make sure the desktop app is running.
2. Confirm the plugin is installed where OpenCode looks:
   `~/.config/opencode/plugins/kage.js` or `.opencode/plugins/kage.js`.
3. Restart OpenCode after installing the plugin (`opencode service restart`).
4. Check that the socket exists:

   ```bash
   ls -l "$XDG_RUNTIME_DIR/kage/"
   ```

   You should see `kage.sock` (mode 0600) and `token` (mode 0600).

5. Check whether KAGE received anything:

   ```bash
   node scripts/simulate-events.mjs
   ```

   If the simulator animates the creature, the bridge is fine and the problem is
   plugin loading, not KAGE.

## "Connection lost" after it was working

This is expected when OpenCode exits or the desktop app restarts. The plugin
reconnects with backoff; KAGE keeps the last known state until the plugin is back.

If it persists, confirm the plugin is running by checking OpenCode's logs and
that `kage.js` is present in a loaded plugin directory.

## The window is black / not transparent

Transparency requires a compositor. On GNOME, KDE and COSMIC it should work; on
bare X11 window managers without compositing it will not. KAGE is still usable
with a solid window background in that case. Do not report this as a bug without
naming your session type (`Wayland` vs `X11`) and compositor.

## The creature is not visible on a light desktop

KAGE's palette is deliberately dark. The creature is outlined in near-black and
has cyan eyes, so it remains readable, but the muted idle state is subtle by
design. Increase scale or opacity in settings if needed.

## Always-on-top does not work

Some window managers and fullscreen applications override always-on-top. KAGE
sets the hint; it cannot guarantee compositor behaviour on every Linux desktop.

## Permission requests do not show "attention"

The plugin listens for `permission.asked` and `permission.updated`. If your
OpenCode version does not emit either event, KAGE cannot know a permission is
pending and will show normal work activity. Check the installed OpenCode version
and event list; this is a genuine limitation, not a mapping the app can invent.

## No completion celebration

OpenCode exposes `session.idle` reliably but not every version exposes a
completion event. KAGE intentionally does not celebrate an idle session, because
idle does not prove the task succeeded. If your version only emits `session.idle`,
KAGE will settle into idle instead of celebrating.

## Settings do not persist

Check the file and directory permissions:

```bash
ls -l "$XDG_CONFIG_HOME/kage/settings.json"
```

If the file is corrupted or not an object, KAGE resets to validated defaults and
shows a notice in the details panel. Delete the file to start fresh.

## KAGE starts at login / does not exit

KAGE no longer uses login autostart. The OpenCode plugin starts the companion
when OpenCode runs, and there is nothing to enable in settings. If the mascot
appears before you start OpenCode, an older install left an entry behind —
delete it:

```bash
rm -f ~/.config/autostart/kage.desktop
```

A managed instance exits about 10 seconds after the last OpenCode client
disconnects, or about 60 seconds after launch if no client ever connects. If it
outlives OpenCode, check for more than one process with `pgrep -a kage`; a second
launch only asks the running instance to show its window and exits.

## Removing KAGE

1. Remove the plugin: `node scripts/install-plugin.mjs --uninstall`
2. Remove the app, `~/.config/kage/`, and `$XDG_RUNTIME_DIR/kage/`.
3. If an older install left a login autostart entry, delete it:
   `rm -f ~/.config/autostart/kage.desktop`.

KAGE does not install services or modify shell configuration.

## Debug logging (Windows and Linux)

If something isn't working, run the companion with `--debug-log`, or set
`KAGE_DEBUG_LOG=1` in the environment so OpenCode-launched instances also log:

```bash
# Windows (PowerShell)
& "$env:LOCALAPPDATA\Programs\KAGE\kage.exe" --debug-log
# Linux
~/.local/bin/KAGE.AppImage --debug-log
```

It writes timestamped lines to `%TEMP%\\kage-debug.log` (Windows) or
`$XDG_RUNTIME_DIR/kage/kage-debug.log` (Linux). Share that file when reporting
an issue. The log records startup, resolved paths, lock acquisition, bridge
start, client connect/disconnect counts, and the managed-exit reason.
