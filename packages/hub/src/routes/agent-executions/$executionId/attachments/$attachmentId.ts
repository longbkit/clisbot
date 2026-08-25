import { createFileRoute } from "@tanstack/react-router";
import { getApplication } from "../../../../server/runtime.js";

export const Route = createFileRoute("/agent-executions/$executionId/attachments/$attachmentId")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const path = new URL(request.url).pathname.split("/");
        return (await getApplication()).operations.handleAttachmentDownload(
          request,
          path[2] ?? "",
          path[4] ?? "",
        );
      },
    },
  },
});
