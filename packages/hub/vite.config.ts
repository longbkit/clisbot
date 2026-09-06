import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { resolveAllowedHosts } from "./vite-allowed-hosts";
import { daemonSocketDevelopmentPlugin } from "./vite-daemon-socket";

export default defineConfig(({ command, isPreview }) => {
  if (command === "serve" && !isPreview) loadDotenv();

  return {
    build: { outDir: ".output" },
    envDir: false,
    resolve: {
      alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
      dedupe: ["react", "react-dom"],
    },
    server: { allowedHosts: resolveAllowedHosts() },
    plugins: [
      tanstackStart({ server: { entry: "./start-server.ts" } }),
      daemonSocketDevelopmentPlugin(),
      tailwindcss(),
      react(),
    ],
  };
});
