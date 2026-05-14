import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  buildPairingReply,
  buildPairingQueueFullReply,
  buildPairingReplyFromRequest,
} from "../src/channels/pairing/messages.ts";
import { setRenderedCliName } from "../src/control/commands/cli-name.ts";

let previousCliName: string | undefined;

beforeEach(() => {
  previousCliName = process.env.CLISBOT_CLI_NAME;
  delete process.env.CLISBOT_CLI_NAME;
  setRenderedCliName();
});

afterEach(() => {
  process.env.CLISBOT_CLI_NAME = previousCliName;
  setRenderedCliName(previousCliName);
});

describe("buildPairingReply", () => {
  test("renders the concrete approval command with the issued code", () => {
    const text = buildPairingReply({
      channel: "slack",
      idLine: "Your Slack user id: U123",
      code: "EUQZL644",
    });

    expect(text).toContain("Pairing code: EUQZL644");
    expect(text).toContain("clisbot pairing approve slack EUQZL644");
    expect(text).not.toContain("clisbot pairing approve slack <code>");
  });

  test("reuses the existing pending code instead of going silent", () => {
    const text = buildPairingReplyFromRequest({
      channel: "telegram",
      idLine: "Your Telegram user id: 1276408333",
      pairingRequest: {
        code: "PAIR1234",
        created: false,
      },
    });

    expect(text).toContain("Pairing code: PAIR1234");
    expect(text).toContain("clisbot pairing approve telegram PAIR1234");
  });

  test("does not render a reply when the pairing store could not issue a code", () => {
    const text = buildPairingReplyFromRequest({
      channel: "slack",
      idLine: "Your Slack user id: U123",
      pairingRequest: {
        code: "",
        created: false,
      },
    });

    expect(text).toContain("Pairing queue is full right now.");
    expect(text).toContain("clisbot pairing list slack");
    expect(text).toContain("clisbot pairing reject slack <code>");
    expect(text).toContain("clisbot pairing clear slack");
  });

  test("renders queue-full guidance directly", () => {
    const text = buildPairingQueueFullReply({
      channel: "telegram",
      idLine: "Your Telegram user id: 1276408333",
    });

    expect(text).toContain("Pairing queue is full right now.");
    expect(text).toContain("clisbot pairing list telegram");
    expect(text).toContain("clisbot pairing reject telegram <code>");
    expect(text).toContain("clisbot pairing clear telegram");
  });
});
