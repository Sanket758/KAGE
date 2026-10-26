<script lang="ts">
  import { onMount } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import {
    applyEvent,
    createInitialState,
    DEFAULT_SETTINGS,
    parseKAGEEvent,
    setConnection,
    tick,
    type KAGESettings,
    type KAGEState,
  } from "@kage/core";
  import SpriteCreature from "./lib/SpriteCreature.svelte";
  import {
    getBridgeStatus,
    loadSettings,
    subscribeEvents,
    subscribeMoveMode,
    subscribeStatus,
  } from "./lib/bridge";

  let runtime = $state<KAGEState>(createInitialState());
  let settings = $state<KAGESettings>({ ...DEFAULT_SETTINGS });
  let moveMode = $state(false);

  const intensity = $derived(
    settings.animationIntensity === "low"
      ? 0.65
      : settings.animationIntensity === "high"
        ? 1.4
        : 1,
  );

  function startDrag(event: MouseEvent): void {
    if (!moveMode || event.button !== 0) return;
    void getCurrentWindow().startDragging();
  }

  async function onKeydown(event: KeyboardEvent): Promise<void> {
    if (!moveMode || event.key !== "Escape") return;
    moveMode = (await invoke<boolean>("set_move_mode", { enabled: false })) === true;
  }

  onMount(() => {
    let disposed = false;
    const cleanups: Array<() => void> = [];

    const ticker = setInterval(() => {
      runtime = tick(runtime, Date.now());
    }, 250);
    cleanups.push(() => clearInterval(ticker));

    const init = async () => {
      const loaded = await loadSettings();
      if (disposed) return;
      settings = loaded.settings;

      const status = await getBridgeStatus();
      if (disposed) return;
      runtime = setConnection(runtime, status, Date.now());

      const events = await subscribeEvents((payload) => {
        const event = parseKAGEEvent(payload);
        if (!event) return;
        runtime = applyEvent(runtime, event, Date.now());
      });
      if (disposed) {
        events();
        return;
      }
      cleanups.push(events);

      const statuses = await subscribeStatus((next) => {
        runtime = setConnection(runtime, next, Date.now());
      });
      if (disposed) {
        statuses();
        return;
      }
      cleanups.push(statuses);

      const moveModes = await subscribeMoveMode((enabled) => {
        moveMode = enabled;
      });
      if (disposed) {
        moveModes();
        return;
      }
      cleanups.push(moveModes);
    };
    void init();

    return () => {
      disposed = true;
      for (const cleanup of cleanups) cleanup();
    };
  });
</script>

<svelte:window onkeydown={onKeydown} />

<main
  class="app"
  class:move-mode={moveMode}
  data-character={runtime.character}
  aria-hidden="true"
  onmousedown={startDrag}
>
  <SpriteCreature
    character={runtime.character}
    scale={settings.scale}
    opacity={settings.opacity}
    reducedMotion={settings.reducedMotion}
    {intensity}
  />
  {#if moveMode}
    <div class="move-hint" aria-hidden="true">drag me · Esc pins</div>
  {/if}
</main>
