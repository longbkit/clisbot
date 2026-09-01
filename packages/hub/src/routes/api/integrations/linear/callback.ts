import { createFileRoute } from "@tanstack/react-router";
import { handleConnections } from "../../../../server/runtime.js";

export const Route = createFileRoute("/api/integrations/linear/callback")({
  server: { handlers: { GET: ({ request }) => handleConnections(request, "linearCallback") } },
});
