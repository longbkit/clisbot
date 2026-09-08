import { describe, expect, it } from "vitest";
import {
  CHANNEL_COMMAND_BUTTON_TTL_MS,
  clearChannelCommandButtons,
  isChannelCommandButtonToken,
  mintChannelCommandButton,
  mintPresentationCommandButtons,
  redeemChannelCommandButton,
} from "./command-buttons.js";

const ISSUER = {
  organizationId: "org-1",
  channel: "telegram",
  accountId: "acct-1",
  agentId: "agent-1",
  turnId: "turn-1",
  conversationId: "-100777",
  allowedActorIds: ["U-ALICE"],
} as const;

const CLICK = {
  organizationId: "org-1",
  channel: "telegram",
  accountId: "acct-1",
  conversationId: "-100777",
  actorId: "U-ALICE",
} as const;

describe("channel command buttons", () => {
  it("refuses a callback value the Hub never minted", () => {
    expect(redeemChannelCommandButton("/new", CLICK)).toEqual({ ok: false, reason: "unknown" });
    expect(redeemChannelCommandButton("tgcmd:/stop", CLICK)).toEqual({
      ok: false,
      reason: "unknown",
    });
  });

  it("redeems a minted button exactly once", () => {
    const token = mintChannelCommandButton("/new", ISSUER);
    expect(isChannelCommandButtonToken(token)).toBe(true);
    expect(token).not.toContain("new");
    const first = redeemChannelCommandButton(token, CLICK);
    expect(first).toMatchObject({ ok: true, command: "/new" });
    expect(redeemChannelCommandButton(token, CLICK)).toEqual({ ok: false, reason: "unknown" });
  });

  it("refuses a minted button once its TTL has passed", () => {
    const now = 1_000_000;
    const token = mintChannelCommandButton("/stop", ISSUER, { now });
    expect(
      redeemChannelCommandButton(token, CLICK, {
        now: now + CHANNEL_COMMAND_BUTTON_TTL_MS - 1,
      }),
    ).toMatchObject({ ok: true, command: "/stop" });
    const later = mintChannelCommandButton("/stop", ISSUER, { now });
    expect(
      redeemChannelCommandButton(later, CLICK, { now: now + CHANNEL_COMMAND_BUTTON_TTL_MS }),
    ).toEqual({ ok: false, reason: "expired" });
  });

  it("refuses a minted button clicked by a foreign actor, conversation or organization", () => {
    const token = mintChannelCommandButton("/new", ISSUER);
    expect(redeemChannelCommandButton(token, { ...CLICK, actorId: "U-MALLORY" })).toEqual({
      ok: false,
      reason: "foreign-actor",
    });
    expect(redeemChannelCommandButton(token, { ...CLICK, actorId: undefined })).toEqual({
      ok: false,
      reason: "foreign-actor",
    });
    expect(redeemChannelCommandButton(token, { ...CLICK, conversationId: "-100888" })).toEqual({
      ok: false,
      reason: "foreign-conversation",
    });
    expect(redeemChannelCommandButton(token, { ...CLICK, organizationId: "org-2" })).toEqual({
      ok: false,
      reason: "foreign-account",
    });
    // Every refusal above left the token spendable by its own actor.
    expect(redeemChannelCommandButton(token, CLICK)).toMatchObject({ ok: true, command: "/new" });
  });

  // The thread is part of the location a card was posted into: a control minted
  // in one topic ran against the session of another, because only the root
  // conversation was bound.
  it("refuses a button clicked from a different thread than it was posted in", () => {
    const issuer = { ...ISSUER, threadId: "42" };
    const token = mintChannelCommandButton("/stop", issuer);
    expect(redeemChannelCommandButton(token, { ...CLICK, threadId: "43" })).toEqual({
      ok: false,
      reason: "foreign-conversation",
    });
    expect(redeemChannelCommandButton(token, { ...CLICK, threadId: "42" })).toMatchObject({
      ok: true,
      command: "/stop",
    });
  });

  it("rewrites presentation command actions into tokens and leaves other actions alone", () => {
    const minted = mintPresentationCommandButtons(
      {
        blocks: [
          {
            type: "buttons",
            buttons: [
              { label: "Reset", action: { type: "command", command: "/new" } },
              { label: "Docs", url: "https://example.test/docs" },
              { label: "Pick", value: "opaque-callback" },
            ],
          },
          {
            type: "select",
            options: [{ label: "Stop", action: { type: "command", command: "/stop" } }],
          },
        ],
      },
      ISSUER,
    );
    const [buttons, select] = minted.blocks;
    if (buttons?.type !== "buttons" || select?.type !== "select") throw new Error("shape changed");
    const [reset, docs, pick] = buttons.buttons;
    expect(JSON.stringify(minted)).not.toContain("/new");
    expect(reset?.action).toMatchObject({ type: "command" });
    if (!reset?.action) throw new Error("shape changed");
    const token = (reset.action as { command: string }).command;
    expect(isChannelCommandButtonToken(token)).toBe(true);
    expect(docs?.url).toBe("https://example.test/docs");
    expect(pick?.value).toBe("opaque-callback");
    expect(redeemChannelCommandButton(token, CLICK)).toMatchObject({ ok: true, command: "/new" });
    const [option] = select.options;
    if (!option?.action) throw new Error("shape changed");
    const optionToken = (option.action as { command: string }).command;
    expect(redeemChannelCommandButton(optionToken, CLICK)).toMatchObject({
      ok: true,
      command: "/stop",
    });
  });

  it("mints nothing without an allowed actor and drops an account's tokens on teardown", () => {
    expect(() => mintChannelCommandButton("/new", { ...ISSUER, allowedActorIds: [] })).toThrow(
      /allowed actor/,
    );
    const token = mintChannelCommandButton("/new", ISSUER);
    clearChannelCommandButtons(ISSUER.channel, ISSUER.accountId);
    expect(redeemChannelCommandButton(token, CLICK)).toEqual({ ok: false, reason: "unknown" });
  });
});
