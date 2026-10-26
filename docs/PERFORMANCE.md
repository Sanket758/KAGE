# Performance

Measurements taken on the release build while this repository was being built.
They describe this machine and this test display only. Treat the targets below
as engineering goals, not as verified claims for every desktop.

## Environment

| Item | Value |
| --- | --- |
| OS | Pop!_OS 24.04 LTS |
| CPU | 12th Gen Intel Core i5-12450H (12 logical CPUs) |
| RAM | 15 GiB |
| GPU | NVIDIA GeForce RTX 3050 6GB Laptop GPU (`nvidia-smi` available) |
| Display used for measurement | Xvfb `1200x800x24`, **no compositor** |
| Build | `cargo build --release` via `tauri build` (frontend embedded) |
| Node / Rust | Node 22.22.0, rustc 1.97.1 |

The test display matters: Xvfb has no compositor and WebKitGTK composites in
software there. The GPU was never used by KAGE during these runs, and
`nvidia-smi` reports no per-process utilisation for it that is meaningful here.
CPU and memory numbers below are therefore **pessimistic** compared with a normal
GNOME/COSMIC session, but they were not re-measured on the physical desktop.

## Method

- CPU: read `utime + stime` from `/proc/<pid>/stat` before and after each window,
  summed over the three processes KAGE runs (`kage`, `WebKitWebProcess`,
  `WebKitNetworkProcess`), divided by `CLK_TCK` and the elapsed wall time, then
  expressed as **percent of one logical CPU**. 100% means one core saturated; it
  is not normalised across the 12 logical CPUs.
- Memory: `VmRSS` and `Pss` from `/proc/<pid>/status` and
  `/proc/<pid>/smaps_rollup`. PSS counts shared library pages once, so it is the
  more honest figure; RSS is reported for comparison.
- Idle window: 30 s after the UI settled, no events, idle animation visible.
- Working window: 20 s after `session_active` + `tool_started`.
- Event flood: 2988 events at roughly 115/s for 26 s (below the bridge's 200/s
  limit), sampling RSS every second.
- Startup: process spawn to the bridge socket and token existing on disk.
- No synthetic mouse or keyboard input was used. Events were written to the
  local Unix socket exactly as the OpenCode plugin writes them.
- No screen or audio capture outside the app's own window was performed.

## Results

| Metric | Target | Measured | Verdict |
| --- | --- | --- | --- |
| Startup to bridge ready | not specified | 254 ms | recorded |
| Idle CPU, window visible (idle animation, ~2.4 fps) | < 1% of one core | **1.80%** | **missed** |
| Working CPU (tool activity, ~7 fps) | < 5% of one core | **4.73%** | met |
| CPU while hidden | not specified | **0.45%** | recorded |
| RSS, all three processes | < 150 MiB | **398.3 MiB** | **missed** |
| PSS, all three processes | (context for RSS) | **191.8 MiB** | recorded |
| RSS growth under 2988 events | no unbounded growth | 397.1 → 403.4 MiB, peak 405.6 | stable |
| Event-to-visible latency | < 100 ms p95 | **not measured** | unverified |

Idle and working CPU were re-measured after the window was reduced from
300 × 300 to 200 × 200 and the sprite moved to a 40 × 40 grid; the smaller
canvas roughly halved the idle cost. The RSS/PSS figures are from the same
smaller-window build and are dominated by WebKitGTK. The event-flood row was
measured on the earlier 300 px build; the bridge path is unchanged, and the
absolute RSS baseline differs slightly between runs.

### What the numbers mean

- The CPU cost is dominated by the webview drawing and compositing the animated
  window under software rendering, not by event handling. During the event flood
  the process tree stayed near 3% while processing ~115 events/s, and the socket
  never buffered unbounded data. Shrinking the window and the sprite brought the
  working state under the 5% target on this display.
- RSS is inflated by shared WebKitGTK libraries. PSS (174 MiB) is the fairer
  figure; even so it exceeds the 150 MiB target. The main Rust process alone is
  69 MiB PSS.
- Hiding KAGE drops the tree to 0.45% of one core because the creature component
  is unmounted and its animation timer is torn down. This was measured during
  development with a click helper that has since been removed from the
  repository; the behaviour is now covered by the UI check
  (`draw loop pauses while the window is hidden`), but the CPU figure has not
  been re-measured since that change.

## Changes made because of these measurements

1. **Animation cancels cleanly.** A tick that is already queued when the
   component is torn down used to reschedule itself, keeping the draw loop alive.
   A cancellation flag now stops it, so pausing really pauses.
2. **Identical frames are not redrawn.** The renderer skips a frame when the
   selected sprite frame has not changed (noticeable at high animation intensity
   and in reduced-motion mode).
3. **Hidden means stopped.** Hiding the window unmounts the creature and its
   timer instead of animating an invisible canvas.

## Not measured

- **Event-to-visible-state latency.** There is no timestamp inside the webview
  that could be read without adding production instrumentation, and the
  synthetic-input helper used for earlier window tests was removed by request.
  The bridge work per event is small (validation + an emitted Tauri event), but
  the end-to-end figure is unverified.
- **GPU utilisation.** KAGE does not request GPU acceleration; the test display
  rendered in software. No per-process GPU numbers are claimed.
- **Long-duration soak (hours).** The flood covered 26 s plus idle windows; a
  multi-hour soak has not been run.
- **A compositor-enabled desktop session.** Transparency, always-on-top and
  compositing cost on GNOME/COSMIC are unverified beyond the window hints.

## Reproducing

```bash
# release build
npm run build --workspace @kage/desktop
cd apps/desktop/src-tauri && cargo build --release

# start it on a private display and drive it with the simulator
Xvfb :99 -screen 0 1200x800x24 &
DISPLAY=:99 XDG_RUNTIME_DIR=/tmp/kage-run ./target/release/kage &
node scripts/simulate-events.mjs --socket /tmp/kage-run/kage/kage.sock \
  --token /tmp/kage-run/kage/token
```

Sample CPU with the commands described in *Method* (`/proc/<pid>/stat`,
`CLK_TCK`) rather than `top`, so the result is comparable.
