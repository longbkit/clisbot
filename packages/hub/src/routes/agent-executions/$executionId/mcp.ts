import { createFileRoute } from "@tanstack/react-router";
import { getApplication } from "../../../server/runtime.js";

export const Route = createFileRoute("/agent-executions/$executionId/mcp")({
  server: {
    handlers: {
      POST: async ({ request }) =>
        (await getApplication()).operations.handleExecutionCapabilities(
          request,
          new URL(request.url).pathname.split("/")[2] ?? "",
        ),
    },
  },
});
