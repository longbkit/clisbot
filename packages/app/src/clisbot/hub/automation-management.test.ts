import { expect, it } from "vitest";
import { HubApiClient } from "./api-client";
import { createAutomation } from "./automation-management";
import type { HubRequestInput, HubTransport } from "./transport/contract";

it("validates before creating an Automation through the management contract", async () => {
  const requests: { path: string; input: HubRequestInput }[] = [];
  const automation = {
    id: "automation-1",
    name: "customer-handoff",
    enabled: true,
    format: "single_agent",
    activeRevisionId: "revision-1",
    definition: {},
    yaml: "name: customer-handoff",
    createdAt: "2026-09-03T00:00:00.000Z",
    updatedAt: "2026-09-03T00:00:00.000Z",
  };
  const transport: HubTransport = {
    signInKind: "password",
    async request(path, input = {}) {
      requests.push({ path, input });
      return Response.json(
        path.endsWith("/validate")
          ? { valid: true, name: automation.name, definition: automation.definition }
          : automation,
      );
    },
    signIn: () => Promise.resolve(),
    signOut: () => Promise.resolve(),
  };

  await expect(
    createAutomation(new HubApiClient(transport, "organization-1"), automation.yaml),
  ).resolves.toEqual(automation);
  expect(requests).toEqual([
    {
      path: "/api/management/v1/organizations/organization-1/automations/validate",
      input: {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ yaml: automation.yaml }),
      },
    },
    {
      path: "/api/management/v1/organizations/organization-1/automations",
      input: {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedRevisionId: null, yaml: automation.yaml }),
      },
    },
  ]);
});
