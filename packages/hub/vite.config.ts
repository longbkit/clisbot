import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";

export default defineConfig(({ command, isPreview }) => {
  if (command === "serve" && !isPreview) loadDotenv();

  return {
    build: { outDir: ".output" },
    envDir: false,
    resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
    plugins: [tanstackStart({ server: { entry: "./start-server.ts" } }), tailwindcss(), react()],
  };
});
