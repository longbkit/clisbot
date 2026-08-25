import { createFileRoute } from "@tanstack/react-router";
import { handleAuth } from "../../../server/runtime.js";

export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      GET: ({ request }) => handleAuth(request),
      POST: ({ request }) => handleAuth(request),
    },
  },
});
