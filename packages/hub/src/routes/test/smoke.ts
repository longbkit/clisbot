import { createFileRoute } from "@tanstack/react-router";
import { areTestTriggerRoutesEnabled, getApplication } from "../../server/runtime.js";

export const Route = createFileRoute("/test/smoke")({
  server: {
    handlers: {
      POST: async ({ request }) =>
        (await areTestTriggerRoutesEnabled())
          ? (await getApplication()).operations.handleManualTrigger(request, "smoke")
          : new Response("Not Found", { status: 404 }),
    },
  },
});
