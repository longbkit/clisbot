import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { summarizeTrigger } from "./activity-summary.js";

describe("summarizeTrigger", () => {
  it("summarizes a GitHub issue comment with the issue number and commenter", () => {
    const summary = summarizeTrigger("github.issue_comment", {
      id: "1",
      type: "issue_comment",
      repo: "acme/widgets",
      repositoryId: 1,
      installationId: 1,
      createdAt: new Date().toISOString(),
      payload: {
        issue: { number: 42, title: "Bug" },
        comment: { id: 1, body: "hi", html_url: "https://github.com/acme/widgets/issues/42#c1" },
        sender: { login: "alice" },
      },
    });

    assert.deepEqual(summary, {
      provider: "github",
      headline: "Comment on #42",
      actor: "alice",
      externalUrl: "https://github.com/acme/widgets/issues/42#c1",
    });
  });

  it("summarizes a GitHub push with the branch and commit count", () => {
    const summary = summarizeTrigger("github.push", {
      id: "1",
      type: "push",
      repo: "acme/widgets",
      repositoryId: 1,
      installationId: 1,
      createdAt: new Date().toISOString(),
      payload: {
        ref: "refs/heads/main",
        after: "abc123",
        sender: { login: "bob" },
        commits: [{ added: [], modified: ["a.ts"], removed: [] }],
      },
    });

    assert.deepEqual(summary, {
      provider: "github",
      headline: "Push to main (1 commit)",
      actor: "bob",
      externalUrl: null,
    });
  });

  it("summarizes a created pull request with its number and title", () => {
    const summary = summarizeTrigger("github.pull_request_created", {
      id: "1",
      type: "pull_request",
      repo: "acme/widgets",
      repositoryId: 1,
      installationId: 1,
      createdAt: new Date().toISOString(),
      payload: {
        action: "opened",
        pull_request: {
          number: 42,
          title: "Ship semantic events",
          html_url: "https://github.com/acme/widgets/pull/42",
        },
        sender: { login: "alice" },
      },
    });

    assert.deepEqual(summary, {
      provider: "github",
      headline: "Pull request #42 created: Ship semantic events",
      actor: "alice",
      externalUrl: "https://github.com/acme/widgets/pull/42",
    });
  });

  it("falls back to a generic headline when a valid envelope carries a malformed event payload", () => {
    const summary = summarizeTrigger("github.push", {
      id: "1",
      type: "push",
      repo: "acme/widgets",
      repositoryId: 1,
      installationId: 1,
      createdAt: new Date().toISOString(),
      payload: { sender: { login: "bob" } },
    });

    assert.deepEqual(summary, {
      provider: "github",
      headline: "Push",
      actor: null,
      externalUrl: null,
    });
  });

  it("falls back to a generic headline when the GitHub payload does not parse", () => {
    const summary = summarizeTrigger("github.issue_comment", { not: "an event" });

    assert.deepEqual(summary, {
      provider: "github",
      headline: "GitHub event",
      actor: null,
      externalUrl: null,
    });
  });

  it("summarizes a Slack mention using the message content", () => {
    const summary = summarizeTrigger("slack.mention", {
      type: "mention",
      id: "evt-1",
      teamId: "T1",
      appId: "A1",
      channelId: "C1",
      messageTs: "1.1",
      threadTs: null,
      eventTs: "1.1",
      eventTime: 1,
      content: "can someone deploy this",
      author: { id: "U1" },
      createdAt: new Date().toISOString(),
    });

    assert.equal(summary.provider, "slack");
    assert.equal(summary.headline, "can someone deploy this");
    assert.equal(summary.actor, null);
  });

  it("summarizes a Discord mention with the author's username and a message link", () => {
    const summary = summarizeTrigger("discord.mention", {
      type: "mention",
      id: "111111111111111111",
      guildId: "222222222222222222",
      channelId: "333333333333333333",
      threadId: null,
      parentChannelId: null,
      messageId: "444444444444444444",
      content: "ship it",
      mentionedUserIds: [],
      author: { id: "555555555555555555", username: "carol" },
      createdAt: new Date().toISOString(),
      attachments: [],
      referencedMessage: null,
    });

    assert.deepEqual(summary, {
      provider: "discord",
      headline: "ship it",
      actor: "carol",
      externalUrl:
        "https://discord.com/channels/222222222222222222/333333333333333333/444444444444444444",
    });
  });

  it("summarizes a manual run with the trigger and actor", () => {
    const summary = summarizeTrigger("manual.run", { trigger: "rollback", actor: "dana" });

    assert.deepEqual(summary, {
      provider: "manual",
      headline: "Manual run: rollback",
      actor: "dana",
      externalUrl: null,
    });
  });
});
