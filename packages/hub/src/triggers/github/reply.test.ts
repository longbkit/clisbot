import assert from "node:assert/strict";
import { describe, it, vi } from "vitest";
import { createGitHubReplyExecutor, githubReplyAvailable } from "./reply.js";

describe("GitHub reply output", () => {
  it("posts a comment to the originating issue or pull request", async () => {
    const createIssueComment = vi.fn(() => Promise.resolve());
    const outputContext = {
      provider: "github",
      target: { installationId: 42, repository: "getpaseo/hub" },
      event: { github: { item: { number: 92 } } },
    };

    assert.equal(githubReplyAvailable(outputContext), true);
    await createGitHubReplyExecutor({ client: { createIssueComment } })({
      agentExecutionId: "execution-1",
      toolType: "github.reply",
      args: { content: "Shipped." },
      outputContext,
    });

    assert.deepEqual(createIssueComment.mock.calls, [
      [
        {
          installationId: 42,
          owner: "getpaseo",
          repo: "hub",
          issueNumber: 92,
          body: "Shipped.",
        },
      ],
    ]);
  });

  it("does not advertise reply when the event has no conversation item", () => {
    assert.equal(
      githubReplyAvailable({
        provider: "github",
        target: { installationId: 42, repository: "getpaseo/hub" },
        event: { github: { item: null } },
      }),
      false,
    );
  });
});
