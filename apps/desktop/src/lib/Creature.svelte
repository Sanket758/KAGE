<script lang="ts">
  import { onMount } from "svelte";
  import { ANIMATIONS, drawFrame, frameAt } from "@kage/art";
  import type { CharacterState } from "@kage/core";

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

  let canvas: HTMLCanvasElement;
  let since = Date.now();
  let previous: CharacterState | null = null;
  let lastFrame: unknown = null;
  let interval = 260;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let destroyed = false;

  function draw(force = false): void {
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const frame = frameAt(character, Date.now() - since, intensity, reducedMotion);
    if (!force && frame === lastFrame) return;
    lastFrame = frame;
    const pixelRatio = Math.max(1, window.devicePixelRatio || 1);
    const maxPixel = Math.floor((Math.min(canvas.width, canvas.height) * 0.94) / frame.width);
    const pixel = Math.max(2, Math.min(maxPixel, Math.round(4 * scale * pixelRatio)));
    const drawWidth = frame.width * pixel;
    const drawHeight = frame.height * pixel;
    context.clearRect(0, 0, canvas.width, canvas.height);
    drawFrame(context, frame, {
      x: Math.round((canvas.width - drawWidth) / 2),
      y: Math.round((canvas.height - drawHeight) / 2),
      scale: pixel,
      alpha: opacity,
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
    // One timer and one visibility listener live for the whole component, so a
    // hidden mascot does no periodic animation work and no old loop can leak.
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
      lastFrame = null;
    }
    const frameMs = ANIMATIONS[activeState].frameMs;
    interval = reduce
      ? Math.max(500, frameMs * 2)
      : Math.max(60, Math.round(frameMs / Math.max(0.5, speed)));
    draw(true);
    if (reduce) {
      stop();
    } else if (running) {
      // Restart with the new interval, keeping exactly one pending timer.
      stop();
      start();
    } else {
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
