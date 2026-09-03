import { createFileRoute } from "@tanstack/react-router";
import { getApplication } from "../../../../server/runtime.js";

export const Route = createFileRoute("/api/daemons/$daemonId/projects")({
  server: {
    handlers: {
      PUT: async ({ request }) =>
        (await getApplication()).operations.handleDaemonProjectsReplacement(
          request,
          new URL(request.url).pathname.split("/")[3] ?? "",
        ),
    },
  },
});
