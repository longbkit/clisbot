// COMPAT(clisbot-control-plane): unit tests for the shared channel text
// commands (commands.ts) — the parser is channel-agnostic, so the cases cover
// the spellings BOTH channels must accept: bare verbs, slash-prefixed, and
// Telegram's @bot-mention gluing.

import assert from "node:assert/strict";
import { describe, expect, it } from "vitest";
import { parseChannelTextCommand } from "./commands.js";
import { parseApprovalCommand } from "./approvals/command.js";

describe("parseApprovalCommand", () => {
  it("parses the plain and slash forms with an explicit id", () => {
    assert.deepEqual(parseApprovalCommand("approve req-42"), {
      decision: "allow",
      requestId: "req-42",
    });
    assert.deepEqual(parseApprovalCommand("  deny req-42 "), {
      decision: "deny",
      requestId: "req-42",
    });
    assert.deepEqual(parseApprovalCommand("/approve req-42"), {
      decision: "allow",
      requestId: "req-42",
    });
    assert.deepEqual(parseApprovalCommand("/deny req-42."), {
      decision: "deny",
      requestId: "req-42",
    });
    assert.deepEqual(parseApprovalCommand("approve a.b_c-1"), {
      decision: "allow",
      requestId: "a.b_c-1",
    });
  });

  it("parses a bare verb as the 'latest' target", () => {
    assert.deepEqual(parseApprovalCommand("approve"), { decision: "allow" });
    assert.deepEqual(parseApprovalCommand("/deny"), { decision: "deny" });
    assert.deepEqual(parseApprovalCommand("/approve "), { decision: "allow" });
  });

  it("keeps the answer remainder verbatim for question prompts", () => {
    assert.deepEqual(parseApprovalCommand("/approve req-q Other my own text"), {
      decision: "allow",
      requestId: "req-q",
      answer: "Other my own text",
    });
    assert.deepEqual(parseApprovalCommand("approve req-q Biome"), {
      decision: "allow",
      requestId: "req-q",
      answer: "Biome",
    });
  });

  it("accepts the Slack backslash spelling", () => {
    assert.deepEqual(parseApprovalCommand("\\approve"), { decision: "allow" });
    assert.deepEqual(parseApprovalCommand("\\deny req-42"), {
      decision: "deny",
      requestId: "req-42",
    });
    assert.deepEqual(parseApprovalCommand("\\approve req-q Other my own text"), {
      decision: "allow",
      requestId: "req-q",
      answer: "Other my own text",
    });
  });

  it("tolerates a leading Telegram @bot mention (glued, spaced, punctuated)", () => {
    assert.deepEqual(parseApprovalCommand("@longluong3bot /approve"), {
      decision: "allow",
    });
    assert.deepEqual(parseApprovalCommand("@longluong3bot /approve req-1"), {
      decision: "allow",
      requestId: "req-1",
    });
    assert.deepEqual(parseApprovalCommand("@longluong3bot/approve req-1"), {
      decision: "allow",
      requestId: "req-1",
    });
    assert.deepEqual(parseApprovalCommand("/approve@longluong3bot req-1"), {
      decision: "allow",
      requestId: "req-1",
    });
    assert.deepEqual(parseApprovalCommand("@bot @bot deny"), { decision: "deny" });
    assert.deepEqual(parseApprovalCommand("@bot @bot /approve req-1"), {
      decision: "allow",
      requestId: "req-1",
    });
    assert.deepEqual(parseApprovalCommand("\\approve@longluong3bot"), { decision: "allow" });
    assert.deepEqual(parseApprovalCommand("@bot /approve@longluong3bot req-1"), {
      decision: "allow",
      requestId: "req-1",
    });
  });

  it("accepts a leading Slack <@U…> mention addressing the bot", () => {
    assert.deepEqual(parseApprovalCommand("<@U8ZTVGJJF> /approve"), { decision: "allow" });
    assert.deepEqual(parseApprovalCommand("<@U8ZTVGJJF> deny req-1"), {
      decision: "deny",
      requestId: "req-1",
    });
    assert.deepEqual(parseChannelTextCommand("<@U8ZTVGJJF> /status"), { name: "status" });
  });

  it("accepts every approval address form used by Slack and Telegram", () => {
    for (const text of [
      "/approve",
      "/approve abc123 answer",
      "\\approve",
      "approve abc123",
      "<@U123> /approve",
    ]) {
      assert.equal(parseApprovalCommand(text)?.decision, "allow");
    }
    assert.deepEqual(parseApprovalCommand("/approve@botname abc123."), {
      decision: "allow",
      requestId: "abc123",
    });
    assert.deepEqual(parseApprovalCommand("@bot/approve abc123"), {
      decision: "allow",
      requestId: "abc123",
    });
    assert.deepEqual(parseApprovalCommand("@bot@bot /deny abc123."), {
      decision: "deny",
      requestId: "abc123",
    });
  });

  it("rejects anything that is not a command", () => {
    assert.equal(parseApprovalCommand("please approve"), null);
    assert.equal(parseApprovalCommand("approve !bad-id!"), null);
    assert.equal(parseApprovalCommand("maybe req-1"), null);
    assert.equal(parseApprovalCommand("hello @longluong3bot"), null);
    assert.equal(parseApprovalCommand(""), null);
    assert.equal(parseApprovalCommand("deny me an extension"), null);
  });
});

describe("parseChannelTextCommand", () => {
  it("parses the shared verbs, with or without a leading slash", () => {
    assert.deepEqual(parseChannelTextCommand("/status"), { name: "status" });
    assert.deepEqual(parseChannelTextCommand("status"), { name: "status" });
    assert.deepEqual(parseChannelTextCommand("/STOP"), { name: "stop" });
    assert.deepEqual(parseChannelTextCommand("/new"), { name: "new" });
    assert.deepEqual(parseChannelTextCommand("/help"), { name: "help" });
  });

  it("accepts the alias verbs", () => {
    assert.deepEqual(parseChannelTextCommand("/state"), { name: "status" });
    assert.deepEqual(parseChannelTextCommand("/cancel"), { name: "stop" });
    assert.deepEqual(parseChannelTextCommand("/reset"), { name: "new" });
  });

  it("tolerates a leading @bot mention, glued or spaced", () => {
    assert.deepEqual(parseChannelTextCommand("@longluong3bot /status"), { name: "status" });
    assert.deepEqual(parseChannelTextCommand("@longluong3bot/status"), { name: "status" });
    assert.deepEqual(parseChannelTextCommand("/stop@longluong3bot"), { name: "stop" });
    assert.deepEqual(parseChannelTextCommand("@bot @bot /help"), { name: "help" });
  });

  it("accepts the Slack backslash spelling", () => {
    assert.deepEqual(parseChannelTextCommand("\\status"), { name: "status" });
    assert.deepEqual(parseChannelTextCommand("\\STOP"), { name: "stop" });
    assert.deepEqual(parseChannelTextCommand("\\help"), { name: "help" });
  });

  it("rejects unknown verbs and ordinary prose", () => {
    expect(parseChannelTextCommand("/frobnicate")).toBeNull();
    expect(parseChannelTextCommand("the status of my order")).toBeNull();
    expect(parseChannelTextCommand("hello @longluong3bot")).toBeNull();
    expect(parseChannelTextCommand("")).toBeNull();
  });

  it("carries an argument for /agent and /model only", () => {
    assert.deepEqual(parseChannelTextCommand("/model gpt-5.6-luna"), {
      name: "model",
      value: "gpt-5.6-luna",
    });
    assert.deepEqual(parseChannelTextCommand("@longluong3bot /agent reviewer"), {
      name: "agent",
      value: "reviewer",
    });
    assert.deepEqual(parseChannelTextCommand("\\model  claude sonnet "), {
      name: "model",
      value: "claude sonnet",
    });
    assert.deepEqual(parseChannelTextCommand("/model"), { name: "model" });
  });

  it("keeps a no-argument verb whole-message, so prose stays prose", () => {
    expect(parseChannelTextCommand("stop doing that")).toBeNull();
    expect(parseChannelTextCommand("/new session please")).toBeNull();
    expect(parseChannelTextCommand("help me with this")).toBeNull();
  });
});
