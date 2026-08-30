// L2 approval-card parser tests. The envelopes here mirror the REAL Socket
// Mode `block_actions` payload (the live 2026-08-29 click: the conversation
// is the top-level `channel` OBJECT, the stored `message` carries no
// `channel` field) — not the parser's imagination.

import assert from "node:assert/strict";
import { describe, expect, it } from "vitest";
import { approvalRootKind, parseApprovalCardClick } from "./approval-card.js";

function realClickBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: "block_actions",
    user: { id: "U0A1B2C3D4", username: "long", team_id: "T6YPB58N6" },
    api_app_id: "A08NPN83G12",
    token: "redacted",
    container: {
      type: "message_attachment",
      message_ts: "1788024705.123456",
      channel_id: "C07U0LDK6ER",
      is_ephemeral: false,
      is_app_unfurl: false,
    },
    trigger_id: "T01",
    team: { id: "T6YPB58N6", domain: "vexere" },
    channel: { id: "C07U0LDK6ER", name: "long-luong-workspace" },
    message: {
      bot_id: "B0ABC",
      type: "message",
      text: "Bash wants to run: ls ~/projects",
      user: "U0BOT",
      ts: "1788024705.123456",
      thread_ts: "1788024627.188659",
    },
    response_url: "https://hooks.slack.com/actions/T6/123/abc",
    actions: [
      {
        action_id: "approval_action_1",
        block_id: "approval_actions",
        type: "button",
        text: { type: "plain_text", text: "Approve" },
        value: "allow:permission-exec-1cf40d5d-0000-0000-0000-000000000000",
        style: "primary",
        action_ts: "1788024720.000000",
      },
    ],
    ...overrides,
  };
}

describe("slack approval-card: parseApprovalCardClick (the real wire shape)", () => {
  it("parses a threaded card click from the top-level channel object", () => {
    const click = parseApprovalCardClick(realClickBody());
    assert.ok(click);
    assert.equal(click.senderId, "U0A1B2C3D4");
    assert.equal(click.cardValue, "allow:permission-exec-1cf40d5d-0000-0000-0000-000000000000");
    assert.equal(click.rootChannelId, "C07U0LDK6ER");
    assert.equal(click.threadTs, "1788024627.188659");
    assert.equal(click.messageTs, "1788024705.123456");
  });

  it("parses a root (non-threaded) card click", () => {
    const body = realClickBody();
    (body["message"] as Record<string, unknown>)["thread_ts"] = undefined;
    const click = parseApprovalCardClick(body);
    assert.ok(click);
    assert.equal(click.threadTs, undefined);
  });

  it("falls back to container.channel_id when the top-level channel is absent", () => {
    const body = realClickBody();
    delete body["channel"];
    const click = parseApprovalCardClick(body);
    assert.ok(click);
    assert.equal(click.rootChannelId, "C07U0LDK6ER");
  });

  it("returns null for a non-block_actions payload", () => {
    expect(parseApprovalCardClick({ type: "view_submission" })).toBeNull();
  });

  it("returns null when no message is attached (modal / Home-tab click)", () => {
    const body = realClickBody();
    delete body["message"];
    expect(parseApprovalCardClick(body)).toBeNull();
  });

  it("returns null when the clicked element carries no value", () => {
    const body = realClickBody({
      actions: [{ action_id: "other", type: "button", text: { type: "plain_text", text: "x" } }],
    });
    expect(parseApprovalCardClick(body)).toBeNull();
  });

  it("returns null when the conversation id is nowhere to be found", () => {
    const body = realClickBody();
    delete body["channel"];
    (body["container"] as Record<string, unknown>)["channel_id"] = "";
    expect(parseApprovalCardClick(body)).toBeNull();
  });
});

describe("slack approval-card: approvalRootKind", () => {
  it("maps the id prefixes to the plane's root kinds", () => {
    assert.equal(approvalRootKind("D01ABC"), "dm");
    assert.equal(approvalRootKind("G01ABC"), "group");
    assert.equal(approvalRootKind("C07U0LDK6ER"), "channel");
  });
});
