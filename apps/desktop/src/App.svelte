<script lang="ts">
  import { onMount } from "svelte";
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
  import { getBridgeStatus, loadSettings, subscribeEvents, subscribeStatus } from "./lib/bridge";

  let runtime = $state<KAGEState>(createInitialState());
  let settings = $state<KAGESettings>({ ...DEFAULT_SETTINGS });

  const intensity = $derived(
    settings.animationIntensity === "low"
      ? 0.65
      : settings.animationIntensity === "high"
        ? 1.4
        : 1,
  );

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
    };
    void init();

    return () => {
      disposed = true;
      for (const cleanup of cleanups) cleanup();
    };
  });
</script>

<main class="app" data-character={runtime.character} aria-hidden="true">
  <SpriteCreature
    character={runtime.character}
    scale={settings.scale}
    opacity={settings.opacity}
    reducedMotion={settings.reducedMotion}
    {intensity}
  />
</main>
