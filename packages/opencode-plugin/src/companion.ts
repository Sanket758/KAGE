import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface CompanionLookup {
  env: NodeJS.ProcessEnv;
  exists: (path: string) => boolean;
  /** Defaults to process.platform; tests pin it explicitly. */
  platform?: NodeJS.Platform;
}

const DEFAULT_LOOKUP: CompanionLookup = {
  env: process.env,
  exists: existsSync,
  platform: process.platform,
};

/**
 * Locate the KAGE desktop companion without knowing how the user installed
 * it. First match wins:
 *   1. $KAGE_APP_PATH (explicit override)
 *   2. `kage` anywhere on PATH (deb / native installs; kage.exe on Windows)
 *   3. ~/.local/bin/KAGE.AppImage (Linux install.sh default)
 *   4. %LOCALAPPDATA%\Programs\KAGE\kage.exe (Windows NSIS per-user install)
 *   5. /usr/local/bin/kage, /usr/bin/kage (Linux system installs)
 * Returns null when nothing is installed; callers stay silent and keep
 * retrying on the normal bridge backoff.
 */
export function resolveCompanionCommand(
  lookup: CompanionLookup = DEFAULT_LOOKUP,
): string | null {
  const override = lookup.env.KAGE_APP_PATH;
  if (override !== undefined && override !== "") {
    return lookup.exists(override) ? override : null;
  }
  const isWindows = (lookup.platform ?? process.platform) === "win32";
  const onPath = findOnPath(isWindows ? "kage.exe" : "kage", lookup, isWindows);
  if (onPath) return onPath;
  const home = lookup.env.HOME ?? homedir();
  const localAppData = lookup.env.LOCALAPPDATA ?? join(home, "AppData", "Local");
  const candidates = isWindows
    ? [join(localAppData, "Programs", "KAGE", "kage.exe")]
    : [
        join(home, ".local", "bin", "KAGE.AppImage"),
        "/usr/local/bin/kage",
        "/usr/bin/kage",
      ];
  return candidates.find((candidate) => lookup.exists(candidate)) ?? null;
}

function findOnPath(
  command: string,
  lookup: CompanionLookup,
  isWindows: boolean,
): string | null {
  const pathVar = lookup.env.PATH ?? "";
  const separator = isWindows ? ";" : ":";
  const extensions = isWindows ? ["", ".exe"] : [""];
  for (const dir of pathVar.split(separator)) {
    if (!dir) continue;
    for (const extension of extensions) {
      const candidate = join(dir, command + extension);
      if (lookup.exists(candidate)) return candidate;
    }
  }
  return null;
}
