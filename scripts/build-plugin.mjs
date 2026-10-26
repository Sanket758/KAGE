#!/usr/bin/env node
/** Bundles the OpenCode plugin and its shared core into a single ESM file. */
import { build } from "esbuild";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "packages/opencode-plugin/dist");

await mkdir(OUT_DIR, { recursive: true });

await build({
  entryPoints: [join(ROOT, "packages/opencode-plugin/src/index.ts")],
  outfile: join(OUT_DIR, "index.js"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  alias: {
    "@kage/core": join(ROOT, "packages/core/src/index.ts"),
  },
  legalComments: "none",
  logLevel: "info",
});

await writeFile(
  join(OUT_DIR, "package.json"),
  `${JSON.stringify(
    {
      name: "kage-opencode-plugin",
      version: "0.1.0",
      description: "Mirrors OpenCode activity to the KAGE desktop companion.",
      type: "module",
      main: "index.js",
      license: "MIT",
    },
    null,
    2,
  )}\n`,
);

console.log(`plugin bundle written to ${join(OUT_DIR, "index.js")}`);
