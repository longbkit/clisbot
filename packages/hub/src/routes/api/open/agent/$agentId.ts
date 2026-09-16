import { createFileRoute } from "@tanstack/react-router";
import { sessionOpenRedirect } from "../../../../channels/session-open-link.js";

export const Route = createFileRoute("/api/open/agent/$agentId")({
  server: {
    handlers: {
      // Hands a channel reader off to the installed app. It carries no
      // authority: the app still authenticates to the Host, so this only saves
      // the reader from copying a `paseo://` URL their client will not linkify.
      GET: ({ params, request }) => {
        const target = sessionOpenRedirect(
          params.agentId,
          new URL(request.url).searchParams.get("host"),
        );
        if (!target) return new Response("Unknown session link.", { status: 400 });
        return new Response(null, { status: 302, headers: { location: target } });
      },
    },
  },
});
