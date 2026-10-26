# KAGE — Idea

KAGE is a small character that shows the status of the current OpenCode session.
It should make it easy to glance at the mascot and tell whether OpenCode is
working, searching, waiting, finished, or has encountered an error.

## MVP direction

- One compact cosmic familiar, on a transparent background.
- Passive display only: no clicking, dragging, hover actions, panels, or controls.
- Use OpenCode's available session and tool events to select a matching pose.
- Keep animations lightweight and the local integration observe-only.

| Session status | Character state |
| --- | --- |
| Idle | Idle |
| Working or using a tool | Working; small pose variations are fine |
| Web search | Searching |
| Waiting for user input or permission | Waiting |
| Error | Error |
| Genuine completion | Brief celebration, then idle |
| Connection unavailable | Disconnected |

Use the generated concepts in `art-prototypes/cosmic-familiar/` as visual
prototypes. They can be simplified to fit KAGE's existing renderer.

## Keep out of the MVP

No dashboard, interactive controls, settings panel, sound, theme marketplace,
or subagent mascot system. Multiple mascot ideas for subagents can be revisited
later if desired.

KAGE only observes OpenCode. It does not read prompts or source contents,
approve permissions, or control the computer.
