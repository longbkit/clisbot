import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";

export default defineConfig({
  plugins: [tanstackStart({ server: { entry: "./start-server.ts" } }), react()],
  test: {
    environment: "node",
    testTimeout: 30_000,
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: true,
        minForks: 1,
        maxForks: 1,
      },
    },
    exclude: ["**/node_modules/**", "**/dist/**", "**/.output/**", "**/.claude/**", "e2e/**"],
    server: {
      deps: {
        inline: [/@tanstack\/.*start/u],
      },
    },
  },
});
