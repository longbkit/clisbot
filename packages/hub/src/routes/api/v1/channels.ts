// COMPAT(clisbot-control-plane): the channel control-plane routes (implementation
// doc §1.4, §3.2) — the thin routes over `HubOperations.handleChannel*`.
import { createFileRoute } from "@tanstack/react-router";
import { getApplication } from "../../../server/runtime.js";

export const Route = createFileRoute("/api/v1/channels")({
  server: {
    handlers: {
      GET: async ({ request }) => (await getApplication()).operations.handleChannelList(request),
      POST: async ({ request }) => (await getApplication()).operations.handleChannelAdd(request),
    },
  },
});
