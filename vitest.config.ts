import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@kage/core": `${root}packages/core/src/index.ts`,
      "@kage/art": `${root}packages/art/src/index.ts`,
    },
  },
  test: {
    include: ["packages/*/test/**/*.test.ts"],
    environment: "node",
    testTimeout: 10_000,
  },
});
