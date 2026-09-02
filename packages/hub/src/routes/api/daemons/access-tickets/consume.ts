import { createFileRoute } from "@tanstack/react-router";
import { getApplication } from "../../../../server/runtime.js";

export const Route = createFileRoute("/api/daemons/access-tickets/consume")({
  server: {
    handlers: {
      POST: async ({ request }) =>
        (await getApplication()).operations.handleDaemonAccessTicketConsumption(request),
    },
  },
});
