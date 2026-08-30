// COMPAT(clisbot-control-plane): the tool-path channel-reply MCP endpoint (E4).
// The `token` is the opaque binding ref the agent-spec resolver embedded in the
// mcpServers URL at create time (`/mcp/channel/<opaque-binding-ref>`) — it is
// passed verbatim to the ops layer, which decodes it; a malformed ref is a
// clean tool error, never a route-level failure.
import { createFileRoute } from "@tanstack/react-router";
import { getApplication } from "../../../server/runtime.js";

export const Route = createFileRoute("/mcp/channel/$token")({
  server: {
    handlers: {
      POST: async ({ request }) =>
        (await getApplication()).operations.handleChannelReplyMcp(request, tokenFrom(request)),
    },
  },
});

function tokenFrom(request: Request): string {
  // The binding ref is base64url (no `/`, no percent-escaping needed), so the
  // raw pathname segment is the token.
  return new URL(request.url).pathname.split("/")[3] ?? "";
}
