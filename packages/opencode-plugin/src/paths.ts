import { tmpdir } from "node:os";
import { join } from "node:path";

export type EndpointKind = "unix" | "tcp";

export interface BridgePaths {
  /** Directory that owns the socket/token files. */
  runtimeDir: string;
  /** Unix: socket file path. Windows (tcp): path of the port file. */
  socketPath: string;
  tokenPath: string;
  /** How to reach the companion. Defaults to "unix" for overridden/test paths. */
  endpointKind?: EndpointKind;
}

/**
 * The desktop app and the plugin must agree on these paths.
 * Mirrors `resolve_bridge_paths` in the Tauri shell.
 */
export function resolveBridgePaths(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): BridgePaths {
  const override = env.KAGE_SOCKET_PATH;
  if (override) {
    const lastSlash = Math.max(override.lastIndexOf("/"), override.lastIndexOf("\\"));
    const runtimeDir = lastSlash >= 0 ? override.slice(0, lastSlash) : "/tmp";
    const isWindows = platform === "win32";
    return {
      runtimeDir,
      socketPath: override,
      tokenPath: env.KAGE_TOKEN_PATH ?? join(runtimeDir, "token"),
      endpointKind: isWindows ? "tcp" : "unix",
    };
  }

  if (platform === "win32") {
    // Loopback TCP: the companion binds 127.0.0.1 on an ephemeral port and
    // publishes it in kage.port next to the token.
    const base = env.LOCALAPPDATA ?? join(env.USERPROFILE ?? tmpdir(), "AppData", "Local");
    const runtimeDir = join(base, "kage");
    return {
      runtimeDir,
      socketPath: join(runtimeDir, "kage.port"),
      tokenPath: join(runtimeDir, "token"),
      endpointKind: "tcp",
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
  return { runtimeDir, socketPath, tokenPath: join(runtimeDir, "token"), endpointKind: "unix" };
}
