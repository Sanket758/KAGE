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

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));
const project = args.has("--project");
const uninstall = args.has("--uninstall");

const configHome = process.env.XDG_CONFIG_HOME || join(process.env.HOME ?? "", ".config");
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
console.log("the KAGE desktop app must be running for events to reach the companion.");
