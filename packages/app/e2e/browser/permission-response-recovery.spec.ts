import path from "node:path";
import { readFile } from "node:fs/promises";
import type { DaemonClient } from "@clisbot/client/internal/daemon-client";
import { expect, test } from "../support/fixtures";
import { seedWorkspace } from "../support/helpers/seed-client";
import { openAgentRoute } from "../support/helpers/mock-agent";
import { fillQuestionAnswer, waitForQuestionPrompt } from "../support/helpers/questions";
import { connectDaemonClient } from "../support/helpers/daemon-client-loader";
import { getE2EDaemonPort } from "../support/helpers/daemon-port";
import { selectSidebarGrouping } from "../support/helpers/sidebar";

test.use({
  e2eDaemonConfig: {
    version: 1,
    agents: {
      providers: {
        codex: {
          enabled: true,
          command: [process.execPath, path.resolve("e2e/fixtures/permission-codex.mjs")],
        },
        claude: { enabled: false },
        copilot: { enabled: false },
        opencode: { enabled: false },
        pi: { enabled: false },
        omp: { enabled: false },
      },
    },
  },
});

test("a definitively rejected async answer stays pending and can be dismissed", async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  const workspace = await seedWorkspace({ repoPrefix: "permission-recovery-" });
  try {
    const agent = await workspace.client.createAgent({
      provider: "codex",
      cwd: workspace.repoPath,
      workspaceId: workspace.workspaceId,
      title: "Permission recovery",
      model: "gpt-6.1-sol",
      modeId: "full-access",
      initialPrompt: "reject-first: Ask for status while continuing work.",
    });
    await openAgentRoute(page, { workspaceId: workspace.workspaceId, agentId: agent.id });
    await waitForQuestionPrompt(page, 120_000);
    await fillQuestionAnswer(page, {
      question: "Please give a short status.",
      answer: "Keep the original status.",
    });
    await page.getByTestId("question-form-primary-action").click();
    await expect(page.getByText(/The active Codex turn changed/)).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("rejected-answer.png") });
    await page.getByTestId("question-form-card").getByRole("button", { name: "Dismiss" }).click();
    await expect(page.getByTestId("question-form-card")).toHaveCount(0);
    await expect(page.getByRole("status", { name: "Needs input", exact: true })).toHaveCount(0);
    await page.reload();
    await expect(page.getByTestId("question-form-card")).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath("after-skip-reload.png") });
  } finally {
    await workspace.cleanup();
  }
});

for (const recovery of ["Skip", "Send", "other-client"] as const) {
  test(`an accepted answer converges via ${recovery} without replacing it`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(180_000);
    let dropUpdates = false;
    await page.routeWebSocket(new RegExp(`:${getE2EDaemonPort()}/ws`), (socket) => {
      const server = socket.connectToServer();
      server.onMessage((message) => {
        if (!dropUpdates) socket.send(message);
      });
    });
    const workspace = await seedWorkspace({ repoPrefix: "permission-lost-ack-" });
    const client = await connectDaemonClient<DaemonClient>({
      clientIdPrefix: "permission-observer",
    });
    try {
      await client.fetchAgents({ subscribe: {} });
      const agent = await workspace.client.createAgent({
        provider: "codex",
        cwd: workspace.repoPath,
        workspaceId: workspace.workspaceId,
        title: "Lost acknowledgement",
        model: "gpt-6.1-sol",
        modeId: "full-access",
        initialPrompt: "two-questions: Continue work while both questions await answers.",
      });
      await openAgentRoute(page, { workspaceId: workspace.workspaceId, agentId: agent.id });
      await expect(page.getByTestId("question-form-card")).toHaveCount(2);
      await selectSidebarGrouping(page, "workspace");
      await expect(page.getByRole("status", { name: "Needs input", exact: true })).toBeVisible();
      await fillQuestionAnswer(page, {
        question: "Please give a short status.",
        answer: "The original accepted answer.",
      });
      dropUpdates = true;
      if (recovery === "other-client") {
        await client.respondToPermissionAndWait(agent.id, "permission-question-main", {
          behavior: "allow",
          updatedInput: { answers: { "Question 1": "The original accepted answer." } },
        });
      } else await page.getByTestId("question-form-primary-action").first().click();
      await expect
        .poll(
          async () =>
            (await client.fetchPermissionResponses(agent.id)).records.filter(
              (r) => r.status === "applied",
            ).length,
        )
        .toBe(1);
      const accepted = (await client.fetchPermissionResponses(agent.id)).records[0];
      if (recovery !== "other-client")
        await expect(page.getByText(/Timeout waiting for message/)).toBeVisible({
          timeout: 25_000,
        });
      await page.screenshot({ path: testInfo.outputPath("lost-ack-pending.png") });
      dropUpdates = false;
      const retry = recovery === "Send" ? "question-form-primary-action" : "question-form-dismiss";
      await page.getByTestId(retry).first().click();
      await expect(page.getByTestId("question-form-card")).toHaveCount(1);
      await expect(page.getByTestId("question-form-current-question")).toHaveText(
        "Which action still needs authorization?",
      );
      const records = (await client.fetchPermissionResponses(agent.id)).records;
      expect(records).toEqual([accepted]);
      expect(records[0]).toMatchObject({
        status: "applied",
        response: {
          behavior: "allow",
          updatedInput: { answers: { "Question 1": "The original accepted answer." } },
        },
      });
      const pending = await client.fetchAgent(agent.id);
      expect(pending?.agent.pendingPermissions.map((request) => request.id)).toEqual([
        "permission-question-other",
      ]);
      await expect(page.getByRole("status", { name: "Needs input", exact: true })).toBeVisible();
      await page.reload();
      await expect(page.getByTestId("question-form-card")).toHaveCount(1);
      await page.screenshot({
        path: testInfo.outputPath("accepted-answer-other-still-pending.png"),
      });
      const calls = (
        await readFile(path.join(workspace.repoPath, "permission-fixture.jsonl"), "utf8")
      )
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      expect(calls).toHaveLength(1);
      expect(calls[0].accepted).toBe(true);
      await page.getByTestId("question-form-dismiss").click();
      await expect(page.getByTestId("question-form-card")).toHaveCount(0);
      await expect(page.getByRole("status", { name: "Needs input", exact: true })).toHaveCount(0);
      await expect(page.getByRole("status", { name: "Working", exact: true })).toBeVisible();
      expect((await client.fetchAgent(agent.id))?.agent.status).toBe("running");
      await page.screenshot({ path: testInfo.outputPath("resolved-badges.png") });
      await testInfo.attach("permission-ledger", {
        body: JSON.stringify((await client.fetchPermissionResponses(agent.id)).records, null, 2),
        contentType: "application/json",
      });
    } finally {
      await client.close();
      await workspace.cleanup();
    }
  });
}
