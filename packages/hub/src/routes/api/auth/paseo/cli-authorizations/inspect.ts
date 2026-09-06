import { createFileRoute } from "@tanstack/react-router";
import { getApplication } from "../../../../../server/runtime.js";

export const Route = createFileRoute("/api/auth/paseo/cli-authorizations/inspect")({
  server: {
    handlers: {
      POST: async ({ request }) =>
        (await getApplication()).operations.handleCliAuthorizationInspect(request),
    },
  },
});
