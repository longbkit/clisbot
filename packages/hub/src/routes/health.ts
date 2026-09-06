import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/health")({
  server: {
    handlers: {
      // COMPAT(clisbot-onboarding): identify the launched process, not just an occupied port.
      GET: () => Response.json({ ok: true, instanceId: process.env["CLISBOT_HUB_INSTANCE_ID"] }),
    },
  },
});
