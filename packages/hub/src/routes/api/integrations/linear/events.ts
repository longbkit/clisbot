import { createFileRoute } from "@tanstack/react-router";
import { handleProviderRequest } from "../../../../server/runtime.js";

export const Route = createFileRoute("/api/integrations/linear/events")({
  server: {
    handlers: { POST: ({ request }) => handleProviderRequest("linear.events", request) },
  },
});
