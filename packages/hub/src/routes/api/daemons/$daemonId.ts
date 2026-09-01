import { createFileRoute } from "@tanstack/react-router";
import { getApplication } from "../../../server/runtime.js";

export const Route = createFileRoute("/api/daemons/$daemonId")({
  server: {
    handlers: {
      PATCH: async ({ request }) =>
        (await getApplication()).operations.handleDaemonPermissionUpdate(
          request,
          new URL(request.url).pathname.split("/")[3] ?? "",
        ),
      DELETE: async ({ request }) =>
        (await getApplication()).operations.handleDaemonRevocation(
          request,
          new URL(request.url).pathname.split("/")[3] ?? "",
        ),
    },
  },
});
