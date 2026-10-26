<script lang="ts">
  import { onMount } from "svelte";
  import type { CharacterState } from "@kage/core";

  /**
   * Sprite-skin renderer. Skins live at `skins/<id>/` with a manifest
   * (`kagekin-sprite-skin/1`) describing per-state frame counts, durations,
   * loop behavior, and the runtime-character -> sprite-state map. The tables
   * below are compile-time defaults so the mascot renders immediately and
   * survives a missing/corrupt skin; hydration from the manifest replaces
   * them once fetched.
   */

  interface Props {
    character: CharacterState;
    skin: string;
    scale: number;
    opacity: number;
    reducedMotion: boolean;
    intensity: number;
  }

  let { character, skin, scale, opacity, reducedMotion, intensity }: Props = $props();

  const CSS_WIDTH = 192;
  const CSS_HEIGHT = 176;

  interface SpriteStateConfig {
    frames: number;
    durationMs: number;
    loop: boolean;
    holdLast: boolean;
  }
  interface SkinManifest {
    frameSize: number;
    states: Record<string, SpriteStateConfig>;
    characterMap: Record<string, string>;
  }

  const DEFAULT_STATES = {
    sleeping: { frames: 8, durationMs: 260, loop: true, holdLast: false },
    searching: { frames: 8, durationMs: 160, loop: true, holdLast: false },
    debugging: { frames: 8, durationMs: 180, loop: true, holdLast: false },
    celebrating: { frames: 8, durationMs: 120, loop: false, holdLast: true },
    reading: { frames: 8, durationMs: 220, loop: true, holdLast: false },
    error: { frames: 8, durationMs: 300, loop: true, holdLast: false },
  } satisfies Record<string, SpriteStateConfig>;

  /** CharacterState -> sprite state. Kept in sync with the kagekin manifest. */
  const DEFAULT_MAP: Record<string, string> = {
    sleeping: "sleeping",
    idle: "reading",
    waking: "reading",
    working: "debugging",
    tool_activity: "searching",
    searching: "searching",
    attention: "error",
    error: "error",
    celebrating: "celebrating",
    disconnected: "sleeping",
  };

  let states = $state<Record<string, SpriteStateConfig>>(DEFAULT_STATES);
  let characterMap = $state<Record<string, string>>(DEFAULT_MAP);
  // The legacy `mascot/` path keeps working until hydration succeeds.
  let assetBase = $state("mascot");
  let missing = $state(false);

  const manifestCache = new Map<string, SkinManifest | null>();
  let hydration = 0;

  function normalizeManifest(raw: unknown): SkinManifest | null {
    if (typeof raw !== "object" || raw === null) return null;
    const manifest = raw as Record<string, unknown>;
    if (typeof manifest.states !== "object" || manifest.states === null) return null;
    const parsedStates: Record<string, SpriteStateConfig> = {};
    for (const [name, value] of Object.entries(manifest.states as Record<string, unknown>)) {
      if (typeof value !== "object" || value === null) return null;
      const entry = value as Record<string, unknown>;
      const frames = entry.frames;
      const durationMs = entry.durationMs;
      if (typeof frames !== "number" || frames < 1 || frames > 64) return null;
      if (typeof durationMs !== "number" || durationMs < 30 || durationMs > 5000) return null;
      parsedStates[name] = {
        frames: Math.round(frames),
        durationMs: Math.round(durationMs),
        loop: entry.loop !== false,
        holdLast: entry.holdLast === true,
      };
    }
    if (Object.keys(parsedStates).length === 0) return null;
    const characterMap: Record<string, string> = {};
    if (typeof manifest.characterMap === "object" && manifest.characterMap !== null) {
      for (const [from, to] of Object.entries(manifest.characterMap as Record<string, unknown>)) {
        if (typeof to === "string" && parsedStates[to] !== undefined) characterMap[from] = to;
      }
    }
    return {
      frameSize: typeof manifest.frameSize === "number" ? manifest.frameSize : 160,
      states: parsedStates,
      characterMap,
    };
  }

  async function fetchManifest(path: string): Promise<SkinManifest | null> {
    if (manifestCache.has(path)) return manifestCache.get(path) ?? null;
    let result: SkinManifest | null = null;
    try {
      const response = await fetch(path);
      if (response.ok) result = normalizeManifest(await response.json());
    } catch {
      result = null;
    }
    manifestCache.set(path, result);
    return result;
  }

  /**
   * Hydrate the requested skin; fall back to the default skin, then the
   * legacy `mascot/` layout, then the compile-time defaults. The sequence
   * token discards stale responses when the skin changes mid-flight.
   */
  async function hydrate(requested: string): Promise<void> {
    const token = ++hydration;
    const candidates: Array<{ id: string; path: string }> = [
      { id: requested, path: `skins/${requested}/manifest.json` },
    ];
    if (requested !== "kagekin") {
      candidates.push({ id: "kagekin", path: "skins/kagekin/manifest.json" });
    }
    candidates.push({ id: "legacy", path: "mascot/manifest.json" });

    let resolved: SkinManifest | null = null;
    let resolvedId = "legacy";
    for (const candidate of candidates) {
      const manifest = await fetchManifest(candidate.path);
      if (token !== hydration) return;
      if (manifest) {
        resolved = manifest;
        resolvedId = candidate.id;
        break;
      }
    }

    missing = false;
    if (resolved) {
      states = resolved.states;
      characterMap = Object.keys(resolved.characterMap).length
        ? resolved.characterMap
        : DEFAULT_MAP;
      assetBase = resolvedId === "legacy" ? "mascot" : `skins/${resolvedId}`;
    } else {
      states = DEFAULT_STATES;
      characterMap = DEFAULT_MAP;
      assetBase = "mascot";
      missing = true;
    }
    previous = null;
    lastDrawn = null;
    draw(true);
  }

  const loadedBitmaps = new Map<string, Promise<ImageBitmap | null>>();

  function bitmap(state: string, index: number, pose: boolean): Promise<ImageBitmap | null> {
    const path = pose
      ? `${assetBase}/${state}/pose.png`
      : `${assetBase}/${state}/frames/frame_${String(index).padStart(3, "0")}.png`;
    let entry = loadedBitmaps.get(path);
    if (!entry) {
      entry = fetch(path)
        .then((response) => (response.ok ? response.blob() : Promise.reject(new Error(path))))
        .then((blob) => createImageBitmap(blob))
        .catch(() => {
          missing = true;
          return null;
        });
      loadedBitmaps.set(path, entry);
    }
    return entry;
  }

  let canvas: HTMLCanvasElement;
  let since = Date.now();
  let previous: CharacterState | null = null;
  let lastDrawn: ImageBitmap | null = null;
  let interval = 260;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let destroyed = false;

  function draw(force = false): void {
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const sprite = characterMap[character] ?? Object.keys(states)[0] ?? "sleeping";
    const config = states[sprite] ?? Object.values(states)[0] ?? DEFAULT_STATES.sleeping;
    const elapsed = Date.now() - since;
    const still = reducedMotion || missing;
    const index = still
      ? -1
      : config.loop
        ? Math.floor(elapsed / config.durationMs) % config.frames
        : Math.min(Math.floor(elapsed / config.durationMs), config.frames - 1);
    bitmap(sprite, Math.max(0, index), still).then((frame) => {
      if (destroyed || !frame) return;
      if (!force && frame === lastDrawn) return;
      lastDrawn = frame;
      // The frames are square (160px source) inside a 192x176 window: fit by
      // height, centered. Integer-ish scaling keeps the upscale crisp.
      const fit = Math.min(canvas.width, canvas.height) * 0.94 * scale;
      const drawWidth = fit;
      const drawHeight = fit;
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.globalAlpha = opacity;
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.drawImage(
        frame,
        Math.round((canvas.width - drawWidth) / 2),
        Math.round((canvas.height - drawHeight) / 2),
        Math.round(drawWidth),
        Math.round(drawHeight),
      );
      context.globalAlpha = 1;
    });
  }

  function stop(): void {
    running = false;
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function schedule(): void {
    if (destroyed || !running) return;
    timer = setTimeout(() => {
      timer = null;
      if (destroyed || !running) return;
      draw();
      schedule();
    }, interval);
  }

  function start(): void {
    if (destroyed || running || document.hidden) return;
    running = true;
    schedule();
  }

  function onVisibility(): void {
    if (document.hidden) {
      stop();
    } else {
      draw(true);
      start();
    }
  }

  onMount(() => {
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      destroyed = true;
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  });

  $effect(() => {
    const activeState = character;
    const reduce = reducedMotion;
    const speed = intensity;
    const pixelRatio = Math.max(1, window.devicePixelRatio || 1);
    const width = Math.round(CSS_WIDTH * pixelRatio);
    const height = Math.round(CSS_HEIGHT * pixelRatio);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    if (activeState !== previous) {
      previous = activeState;
      since = Date.now();
      lastDrawn = null;
    }
    const sprite = characterMap[activeState] ?? Object.keys(states)[0] ?? "sleeping";
    const frameMs = (states[sprite] ?? DEFAULT_STATES.sleeping).durationMs;
    interval = reduce
      ? Math.max(500, frameMs * 2)
      : Math.max(60, Math.round(frameMs / Math.max(0.5, speed)));
    draw(true);
    if (reduce) {
      stop();
    } else {
      stop();
      start();
    }
  });

  $effect(() => {
    void hydrate(skin);
  });
</script>

<canvas
  bind:this={canvas}
  class="creature"
  style:width="{CSS_WIDTH}px"
  style:height="{CSS_HEIGHT}px"
  aria-hidden="true"
></canvas>
