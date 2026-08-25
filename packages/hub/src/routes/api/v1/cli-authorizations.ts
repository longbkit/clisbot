import { createFileRoute } from "@tanstack/react-router";
import { getApplication } from "../../../server/runtime.js";

export const Route = createFileRoute("/api/v1/cli-authorizations")({
  server: {
    handlers: {
      POST: async ({ request }) =>
        (await getApplication()).operations.handleCliAuthorizationStart(request),
    },
  },
});
