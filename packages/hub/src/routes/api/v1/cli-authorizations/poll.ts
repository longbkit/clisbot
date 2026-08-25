import { createFileRoute } from "@tanstack/react-router";
import { getApplication } from "../../../../server/runtime.js";

export const Route = createFileRoute("/api/v1/cli-authorizations/poll")({
  server: {
    handlers: {
      POST: async ({ request }) =>
        (await getApplication()).operations.handleCliAuthorizationPoll(request),
    },
  },
});
