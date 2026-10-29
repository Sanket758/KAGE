#!/usr/bin/env node
/**
 * Installs the built KAGE plugin into an OpenCode plugin directory.
 *
 *   npm run build:plugin
 *   node scripts/install-plugin.mjs            # ~/.config/opencode/plugins/kage.js
 *   node scripts/install-plugin.mjs --project  # ./.opencode/plugins/kage.js
 *   node scripts/install-plugin.mjs --uninstall
 */
import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));
const project = args.has("--project");
const uninstall = args.has("--uninstall");

import { homedir } from "node:os";
// OpenCode uses ~/.config/opencode on every platform, including Windows.
const configHome =
  process.env.XDG_CONFIG_HOME ||
  process.env.OPENCODE_CONFIG_DIR ||
  join(process.env.HOME || homedir(), ".config");
const directory = project
  ? resolve(process.cwd(), ".opencode/plugins")
  : join(configHome, "opencode/plugins");
const target = join(directory, "kage.js");
const source = join(ROOT, "packages/opencode-plugin/dist/index.js");

if (uninstall) {
  if (existsSync(target)) {
    rmSync(target);
    console.log(`removed ${target}`);
  } else {
    console.log(`nothing to remove at ${target}`);
  }
  process.exit(0);
}

if (!existsSync(source)) {
  console.error("plugin bundle missing. Run `npm run build:plugin` first.");
  process.exit(1);
}

mkdirSync(directory, { recursive: true });
copyFileSync(source, target);
console.log(`installed KAGE plugin at ${target}`);
console.log("restart OpenCode (or run `opencode service restart`) to load it.");
console.log("the plugin launches the companion when OpenCode runs and exits it when OpenCode stops.");
