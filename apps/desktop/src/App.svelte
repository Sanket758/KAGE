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
    isTauri,
    loadSettings,
    subscribeEvents,
    subscribeMoveMode,
    subscribeStatus,
  } from "./lib/bridge";

  let runtime = $state<KAGEState>(createInitialState());
  let settings = $state<KAGESettings>({ ...DEFAULT_SETTINGS });
  let moveMode = $state(false);
  let menuOpen = $state(false);
  let skinList = $state<Array<{ id: string; name: string }>>([]);

  const intensity = $derived(
    settings.animationIntensity === "low"
      ? 0.65
      : settings.animationIntensity === "high"
        ? 1.4
        : 1,
  );

  function startDrag(event: MouseEvent): void {
    if (event.button !== 0 || menuOpen) return;
    void getCurrentWindow().startDragging();
  }

  async function onContextMenu(event: MouseEvent): Promise<void> {
    event.preventDefault();
    if (menuOpen) {
      menuOpen = false;
      return;
    }
    skinList = await loadSkinList();
    menuOpen = true;
  }

  async function loadSkinList(): Promise<Array<{ id: string; name: string }>> {
    try {
      const response = await fetch("skins/skins.json");
      if (!response.ok) throw new Error(String(response.status));
      const data = (await response.json()) as { skins?: unknown };
      if (!Array.isArray(data.skins)) throw new Error("no skins array");
      return data.skins
        .filter(
          (item): item is { id: string; name: string } =>
            typeof item === "object" &&
            item !== null &&
            typeof (item as { id?: unknown }).id === "string" &&
            /^[a-z0-9][a-z0-9-]{0,31}$/.test((item as { id: string }).id),
        )
        .map((item) => ({ id: item.id, name: String(item.name ?? item.id) }));
    } catch {
      return [];
    }
  }

  async function pickSkin(id: string): Promise<void> {
    menuOpen = false;
    settings = { ...settings, skin: id };
    if (!isTauri()) return;
    try {
      await invoke("save_settings", { settings });
    } catch {
      // Settings persistence is best-effort; the skin still hot-swaps.
    }
  }

  async function quit(): Promise<void> {
    menuOpen = false;
    if (!isTauri()) return;
    try {
      await invoke("quit_app");
    } catch {
      // ignore
    }
  }

  async function onKeydown(event: KeyboardEvent): Promise<void> {
    if (event.key === "Escape" && (moveMode || menuOpen)) {
      menuOpen = false;
      moveMode = (await invoke<boolean>("set_move_mode", { enabled: false })) === true;
    }
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
  oncontextmenu={onContextMenu}
>
  <SpriteCreature
    character={runtime.character}
    skin={settings.skin}
    scale={settings.scale}
    opacity={settings.opacity}
    reducedMotion={settings.reducedMotion}
    {intensity}
  />
  {#if menuOpen}
    <div class="menu" role="menu" aria-label="KAGE menu">
      {#if skinList.length > 0}
        <div class="menu-heading">skin</div>
        {#each skinList as entry (entry.id)}
          <button
            type="button"
            class="menu-item"
            class:active={entry.id === settings.skin}
            onclick={() => pickSkin(entry.id)}
          >
            {entry.name}{entry.id === settings.skin ? " ✓" : ""}
          </button>
        {/each}
      {/if}
      <button type="button" class="menu-item quit" onclick={quit}>Quit</button>
    </div>
  {:else if moveMode}
    <div class="move-hint" aria-hidden="true">drag me · Esc pins</div>
  {/if}
</main>
