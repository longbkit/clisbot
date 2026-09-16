import assert from "node:assert/strict";
import { it, vi } from "vitest";
import { compileHubBundle } from "../config/bundle.js";
import { compileChannelControlPlane } from "../channels/config/compile.js";
import { createMemoryDatabase } from "../db/memory.js";
import { assertChannelConfigurationDelegation } from "./delegation.js";
import type { AccessStore, DelegatedAgentExecution } from "./store.js";

const HUB = `
environments:
  lab:
    kind: daemon
    daemon: daemon-10000000
    cwd: /lab
agents:
  assistant:
    provider: codex
    model: gpt-5.6-luna
`;

const ACCOUNT = `
channel: slack
accountId: support
connectionId: slack-support
transport: { mode: socket, errorPolicy: once }
routes:
  - match: { kind: channel, ids: [C1] }
    agent: assistant
    environment: lab
    agentControls: { provider: claude, model: claude-opus-5, mode: bypassPermissions }
fallback: { deny: true }
`;

it("checks the agent a Route's default controls start, not only the named agent", async () => {
  const bundle = compileHubBundle([{ path: ".paseo/hub.yml", content: HUB }], {
    requireWorkflow: false,
  });
  const controlPlane = compileChannelControlPlane({
    files: [
      {
        path: ".paseo/channels/policy.yml",
        content: 'defaults:\n  approval:\n    - { match: "*", mode: require }\n',
      },
      { path: ".paseo/channels/slack/support.yml", content: ACCOUNT },
    ],
    agentNames: ["assistant"],
    environmentNames: ["lab"],
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
  });
  const [execution] = assertCanDelegateAgentExecutions.mock.calls[0]![0].executions;
  assert.equal(execution?.providerId, "claude");
  assert.equal(execution?.modelId, "claude-opus-5");
  assert.equal(execution?.modeId, "bypassPermissions");
});
