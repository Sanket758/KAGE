<script lang="ts">
  import { onMount } from "svelte";
  import type { CharacterState } from "@kage/core";

  /**
   * Sprite-skin renderer: draws the production KAGEKIN frame sheets
   * (public/mascot) extracted from the authored sprite sheet, instead of the
   * procedural pixel creature. Same contract as Creature.svelte.
   */

  interface Props {
    character: CharacterState;
    scale: number;
    opacity: number;
    reducedMotion: boolean;
    intensity: number;
  }

  let { character, scale, opacity, reducedMotion, intensity }: Props = $props();

  const CSS_WIDTH = 192;
  const CSS_HEIGHT = 176;

  interface SpriteStateConfig {
    frames: number;
    durationMs: number;
    loop: boolean;
    holdLast: boolean;
  }
  type SpriteState = keyof typeof STATE_CONFIG;

  const STATE_CONFIG = {
    sleeping: { frames: 8, durationMs: 260, loop: true, holdLast: false },
    searching: { frames: 8, durationMs: 160, loop: true, holdLast: false },
    debugging: { frames: 8, durationMs: 180, loop: true, holdLast: false },
    celebrating: { frames: 8, durationMs: 120, loop: false, holdLast: true },
    reading: { frames: 8, durationMs: 220, loop: true, holdLast: false },
    error: { frames: 8, durationMs: 300, loop: true, holdLast: false },
  } satisfies Record<string, SpriteStateConfig>;

  /** CharacterState -> sprite skin state. Kept in sync with mascot/manifest.json. */
  const CHARACTER_TO_SPRITE: Record<CharacterState, SpriteState> = {
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

  const loadedBitmaps = new Map<string, Promise<ImageBitmap | null>>();
  let missing = false;

  function bitmap(state: SpriteState, index: number, pose: boolean): Promise<ImageBitmap | null> {
    const path = pose
      ? `mascot/${state}/pose.png`
      : `mascot/${state}/frames/frame_${String(index).padStart(3, "0")}.png`;
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
    const sprite = CHARACTER_TO_SPRITE[character] ?? "sleeping";
    const config = STATE_CONFIG[sprite];
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
    const sprite = CHARACTER_TO_SPRITE[activeState] ?? "sleeping";
    const frameMs = STATE_CONFIG[sprite].durationMs;
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
</script>

<canvas
  bind:this={canvas}
  class="creature"
  style:width="{CSS_WIDTH}px"
  style:height="{CSS_HEIGHT}px"
  aria-hidden="true"
></canvas>
