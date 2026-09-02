import { createFileRoute } from "@tanstack/react-router";
import { handleManagementApi } from "../../../../server/runtime.js";

export const Route = createFileRoute("/api/management/v1/$")({
  server: {
    handlers: {
      ANY: ({ request }) => handleManagementApi(request),
    },
  },
});
