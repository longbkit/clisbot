import { createFileRoute } from "@tanstack/react-router";
import { getApplication } from "../../../../server/runtime.js";

export const Route = createFileRoute("/api/v1/channels/handoff")({
  server: {
    handlers: {
      POST: async ({ request }) =>
        (await getApplication()).operations.handleChannelHandoff(request),
    },
  },
});
