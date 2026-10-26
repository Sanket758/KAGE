# Architecture

KAGE is split into three independently testable layers plus a desktop shell.

```text
┌──────────────────┐   hooks/events   ┌────────────────────┐
│ OpenCode runtime │ ───────────────▶ │ @kage/opencode-plugin│
└──────────────────┘                  └─────────┬──────────┘
                                                 │ NDJSON over Unix socket
                                                 │ hello(token) → welcome
                                                 ▼
                                      ┌────────────────────┐
                                      │ Tauri 2 shell (Rust)│
                                      │ auth · validation   │
                                      │ rate limiting       │
                                      └─────────┬──────────┘
                                                 │ kage://event / kage://status
                                                 ▼
                                      ┌────────────────────┐
                                      │ Svelte UI           │
                                      │ reducer → sprites   │
                                      └────────────────────┘
```

## Packages

| Path | Responsibility |
| --- | --- |
| `packages/core` | Internal event contract, runtime validation, OpenCode normalization, deterministic reducer, settings validation, UI selectors. No DOM, no I/O. |
| `packages/opencode-plugin` | OpenCode hook adapter and reconnecting bridge client. Bundled to one ESM file for installation. |
| `packages/art` | Original palette, procedural pixel frames, animation table, canvas helpers. |
| `apps/desktop` | Svelte 5 UI (creature, details, settings) and the Tauri 2 shell in `src-tauri`. |

## Event contract

The internal contract is owned by KAGE, not OpenCode:

```ts
type KAGEEvent = {
  type:
    | "session_active" | "session_idle" | "session_error" | "session_completed"
    | "tool_started" | "tool_finished" | "permission_requested"
    | "permission_resolved" | "file_edited";
  sessionId?: string;
  timestamp: number; // epoch ms, from the producer
  metadata?: {
    toolName?: string;
    status?: string;
    detail?: string;
    directory?: string;
    project?: string;
  };
};
```

`file_edited` is a KAGE extension used to produce the short pixel burst when
OpenCode reports `file.edited`. Everything else maps onto the documented states.

### OpenCode mapping

| OpenCode source | KAGE event | Notes |
| --- | --- | --- |
| `session.status` (`busy`) | `session_active` | |
| `session.status` (`idle`) | `session_idle` | Only authoritative idle source |
| `session.status` (`retry`) | `session_error` | Retry is a warning, not success |
| `session.idle` | `session_idle` | |
| `session.error` | `session_error` | Message read from `error.data.message`, truncated |
| `session.created` | `session_active` | Carries project directory |
| `session.deleted` | `session_idle` | Session gone, not completed |
| `session.compacted` | `session_active` | Compaction counts as activity |
| `permission.asked` / `permission.updated` | `permission_requested` | |
| `permission.replied` | `permission_resolved` | KAGE never replies itself |
| `file.edited` | `file_edited` | Sends only the file's base name |
| `tool.execute.before` hook | `tool_started` | Tool name only; arguments are never read |
| `tool.execute.after` hook | `tool_finished` | Success/failure is not exposed by this hook |
| `session.completed` | `session_completed` | Emitted only if the installed version provides it |

Tool outcome caveat: `tool.execute.after` runs for successful and failed tools
alike. KAGE therefore does not claim a tool succeeded from this hook alone.

## State machine

`applyEvent` and `tick` in `packages/core/src/reducer.ts` are pure functions.

**Character priority** (highest first): `disconnected`, `attention`, `error`,
`celebrating`, `waking`, `working` / `tool_activity`, `idle`, `sleeping`.

Rules:

1. A pending permission always shows `attention`, even over an error.
2. Errors stay visible until the owning session reports new activity; they are
   not cleared by an idle timeout.
3. A completion triggers one celebration per cooldown window (6 s), never a loop.
4. `session.idle` does **not** imply success and never celebrates.
5. `session_active`, `tool_started` and file edits clear a previous error for
   that session (recovery).
6. Waking plays only when leaving rest (`sleeping`/`idle`). Reconnecting resumes
   the prior state instead of replaying a wake-up.
7. Work-state changes are held for 200 ms to prevent flicker from fast tools.
8. Rapid file edits extend one short pulse rather than queueing reactions.
9. A tool finishing decrements a floored counter; it never proves the session
   is idle.
10. The creature sleeps only after 5 minutes with no activity and no busy,
    error, permission or celebration state.

**Primary session:** pending permissions first, then the session with the most
recent real activity (tool/permission/completion), then a deterministic id
tie-break. Idle events update only their own session and never mark another
session idle. Sessions unseen for 30 minutes are dropped unless a permission is
still waiting.

**Durability:** the reducer is deterministic for a sequence of events and `now`
values, which is what the unit tests exercise. `tick` is called four times per
second by the UI for relative times and sleep/expiry transitions.

## Local bridge

- Transport: Unix domain socket under `$XDG_RUNTIME_DIR/kage/`, falling back to
  `/tmp/kage-<uid>.sock` when the path is too long.
- Authentication: 32 random bytes from `/dev/urandom`, hex encoded, written
  mode 0600 by the desktop app. The plugin reads it per connection attempt.
  Localhost alone is not treated as authentication.
- Protocol: first frame is
  `{"type":"hello","version":1,"token":…,"directory":…,"pid":…}`; the app replies
  `{"type":"welcome","version":1}`. Every later frame is one JSON event per line.
- Validation: 8 KiB frame cap, strict type/timestamp/session/metadata checks,
  JSON errors close the connection.
- Abuse limits: 8 concurrent clients, 200 events/second per client, bounded
  queue (128 events) in the plugin.
- Availability: the plugin connects eagerly, retries with exponential backoff
  (0.5 s → 10 s, ±20 % jitter) and unrefs its timers. A missing desktop app is
  a no-op.
- Recovery: a restarted desktop app creates a fresh token and socket; the plugin
  reads the new token on its next attempt. The UI keeps the last known state
  while disconnected and resumes it on reconnect.

## Desktop shell

- Tauri 2, frameless, 200 × 200 px when resting, transparent, always on top,
  skipped from the taskbar. The window widens to 300 px and grows vertically
  while the details or settings card is open, then returns to 200 × 200.
- The creature is a 40 × 40 pixel sprite drawn from an authored silhouette row
  table in `packages/art/src/creature.ts`, scaled with nearest-neighbour to
  about 160 px. There is no bitmap asset to load at runtime.
- Dragging uses the explicit drag strip; clicking the creature toggles details.
- Window position is restored only if it still intersects a monitor.
- Settings are written atomically with mode 0600; corrupted files fall back to
  validated defaults.
- Autostart is an XDG `~/.config/autostart/kage.desktop` entry.
- CSP limits the webview to bundled assets and IPC; no remote code.

## Privacy boundaries

KAGE never reads prompts, responses, file contents or tool arguments. It sends
the tool name, session id, project directory, file base name and error message
that OpenCode already produced. No network calls are made by KAGE.
