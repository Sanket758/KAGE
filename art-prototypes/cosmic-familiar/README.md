# Cosmic familiar animation prototypes

Transparent 256×256, four-frame GIF previews and their higher-resolution source strips. These are review assets, not polished production art.

## Files

- `kage-idle.gif` — quiet idle loop
- `kage-thinking.gif` — thinking loop
- `kage-searching.gif` — web-search loop
- `kage-typing.gif` — typing at a holographic keyboard
- `kage-running.gif` — running in place
- `kage-working-sort.gif` — sorting small holographic glyphs
- `kage-hurray.gif` — one-shot completion animation; transition to idle afterward
- `kage-waiting.gif` — waiting for user input
- `kage-error.gif` — error indicator
- Matching `*-source-strip.png` files contain the original four-frame generated strips.

For generic working status, rotate occasionally among typing, running, and sorting. Keep web search as its own state. Waiting persists until input resumes; error persists until cleared or superseded. Treat these as visual direction for the implementation and refine the art before shipping.
