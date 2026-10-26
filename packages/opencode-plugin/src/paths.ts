import { tmpdir } from "node:os";
import { join } from "node:path";

export interface BridgePaths {
  /** Directory that owns the socket and token file. */
  runtimeDir: string;
  socketPath: string;
  tokenPath: string;
}

/**
 * The desktop app and the plugin must agree on these paths.
 * Mirrors `resolve_bridge_paths` in the Tauri shell.
 */
export function resolveBridgePaths(env: NodeJS.ProcessEnv = process.env): BridgePaths {
  const override = env.KAGE_SOCKET_PATH;
  if (override) {
    const runtimeDir = override.slice(0, Math.max(0, override.lastIndexOf("/"))) || "/tmp";
    return {
      runtimeDir,
      socketPath: override,
      tokenPath: env.KAGE_TOKEN_PATH ?? join(runtimeDir, "token"),
    };
  }

  const uid = typeof process.getuid === "function" ? process.getuid() : 0;
  const base = env.XDG_RUNTIME_DIR || tmpdir();
  const runtimeDir = join(base, "kage");
  // Linux caps unix socket paths at 108 bytes; fall back to a short path.
  const socketPath =
    join(runtimeDir, "kage.sock").length <= 100
      ? join(runtimeDir, "kage.sock")
      : join("/tmp", `kage-${uid}.sock`);
  return { runtimeDir, socketPath, tokenPath: join(runtimeDir, "token") };
}
