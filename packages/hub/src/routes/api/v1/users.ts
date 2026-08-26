// COMPAT(clisbot-control-plane): the user control-plane routes (implementation
// doc §1.4, §3.2, §4-S4) — the thin routes over `HubOperations.handleUser*`.
import { createFileRoute } from "@tanstack/react-router";
import { getApplication } from "../../../server/runtime.js";

export const Route = createFileRoute("/api/v1/users")({
  server: {
    handlers: {
      GET: async ({ request }) => (await getApplication()).operations.handleUsersList(request),
      POST: async ({ request }) => (await getApplication()).operations.handleUserAdd(request),
    },
  },
});
