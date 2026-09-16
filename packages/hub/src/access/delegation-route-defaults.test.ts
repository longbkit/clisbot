import assert from "node:assert/strict";
import { it, vi } from "vitest";
import { compileHubBundle } from "../config/bundle.js";
import { compileChannelControlPlane } from "../channels/config/compile.js";
import { createMemoryDatabase } from "../db/memory.js";
import { assertChannelConfigurationDelegation } from "./delegation.js";
import type { AccessStore, DelegatedAgentExecution } from "./store.js";

const HUB = `
environments:
  support:
    kind: daemon
    daemon: daemon-10000000
    cwd: /support
  finance:
    kind: daemon
    daemon: daemon-10000000
    cwd: /finance
agents:
  assistant:
    provider: codex
    model: gpt-5.6-luna
`;

function account(accountId: string, environment: string, controls = ""): string {
  return `
channel: slack
accountId: ${accountId}
connectionId: slack-${accountId}
transport: { mode: socket, errorPolicy: once }
routes:
  - match: { kind: channel, ids: [C1] }
    agent: assistant
    environment: ${environment}
${controls}
fallback: { deny: true }
`;
}

async function delegatedExecutions(
  routes?: Parameters<typeof assertChannelConfigurationDelegation>[0]["routes"],
): Promise<DelegatedAgentExecution[]> {
  const bundle = compileHubBundle([{ path: ".paseo/hub.yml", content: HUB }], {
    requireWorkflow: false,
  });
  const controlPlane = compileChannelControlPlane({
    files: [
      {
        path: ".paseo/channels/policy.yml",
        content: 'defaults:\n  approval:\n    - { match: "*", mode: require }\n',
      },
      {
        path: ".paseo/channels/slack/support.yml",
        content: account(
          "support",
          "support",
          "    agentControls: { provider: claude, model: claude-opus-5, mode: bypassPermissions }",
        ),
      },
      { path: ".paseo/channels/slack/finance.yml", content: account("finance", "finance") },
    ],
    agentNames: ["assistant"],
    environmentNames: ["support", "finance"],
    workflowNames: [],
  });
  const assertCanDelegateAgentExecutions = vi.fn(
    async (_input: { executions: DelegatedAgentExecution[] }) => undefined,
  );
  await assertChannelConfigurationDelegation({
    access: { assertCanDelegateAgentExecutions } as unknown as AccessStore,
    database: createMemoryDatabase(),
    principal: { organizationId: "org", userId: "u", membershipId: "m" },
    bundle,
    controlPlane,
    ...(routes === undefined ? {} : { routes }),
  });
  return assertCanDelegateAgentExecutions.mock.calls[0]![0].executions;
}

it("checks the agent a Route's default controls start, not only the named agent", async () => {
  const support = (await delegatedExecutions()).find(({ cwd }) => cwd === "/support");
  assert.equal(support?.providerId, "claude");
  assert.equal(support?.modelId, "claude-opus-5");
  assert.equal(support?.modeId, "bypassPermissions");
});

it("checks only the changed Route when a change names one", async () => {
  assert.deepEqual((await delegatedExecutions()).map(({ cwd }) => cwd).sort(), [
    "/finance",
    "/support",
  ]);
  // A Channel Route manager changing `slack/support` is not asked about the
  // untouched `slack/finance` Route.
  const scoped = await delegatedExecutions([
    { channel: "slack", accountId: "support", position: 0 },
  ]);
  assert.deepEqual(
    scoped.map(({ cwd }) => cwd),
    ["/support"],
  );
});
