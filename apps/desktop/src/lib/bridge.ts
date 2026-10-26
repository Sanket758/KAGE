import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  DEFAULT_SETTINGS,
  validateSettings,
  type KAGESettings,
  type ConnectionState,
} from "@kage/core";

const SETTINGS_KEY = "kage.settings.v1";

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function loadSettings(): Promise<{
  settings: KAGESettings;
  issues: string[];
}> {
  if (!isTauri()) {
    const raw = localStorage.getItem(SETTINGS_KEY);
    let parsed: unknown;
    try {
      parsed = raw ? JSON.parse(raw) : undefined;
    } catch {
      parsed = undefined;
    }
    return validateSettings(parsed);
  }
  try {
    const raw = await invoke<unknown>("get_settings");
    return validateSettings(raw);
  } catch {
    return { settings: { ...DEFAULT_SETTINGS }, issues: ["could not read settings"] };
  }
}

export async function getBridgeStatus(): Promise<ConnectionState> {
  if (!isTauri()) return "connecting";
  try {
    const value = await invoke<string>("get_bridge_status");
    return toConnectionState(value);
  } catch {
    return "connecting";
  }
}

export async function subscribeEvents(
  handler: (payload: unknown) => void,
): Promise<UnlistenFn> {
  if (!isTauri()) return () => {};
  return listen<unknown>("kage://event", (event) => handler(event.payload));
}

export async function subscribeStatus(
  handler: (status: ConnectionState) => void,
): Promise<UnlistenFn> {
  if (!isTauri()) return () => {};
  return listen<string>("kage://status", (event) => handler(toConnectionState(event.payload)));
}

export function toConnectionState(value: unknown): ConnectionState {
  if (value === "connected" || value === "disconnected") return value;
  return "connecting";
}
