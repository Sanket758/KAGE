# Feedback for the KAGE implementation

## Product direction

- The user wants a cute, lightweight visual companion for OpenCode: a small character that makes agent status legible at a glance.
- **Current preference (supersedes the earlier cloud-cat choice):** the cosmic familiar shown in [`mascot-ideas/Screenshot_2026-10-23_11-50-04.png`](mascot-ideas/Screenshot_2026-10-23_11-50-04.png). Use this as the primary art-direction reference and keep refining with the user before calling KAGE's final original art.
- The user wants KAGE to be a passive status visualization only. The mascot must not be clickable, draggable, focusable, or react to hover; remove the click-to-open details behavior and drag affordance. It should only reflect OpenCode status. Keep the compact floating character on a genuinely transparent background, with no always-visible status card or rounded outline. Do not expose interactive controls through the mascot.
- The Clawd-on-Desk reference is useful for how a tiny pet can communicate state through distinct poses (idle, thinking, typing, building). Use it as interaction inspiration; do not copy Clawd, Calico, Cloudling, or their sprite artwork. The upstream README says the theme artwork has separate rights and is not covered by the source-code license: https://github.com/rullerzhou-afk/clawd-on-desk#license.

## Statuses to make obvious

- At minimum show idle, thinking/working, active tool, and web search distinctly. When OpenCode reports a tool such as web search, use a clear “Searching the web” cue rather than only a generic “Running tool” state.
- Keep the character as the primary status display. If a text label is used, keep it brief and secondary (for example on hover/click), not a permanent large card.
- Permission-waiting and error states can have restrained, recognizable expressions/indicators. KAGE must only report status; it must not approve, deny, or remotely control anything.

## Animation and resource budget

- Prefer a small original sprite with a few reusable frames and simple motion (gentle hover/bob, blink, modest state-specific pose changes). Avoid large animated backdrops, video, WebGL, Live2D, or a large pile of unique frames.
- Reuse the existing low-resolution canvas/frame approach where practical; draw only when the visible frame changes, pause animation work when hidden, and respect reduced-motion settings.
- Keep the window content-sized around the mascot, with transparent margins only as needed for animation. Do not reserve a full-screen or oversized dark canvas for a tiny pet.
- Historical cloud-cat concepts only; they are no longer the current art direction. References:
  - `/home/sanket758/.codex/generated_images/01a167fb-a11d-7e80-b115-e1e351e661b9/exec-991b68e5-7232-4794-a179-9087ecaa6060.png` (cloud-cat character)
  - `/home/sanket758/.codex/generated_images/01a167fb-a11d-7e80-b115-e1e351e661b9/exec-4e6391a9-7e2d-4068-b1b7-d23961a195d6.png` (idle-loop concept strip)

## Explicit non-goal

- **No remote control or input injection.** The user previously asked to remove that feature from the spec and agreed to its removal. Do not add portal-based keyboard/mouse control, approval controls, or related permissions while working on the visual companion.

## Scope focus

Keep the initial build focused on OpenCode status visualization and the compact character. The user is interested in using the other mascot concepts for subagents later, so keep mascot identity/state art separable where practical, but defer full multi-agent support, theme marketplaces, remote approvals, dashboards, and other Clawd features.

## Clawd-on-Desk implementation comparison

Inspected the current `main` source on 2026-10-23. Useful reference files:

- [Theme template](https://github.com/rullerzhou-afk/clawd-on-desk/blob/main/themes/template/theme.json) maps named agent states to separate SVG/GIF/APNG assets.
- [Cloudling theme manifest](https://github.com/rullerzhou-afk/clawd-on-desk/blob/main/themes/cloudling/theme.json) and [Cloudling idle SVG](https://github.com/rullerzhou-afk/clawd-on-desk/blob/main/themes/cloudling/assets/cloudling-idle.svg) show layered vector art and per-theme state configuration.
- [Renderer](https://github.com/rullerzhou-afk/clawd-on-desk/blob/main/src/renderer.js) handles swapping state assets, pausing animation for low-power states, and optional discrete sampling of CSS animation.

### What makes the animation feel polished

- The pet is drawn as layered, expressive art, then each state gets its own authored pose/action (thinking, typing, building, sleeping, etc.). The visual difference comes mostly from the character art and staging, not simply from a high frame count.
- Assets are self-contained by state. The theme manifest selects the right art; the renderer handles switching. SVG, GIF, and APNG are supported, so a theme can use the format that suits its artwork.
- The Cloudling idle SVG separates the body and eyes into groups. Its embedded script animates breathing, eye tracking, blink, subtle rotation/scale, and eye-color flow with `requestAnimationFrame`. This is capable and expressive but runs a continuous JavaScript animation loop while active.
- Clawd also has low-power handling: CSS/SVG animation can be paused in sleep states, and optional idle animations can pause after inactivity when low-power idle mode is enabled. Scripted SVGs expose a pause hook. Do not assume the reference is always cheaper: its Cloudling idle loop is more involved than KAGE's discrete frames.
- The reference uses transparent pet rendering and separates hit testing from visual rendering. Its broader architecture supports many agents, sessions, modes, themes, and interactions; KAGE does not need that whole product surface.

### Comparison with current KAGE code

- KAGE uses a `40×40` indexed pixel canvas. Animation poses are built as reusable frames, converted once to cached small canvases, then enlarged with nearest-neighbor scaling. `Creature.svelte` samples the current state on a timer and avoids redrawing when the frame has not changed. This is a strong low-resource base, but the fixed pixel silhouette and small discrete pose changes limit the richer, softer movement the user liked.
- KAGE's current animation loop skips drawing while `document.hidden`, but still schedules the next timeout. Consider cancelling and restarting that timer on visibility changes so a hidden pet does no periodic animation work.
- The current screenshot's always-visible details card and large dark surface are a separate layout issue from the animation engine. Keep the default surface to the transparent, content-sized mascot; show status text/details only on demand.

### Suggested KAGE direction

- Keep KAGE's OpenCode plugin, event reducer, and status data. Improve the visual layer only.
- Use the user's selected cosmic familiar direction, with separate readable poses for idle, thinking, working/tool use, web search, and attention/error. Distinct authored pose changes matter more than adding dozens of nearly identical frames.
- Create original layered SVG art with a few independent groups (character body, face, limbs/cape, and small celestial accents) and restrained CSS transform/opacity animation. Keep the asset static where possible; avoid a permanent custom JavaScript `requestAnimationFrame` loop, complex filters on an oversized surface, and 60 fps work that the user does not need.
- Pause animation when hidden and during deep idle; honor reduced motion. Keep the floating window small and transparent, with no permanent panel behind the character.
- Treat Clawd's rendering and state-mapping patterns as reference only. Do not copy its source implementation or theme artwork into KAGE without a deliberate license review: the repo's [README](https://github.com/rullerzhou-afk/clawd-on-desk#license) says source is AGPL-3.0 while bundled artwork has separate rights.

## Additional mascot inspiration from the user

The user shared reference sheets in `mascot-ideas/`. The user has now explicitly selected the cosmic familiar shown in `mascot-ideas/Screenshot_2026-10-23_11-50-04.png` as the current visual preference; this supersedes the previous cloud-cat preference.

- The celestial familiar sheets (`Gemini_Generated_Image_74finr74finr74fi*.jpeg`) keep one recognizable dark, round, starry character while changing pose and small props for sleep, search, debugging, celebration, reading, and error. The strongest lesson is **one stable silhouette plus specific expressive actions**.
- Other directions show a compact blue pixel robot (`Gemini_Generated_Image_f83cq3f83cq3f83c.jpeg`), a starry owl/familiar (`Gemini_Generated_Image_f83cq3f83cq3f83c (3).jpeg`), a very simple cream cloud creature (`Gemini_Generated_Image_f18lrof18lrof18l.jpeg`), an origami-like geometric mascot (`Gemini_Generated_Image_hitq6phitq6phitq.jpeg`), and a jellyfish-in-a-bottle character (`Gemini_Generated_Image_hitq6phitq6phitq (1).jpeg`).
- KAGE art direction: create an original compact cosmic familiar in the selected sheet's visual direction: deep navy/purple character, warm star-like face/light, a small halo or celestial accent, and soft glow details. Use state-specific poses/props (for example a small lens for web search, a thought puff for thinking, a simple build motif, and an expressive celebration/error pose). Keep the character legible when small; omit the sheet's white boards and labels, and keep the halo/effects compact so the mascot still reads as a standalone floating character.
- Use the sheets to communicate state variation and color/pose ideas only. Produce original KAGE art; do not trace or import Clawd theme artwork.

### Generated animation prototypes

Transparent four-frame GIF previews were generated from the selected cosmic familiar direction. They are concept assets for review, not final production art; the source strips have some generated edge artifacts and should be refined before shipping. They are in [`art-prototypes/cosmic-familiar/`](art-prototypes/cosmic-familiar/), with a brief file/state map in its `README.md`:

- `kage-idle.gif` — subtle floating/sparkle idle
- `kage-thinking.gif` — thinking gesture with thought cue
- `kage-searching.gif` — magnifying-glass search cue
- `kage-typing.gif` — typing at a small holographic keyboard
- `kage-running.gif` — running in place with a trailing cape
- `kage-working-sort.gif` — tapping/sorting tiny holographic glyphs
- `kage-hurray.gif` — short completion celebration; play once, then transition to idle
- `kage-waiting.gif` — open-palm pose and message bubble for waiting on user input
- `kage-error.gif` — concerned pose with a small alert symbol
- Matching `*-source-strip.png` files preserve each four-frame source sheet.

The GIF previews use 256×256 transparent frames. Typing, running, and sorting are variations for generic active work; cycle among them occasionally/randomly while the status remains working, rather than switching animation on every render. Keep web search as its own tool-specific animation/state. Hurray should play once after a task completes and then return to idle. Waiting should remain until input resumes; error should remain until cleared or superseded. Treat all generated art as visual direction that can be redrawn/refined into original lightweight assets, and keep the displayed character small.
