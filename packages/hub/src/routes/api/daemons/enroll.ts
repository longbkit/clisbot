import { createFileRoute } from "@tanstack/react-router";
import { getApplication } from "../../../server/runtime.js";

export const Route = createFileRoute("/api/daemons/enroll")({
  server: {
    handlers: {
      POST: async ({ request }) =>
        (await getApplication()).operations.handleDaemonEnrollment(request),
    },
  },
});
