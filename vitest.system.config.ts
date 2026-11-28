import { defineConfig } from "vitest/config";
import fs from "node:fs";
import path from "node:path";

const nodeModules = path.resolve(__dirname, "node_modules");
let nodeModulesReal = nodeModules;
try { nodeModulesReal = fs.realpathSync(nodeModules); } catch {}

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
      "next/navigation": path.join(nodeModulesReal, "next/navigation.js"),
    },
    preserveSymlinks: true,
  },
  server: {
    fs: {
      allow: [path.resolve(__dirname, "."), nodeModulesReal, path.resolve(nodeModulesReal, "..")].filter(Boolean),
    },
  },
  test: {
    environment: "node",
    include: ["tests/system/**/*.test.{ts,tsx}"],
    clearMocks: true,
    pool: "vmForks",
  },
});
