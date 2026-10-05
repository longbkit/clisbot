import { describe, expect, it } from "vitest";
import {
  answersPublicCommand,
  callerChatLines,
  meText,
  PublicCommandThrottle,
  type CommandCaller,
} from "./commands-caller.js";
import type { InboundMessage } from "./plane/types.js";

const STRANGER: CommandCaller = {
  admitted: false,
  manager: false,
  refusal: "no Route serves this chat",
};

function telegram(conversation: InboundMessage["conversation"]): InboundMessage {
  return {
    channel: "telegram",
    accountId: "bot",
    senderIdentity: "telegram:4242",
    text: "/status",
    mentionedBot: true,
    conversation,
    conversationLabel: "Ops",
  };
}

const TOPIC = telegram({ kind: "topic", id: "7", rootConversationId: "-1001", threadId: "7" });

function account(publicCommands?: boolean) {
  return {
    channel: "telegram",
    accountId: "bot",
    connectionId: "connection",
    defaults: publicCommands === undefined ? {} : { publicCommands },
  };
}

const PLANE = {
  organizationId: "org",
  resolveAgentAccessTarget: () => ({ daemonReference: "daemon", projectId: "project" }),
};

describe("/status for a sender the bot does not admit", () => {
  it("names the chat and its topic, and nothing about why", () => {
    const lines = callerChatLines(STRANGER, TOPIC);
    expect(lines).toEqual([
      "Chat ID: -1001 (Ops)",
      "Topic ID: 7",
      "You can't talk to the bot here. To ask for access, send your Hub admin this and your ID (/me).",
    ]);
  });

  it("tells a Connection manager why", () => {
    const lines = callerChatLines({ ...STRANGER, manager: true }, TOPIC);
    expect(lines.at(-1)).toBe("Why (shown to Connection managers): no Route serves this chat.");
  });
});

describe("/me", () => {
  const me = (message: InboundMessage) =>
    meText({
      plane: PLANE,
      message,
      account: account(),
      route: undefined,
      caller: STRANGER,
    });

  it("keeps a Telegram user id out of a group, and shows it in a DM", async () => {
    expect(await me(TOPIC)).toMatch(/^Your ID: not shown in a group here\. Send \/me to the bot/u);
    const dm = telegram({ kind: "dm", id: "4242", rootConversationId: "4242", threadId: null });
    expect(await me(dm)).toMatch(/^Your ID: telegram:4242$/mu);
  });
});

describe("public command throttle", () => {
  it("answers each command once per window per sender", () => {
    let now = 0;
    const throttle = new PublicCommandThrottle(30_000, () => now);
    const ask = (command: string) =>
      answersPublicCommand(STRANGER, { account: account(), message: TOPIC, command }, throttle);
    expect(ask("status")).toBe(true);
    expect(ask("me")).toBe(true);
    expect(ask("status")).toBe(false);
    now = 30_000;
    expect(ask("status")).toBe(true);
  });

  it("stays silent to strangers when publicCommands is off, never to admitted senders", () => {
    const throttle = new PublicCommandThrottle();
    const input = { account: account(false), message: TOPIC, command: "status" };
    expect(answersPublicCommand(STRANGER, input, throttle)).toBe(false);
    expect(answersPublicCommand({ admitted: true, manager: false }, input, throttle)).toBe(true);
  });
});
