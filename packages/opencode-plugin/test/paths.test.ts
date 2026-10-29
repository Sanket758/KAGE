import { describe, expect, it } from "vitest";
import { resolveBridgePaths } from "../src/paths.js";

describe("resolveBridgePaths", () => {
  it("uses XDG_RUNTIME_DIR on unix", () => {
    const p = resolveBridgePaths({ XDG_RUNTIME_DIR: "/run/user/42", HOME: "/home/u" } as NodeJS.ProcessEnv);
    expect(p.runtimeDir).toBe("/run/user/42/kage");
    expect(p.socketPath).toBe("/run/user/42/kage/kage.sock");
    expect(p.tokenPath).toBe("/run/user/42/kage/token");
    expect(p.endpointKind).toBe("unix");
  });

  it("honours KAGE_SOCKET_PATH override", () => {
    const p = resolveBridgePaths({ KAGE_SOCKET_PATH: "/tmp/custom.sock", KAGE_TOKEN_PATH: "/tmp/custom.token" } as NodeJS.ProcessEnv);
    expect(p.socketPath).toBe("/tmp/custom.sock");
    expect(p.tokenPath).toBe("/tmp/custom.token");
    expect(p.endpointKind).toBe("unix");
  });

  it("override endpoint kind is tcp on windows", () => {
    const p = resolveBridgePaths({ KAGE_SOCKET_PATH: "C:\\kage\\k.sock" } as NodeJS.ProcessEnv, "win32");
    expect(p.endpointKind).toBe("tcp");
  });

  it("uses LOCALAPPDATA on windows", () => {
    const base = "C:\\Users\\u\\AppData\\Local";
    const p = resolveBridgePaths({ LOCALAPPDATA: base, USERPROFILE: "C:\\Users\\u" } as NodeJS.ProcessEnv, "win32");
    expect(p.runtimeDir).toBe(base + "/kage");
    expect(p.socketPath).toBe(base + "/kage/kage.port");
    expect(p.tokenPath).toBe(base + "/kage/token");
    expect(p.endpointKind).toBe("tcp");
  });

  it("falls back to USERPROFILE AppData Local on windows when LOCALAPPDATA is unset", () => {
    const p = resolveBridgePaths({ USERPROFILE: "C:\\Users\\u" } as NodeJS.ProcessEnv, "win32");
    expect(p.runtimeDir).toBe("C:\\Users\\u/AppData/Local/kage");
    expect(p.endpointKind).toBe("tcp");
  });
});