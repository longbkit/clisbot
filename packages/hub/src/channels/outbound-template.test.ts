// Tests for the tool-path prompt block. The contract under test is what the
// block has to state for an agent to answer at all on a `tool` route: the
// tool's provider-exposed identifier, that the final assistant message is
// discarded, and that posting here is already authorized. A route template
// replaces the whole block.

import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { composeMessageToolPrompt } from "./outbound-template.js";

describe("composeMessageToolPrompt", () => {
  it("names the tool by the identifier providers expose, not the server/tool pair", () => {
    const prompt = composeMessageToolPrompt(null, { channel: "slack" });
    assert.ok(prompt.includes("`mcp__channel_reply__message`"));
    assert.equal(prompt.includes("channel_reply.message"), false);
  });

  it("states that the final assistant message is not delivered", () => {
    const prompt = composeMessageToolPrompt(null, { channel: "telegram" });
    assert.ok(prompt.includes("only thing the user sees"));
    assert.ok(prompt.includes("final assistant message is not delivered"));
  });

  it("grants the send explicitly, because a model may refuse an ungranted one", () => {
    const prompt = composeMessageToolPrompt(null, { channel: "slack" });
    assert.ok(prompt.includes("already authorized"));
  });

  it("addresses the user from the channel's catalog label", () => {
    assert.ok(composeMessageToolPrompt(null, { channel: "slack" }).includes("asking from Slack"));
    assert.ok(
      composeMessageToolPrompt(null, { channel: "googlechat" }).includes("asking from Google Chat"),
    );
    // The placeholder that used to leak when no channel was threaded through.
    assert.equal(
      composeMessageToolPrompt(null, { channel: "slack" }).includes("from the channel"),
      false,
    );
  });

  it("offers attachments unless the capability cannot send files", () => {
    assert.ok(
      composeMessageToolPrompt(null, { channel: "slack", canSendFiles: true }).includes(
        "`attachments`",
      ),
    );
    assert.equal(
      composeMessageToolPrompt(null, { channel: "slack", canSendFiles: false }).includes(
        "`attachments`",
      ),
      false,
    );
  });

  it("replaces the whole block with a route template, trimmed", () => {
    assert.equal(
      composeMessageToolPrompt("  Reply only through the message tool.  ", { channel: "slack" }),
      "Reply only through the message tool.",
    );
  });

  it("falls back to the default when a template is blank", () => {
    assert.equal(
      composeMessageToolPrompt("   ", { channel: "slack" }),
      composeMessageToolPrompt(null, { channel: "slack" }),
    );
  });
});
