// COMPAT(clisbot-control-plane): the user show/edit routes (implementation
// doc §1.4, §3.2, §4-S4). The username arrives percent-encoded (the CLI encodes
// it), so it is decoded here before reaching the ops layer.
import { createFileRoute } from "@tanstack/react-router";
import { getApplication } from "../../../../server/runtime.js";

export const Route = createFileRoute("/api/v1/users/$username")({
  server: {
    handlers: {
      GET: async ({ request }) =>
        (await getApplication()).operations.handleUserShow(request, usernameFrom(request)),
      PUT: async ({ request }) =>
        (await getApplication()).operations.handleUserEdit(request, usernameFrom(request)),
    },
  },
});

function usernameFrom(request: Request): string {
  const segment = new URL(request.url).pathname.split("/")[4] ?? "";
  try {
    return decodeURIComponent(segment);
  } catch {
    return "";
  }
}
