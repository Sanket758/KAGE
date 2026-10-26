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

## Launch at login does nothing

KAGE writes `$XDG_CONFIG_HOME/autostart/kage.desktop` pointing at the current
executable. If you enabled it while running a development build, it will launch
that debug binary. Re-enable it from the packaged app to fix the path.

## Removing KAGE

1. Turn off "Launch at login" in settings (or delete `~/.config/autostart/kage.desktop`).
2. Remove the plugin: `node scripts/install-plugin.mjs --uninstall`
3. Remove the app, `~/.config/kage/`, and `$XDG_RUNTIME_DIR/kage/`.

KAGE does not install services or modify shell configuration.
