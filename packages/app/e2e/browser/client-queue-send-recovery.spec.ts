import { expect, test, disabledQueueProviders } from "../support/helpers/queue-fixture";
import { gateNextAgentMessage } from "../support/helpers/agent-message-gate";
import {
  fillComposerDraft,
  sendDraftToQueue,
  startRunningMockAgent,
} from "../support/helpers/composer";

// The client queue uses send_agent_message_request. Durable Host queues have
// their own command/receipt owner and must not be tested through this wire gate.
test.use({
  e2eDaemonConfig: {
    version: 1,
    features: { hostInputQueue: false },
    agents: { providers: disabledQueueProviders },
  },
});

test("restores overlapping queued sends when their connection fails", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const gate = await gateNextAgentMessage(page);
  const agent = await startRunningMockAgent(page, {
    prefix: `overlapping-queued-send-${testInfo.workerIndex}-`,
    model: "one-minute-stream",
    prompt: "Keep the agent running while messages queue.",
  });
  const prompts = ["Restore the first queued send.", "Restore the second queued send."];
  const actions = page.getByRole("button", { name: "Steer this send", exact: true });
  try {
    for (const prompt of prompts) {
      await fillComposerDraft(page, prompt);
      await expect(page.getByRole("button", { name: "Send and steer", exact: true })).toBeEnabled();
      await sendDraftToQueue(page);
    }
    await expect(actions).toHaveCount(2);
    await actions.first().click();
    expect(await gate.waitForRequest(1)).toMatchObject({
      text: prompts[0],
      activeTurnBehavior: "steer",
    });
    await actions.first().click();
    expect(await gate.waitForRequest(2)).toMatchObject({
      text: prompts[1],
      activeTurnBehavior: "steer",
    });
    await gate.disconnect();
    await expect(actions).toHaveCount(prompts.length);
    for (const prompt of prompts) {
      await expect(page.getByTestId("user-message").filter({ hasText: prompt })).toHaveCount(0);
      await expect(page.getByText(prompt, { exact: true })).toBeVisible();
    }
  } finally {
    await agent.cleanup();
  }
});
