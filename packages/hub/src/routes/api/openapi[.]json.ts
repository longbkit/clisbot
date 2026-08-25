import { createFileRoute } from "@tanstack/react-router";
import { getApplication } from "../../server/runtime.js";

export const Route = createFileRoute("/api/openapi.json")({
  server: {
    handlers: {
      GET: async () => (await getApplication()).publicApi.openapi(),
    },
  },
});
