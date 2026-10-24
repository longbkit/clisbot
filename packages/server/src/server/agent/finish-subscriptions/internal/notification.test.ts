import { expect, test } from "vitest";
import { formatFinishNotificationBody } from "./notification.js";

const checkpoint = {
  childAgentId: "child-id",
  title: "Remote task",
  reason: "needs permission" as const,
  lastAssistantMessage: null,
  permissionRequest: {
    id: "request-id",
    provider: "claude" as const,
    name: "Bash",
    kind: "tool" as const,
    input: { command: "pwd" },
  },
};

test("remote permission guidance names the destination without claiming local approval can route", () => {
  const body = formatFinishNotificationBody({
    ...checkpoint,
    serverId: "destination",
    localServerId: "origin",
  });
  expect(body).toContain(
    "Open agent child-id on Host destination and respond to the request there",
  );
  expect(body).toContain("Remote approval is unavailable through this local tool");
  expect(body).not.toContain("respond_to_permission");
  expect(body).toContain('"serverId": "destination"');
});

test("local permission guidance retains the supported local response tool", () => {
  for (const location of [{ serverId: "origin", localServerId: "origin" }, {}]) {
    const body = formatFinishNotificationBody({ ...checkpoint, ...location });
    expect(body).toContain("Respond with `respond_to_permission`");
    expect(body).not.toContain("Remote approval is unavailable");
  }
});
