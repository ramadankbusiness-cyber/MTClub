import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    environment: "node",
    include: ["tests/system/**/*.test.{ts,tsx}"],
    clearMocks: true,
    pool: "vmForks",
  },
});
