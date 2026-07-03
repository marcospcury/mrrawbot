import { defineConfig } from "vitest/config"

// Standalone vitest config so tests don't pull in the React/Tailwind app plugins.
export default defineConfig({
  test: {
    environment: "node",
    include: ["server/**/*.test.ts", "shared/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@shared": new URL("./shared", import.meta.url).pathname,
    },
  },
})
