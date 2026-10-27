import { describe, expect, it } from "vitest";
import { resolveCompanionCommand, type CompanionLookup } from "../src/companion.js";

function lookupFactory(
  existing: Set<string>,
  env: NodeJS.ProcessEnv = {},
  platform: NodeJS.Platform = "linux",
): CompanionLookup {
  return { env, exists: (path) => existing.has(path), platform };
}

describe("resolveCompanionCommand", () => {
  it("prefers the KAGE_APP_PATH override when it exists", () => {
    const lookup = lookupFactory(new Set(["/opt/kage/run"]), { KAGE_APP_PATH: "/opt/kage/run" });
    expect(resolveCompanionCommand(lookup)).toBe("/opt/kage/run");
  });

  it("returns null when the override is set but missing", () => {
    const lookup = lookupFactory(new Set(["/usr/bin/kage"]), { KAGE_APP_PATH: "/gone/kage" });
    expect(resolveCompanionCommand(lookup)).toBeNull();
  });

  it("finds kage on PATH before the AppImage fallback", () => {
    const lookup = lookupFactory(
      new Set(["/usr/bin/kage", "/home/u/.local/bin/KAGE.AppImage"]),
      { PATH: "/home/u/.local/bin:/usr/bin", HOME: "/home/u" },
    );
    expect(resolveCompanionCommand(lookup)).toBe("/usr/bin/kage");
  });

  it("falls back to ~/.local/bin/KAGE.AppImage", () => {
    const lookup = lookupFactory(new Set(["/home/u/.local/bin/KAGE.AppImage"]), {
      PATH: "/usr/local/bin:/usr/bin",
      HOME: "/home/u",
    });
    expect(resolveCompanionCommand(lookup)).toBe("/home/u/.local/bin/KAGE.AppImage");
  });

  it("checks the system install locations last", () => {
    const lookup = lookupFactory(new Set(["/usr/local/bin/kage"]), {
      PATH: "/usr/bin",
      HOME: "/home/u",
    });
    expect(resolveCompanionCommand(lookup)).toBe("/usr/local/bin/kage");
  });

  it("returns null when nothing is installed", () => {
    const lookup = lookupFactory(new Set(), { PATH: "/usr/bin", HOME: "/home/u" });
    expect(resolveCompanionCommand(lookup)).toBeNull();
  });

  it("skips empty PATH entries safely", () => {
    const lookup = lookupFactory(new Set(["/usr/bin/kage"]), {
      PATH: "::/usr/bin:",
      HOME: "/home/u",
    });
    expect(resolveCompanionCommand(lookup)).toBe("/usr/bin/kage");
  });

  it("uses the Windows NSIS per-user install path on win32", () => {
    const exe = "C:\\Users\\u\\AppData\\Local\\Programs\\KAGE\\kage.exe";
    const lookup = lookupFactory(
      new Set([exe]),
      { PATH: "C:\\Windows\\System32", LOCALAPPDATA: "C:\\Users\\u\\AppData\\Local" },
      "win32",
    );
    expect(resolveCompanionCommand(lookup)).toBe(exe);
  });

  it("finds kage.exe on a Windows PATH", () => {
    const lookup = lookupFactory(
      new Set(["C:\\Tools\\kage.exe"]),
      { PATH: "C:\\Tools" },
      "win32",
    );
    expect(resolveCompanionCommand(lookup)).toBe("C:\\Tools\\kage.exe");
  });
});
