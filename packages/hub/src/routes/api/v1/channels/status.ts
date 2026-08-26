// COMPAT(clisbot-control-plane): the channel status route — per-account pin,
// integrity, load trace, and transport (implementation doc §1.4, §3.2).
import { createFileRoute } from "@tanstack/react-router";
import { getApplication } from "../../../../server/runtime.js";

export const Route = createFileRoute("/api/v1/channels/status")({
  server: {
    handlers: {
      GET: async ({ request }) => (await getApplication()).operations.handleChannelStatus(request),
    },
  },
});
