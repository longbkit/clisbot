import { createFileRoute } from "@tanstack/react-router";
import { areTestTriggerRoutesEnabled, getApplication } from "../../server/runtime.js";

export const Route = createFileRoute("/test/trigger")({
  server: {
    handlers: {
      POST: async ({ request }) =>
        (await areTestTriggerRoutesEnabled())
          ? (await getApplication()).operations.handleManualTrigger(request, "trigger")
          : new Response("Not Found", { status: 404 }),
    },
  },
});
