# Security

KAGE is a local desktop companion. It does not make outbound network requests and
has no account system or telemetry.

## Trust boundaries

| Boundary | Control |
| --- | --- |
| OpenCode plugin → desktop app | Unix domain socket in a user-only runtime directory, authenticated with a 32-byte random token stored mode 0600. |
| Socket frames | 8 KiB cap, NDJSON, strict JSON schema and event-type validation in Rust, re-validated in the UI. Invalid frames close the connection. |
| Socket abuse | Maximum 8 clients, 200 events/second per client, bounded plugin queue (128 events). |
| Desktop app → webview | Tauri IPC with a narrow capability set and a CSP that only allows bundled assets and IPC. |
| Settings file | Atomic writes with mode 0600; size and shape limits; corrupted input is discarded. |

## What KAGE does not access

- **Keyboard, mouse, or any other input.** KAGE registers no global shortcuts,
  hooks no input devices, injects no synthetic events, and has no autostart or
  automation behaviour beyond showing its own window. It never asks for remote
  desktop, accessibility-control, or screen-recording permission.
- **Your screen or window contents.** The app draws its own window; it does not
  capture the desktop, other windows, or the clipboard.
- Prompts, model responses, file contents, diffs, environment variables, or tool
  arguments. The plugin sends tool names, session ids, project directory, the file
  base name for `file.edited`, and OpenCode error messages.
- Other users' files or processes. It has no network listener and makes no
  outbound connections.

## Local token handling

The token is created fresh each time the desktop app starts, written with
`0600`, and never logged or embedded in source. The socket is created at mode
`0600`. A local process running as the same user could read the token file; this
is equivalent to that process already being able to read the user's files, and is
the standard model for local IPC. Binding to localhost alone is not considered
authentication.

## Reporting

Please open an issue in the project repository with a minimal reproduction and
avoid including tokens, project paths, or session content. There is no dedicated
security email or bounty program.
