import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { SlackBotClient } from "./client.js";
import { createSlackReplyExecutor } from "./reply.js";

describe("Slack reply output", () => {
  it("posts repeated replies into the same originating thread", async () => {
    const client = new RecordingSlackClient();
    const execute = createSlackReplyExecutor({ client });
    await execute({
      agentExecutionId: "execution-1",
      toolType: "slack.reply",
      args: { content: "Done" },
      outputContext: {
        provider: "slack",
        organizationId: "org-1",
        teamId: "T1",
        channelId: "C1",
        threadTs: "1700000000.000001",
        messageTs: "1700000000.000001",
      },
    });
    await execute({
      agentExecutionId: "execution-1",
      toolType: "slack.reply",
      args: { content: "Still working" },
      outputContext: {
        provider: "slack",
        organizationId: "org-1",
        teamId: "T1",
        channelId: "C1",
        threadTs: "1700000000.000001",
        messageTs: "1700000000.000001",
      },
    });
    assert.deepEqual(client.messages, [
      {
        organizationId: "org-1",
        teamId: "T1",
        channelId: "C1",
        threadTs: "1700000000.000001",
        content: "Done",
      },
      {
        organizationId: "org-1",
        teamId: "T1",
        channelId: "C1",
        threadTs: "1700000000.000001",
        content: "Still working",
      },
    ]);
  });

  it("rejects invalid arguments before calling Slack", async () => {
    const client = new RecordingSlackClient();
    const execute = createSlackReplyExecutor({ client });
    await assert.rejects(() =>
      execute({
        agentExecutionId: "execution-1",
        toolType: "slack.reply",
        args: { content: "" },
        outputContext: {
          organizationId: "org-1",
          teamId: "T1",
          channelId: "C1",
          threadTs: "1.1",
        },
      }),
    );
    assert.deepEqual(client.messages, []);
  });

  it("fails closed for legacy output context without organization authority", async () => {
    const client = new RecordingSlackClient();
    const execute = createSlackReplyExecutor({ client });

    await assert.rejects(() =>
      execute({
        agentExecutionId: "legacy-execution",
        toolType: "slack.reply",
        args: { content: "Done" },
        outputContext: { teamId: "T1", channelId: "C1", threadTs: "1.1" },
      }),
    );
    assert.deepEqual(client.messages, []);
  });
});

class RecordingSlackClient implements SlackBotClient {
  messages: Array<{
    organizationId: string;
    teamId: string;
    channelId: string;
    threadTs: string;
    content: string;
  }> = [];
  sendMessage(input: (typeof this.messages)[number]): Promise<void> {
    this.messages.push(input);
    return Promise.resolve();
  }
  addReaction(): Promise<void> {
    return Promise.resolve();
  }
  removeReaction(): Promise<void> {
    return Promise.resolve();
  }
}
