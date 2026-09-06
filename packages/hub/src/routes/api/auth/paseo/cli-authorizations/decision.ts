import { createFileRoute } from "@tanstack/react-router";
import { getApplication } from "../../../../../server/runtime.js";

export const Route = createFileRoute("/api/auth/paseo/cli-authorizations/decision")({
  server: {
    handlers: {
      POST: async ({ request }) =>
        (await getApplication()).operations.handleCliAuthorizationDecision(request),
    },
  },
});
