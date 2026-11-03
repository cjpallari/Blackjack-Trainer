import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  // Simulation-heavy tests take a few seconds locally and longer on shared CI runners.
  test: { include: ["tests/**/*.test.ts"], environment: "node", testTimeout: 60_000 },
});
