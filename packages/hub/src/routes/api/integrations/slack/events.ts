import { createFileRoute } from "@tanstack/react-router";
import { handleProviderRequest } from "../../../../server/runtime.js";

export const Route = createFileRoute("/api/integrations/slack/events")({
  server: {
    handlers: { POST: ({ request }) => handleProviderRequest("slack.events", request) },
  },
});
