import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { createDaemonTestContext, type DaemonTestContext } from "../test-utils/index.js";

let ctx: DaemonTestContext;
let cwd: string;

beforeEach(async () => {
  ctx = await createDaemonTestContext();
  cwd = mkdtempSync(path.join(tmpdir(), "fork-background-work-"));
});

afterEach(async () => {
  await ctx.cleanup();
  rmSync(cwd, { recursive: true, force: true });
}, 30_000);

// Clisbot declines upstream #9627: the Task row's projection holds only its latest payload, so
// a fork from the earlier reply would carry results produced after it. The fork is refused with
// guidance, and the later completed reply forks normally.
test("refuses a reply that background work outlived and forks the later reply", async () => {
  const agent = await ctx.client.createAgent({ provider: "claude", cwd });
  await ctx.client.sendMessage(agent.id, "Start background work");
  expect((await ctx.client.waitForFinish(agent.id, 15_000)).status).toBe("idle");
  await ctx.client.sendMessage(agent.id, "Any findings?");
  expect((await ctx.client.waitForFinish(agent.id, 15_000)).status).toBe("idle");

  const page = await ctx.client.fetchAgentTimeline(agent.id, { direction: "tail", limit: 0 });
  const reply = page.entries.find(
    (entry) => entry.item.type === "assistant_message" && entry.item.text === "Audit started.",
  );
  if (reply?.item.type !== "assistant_message" || !reply.item.messageId) {
    throw new Error("Expected the reply to carry a provider message id");
  }
  const task = page.entries.find((entry) => entry.item.type === "tool_call");
  // The Task row started before the reply and completed after it.
  expect(task?.item).toMatchObject({ name: "Task", status: "completed" });
  expect(task?.seqStart).toBeLessThan(reply.seqEnd);
  expect(task?.seqEnd).toBeGreaterThan(reply.seqEnd);

  for (const options of [
    { boundaryMessageId: reply.item.messageId },
    { boundaryCursor: { epoch: page.epoch, seq: reply.seqEnd } },
  ]) {
    await expect(ctx.client.buildAgentForkContext(agent.id, options)).rejects.toThrow(
      "Fork from a later completed response",
    );
  }

  const latest = await ctx.client.buildAgentForkContext(agent.id, {});
  expect(latest.attachment?.text).toContain("[User] Any findings?");
}, 60_000);
