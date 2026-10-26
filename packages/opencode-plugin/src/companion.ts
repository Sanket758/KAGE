import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface CompanionLookup {
  env: NodeJS.ProcessEnv;
  exists: (path: string) => boolean;
}

const DEFAULT_LOOKUP: CompanionLookup = { env: process.env, exists: existsSync };

/**
 * Locate the KAGE desktop companion without knowing how the user installed
 * it. First match wins:
 *   1. $KAGE_APP_PATH (explicit override)
 *   2. `kage` anywhere on PATH (deb / native installs)
 *   3. ~/.local/bin/KAGE.AppImage (install.sh default)
 *   4. /usr/local/bin/kage, /usr/bin/kage
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
  const onPath = findOnPath("kage", lookup);
  if (onPath) return onPath;
  const home = lookup.env.HOME ?? homedir();
  const candidates = [
    join(home, ".local", "bin", "KAGE.AppImage"),
    "/usr/local/bin/kage",
    "/usr/bin/kage",
  ];
  return candidates.find((candidate) => lookup.exists(candidate)) ?? null;
}

function findOnPath(command: string, lookup: CompanionLookup): string | null {
  const pathVar = lookup.env.PATH ?? "";
  for (const dir of pathVar.split(":")) {
    if (!dir) continue;
    const candidate = join(dir, command);
    if (lookup.exists(candidate)) return candidate;
  }
  return null;
}
