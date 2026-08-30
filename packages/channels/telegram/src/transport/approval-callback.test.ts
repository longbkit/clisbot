// E2 (the approval card's button clicks, Telegram half): the channel
// envelope's narrowing — who clicked, where the card sits, which chat kind —
// and the root-kind table. The card VALUE stays opaque (the hub's card-value
// parser owns its format — one parse, hub-side).

import assert from "node:assert/strict";
import { describe, expect, it } from "vitest";
import {
  approvalCallbackRootKind,
  parseApprovalCallbackClick,
  type TelegramCallbackQueryShape,
} from "./approval-callback.js";

// Object.assign (not a spread) so overrides may OMIT keys without tripping
// exactOptionalPropertyTypes on an explicit `undefined`.
function click(overrides: Record<string, unknown> = {}): TelegramCallbackQueryShape {
  return Object.assign(
    {
      id: "cbq-1",
      from: { id: 42, first_name: "Human" },
      message: {
        message_id: 90,
        chat: { id: -100_000_000_001, type: "supergroup", title: "Test Group" },
      },
      data: "allow:card-1",
    },
    overrides,
  ) as TelegramCallbackQueryShape;
}

describe("telegram approval-callback parsing", () => {
  it("narrows a card click: sender, opaque value, root chat, thread, chat type", () => {
    const parsed = parseApprovalCallbackClick(
      click({
        message: {
          message_id: 90,
          chat: { id: -100_000_000_001, type: "supergroup" },
          message_thread_id: 7,
        },
      }),
    );
    expect(parsed).not.toBeNull();
    assert.deepEqual(parsed, {
      senderId: "42",
      cardValue: "allow:card-1",
      rootChatId: "-100000000001",
      threadId: "7",
      chatType: "supergroup",
      messageId: "90",
    });
  });

  it("omits threadId at the chat root (no message_thread_id)", () => {
    const parsed = parseApprovalCallbackClick(click());
    expect(parsed?.threadId).toBeUndefined();
    expect(parsed?.chatType).toBe("supergroup");
  });

  it("rejects unactionable shapes (no clicker / empty data / no host chat)", () => {
    expect(parseApprovalCallbackClick(click({ from: undefined }))).toBeNull();
    expect(parseApprovalCallbackClick(click({ data: "" }))).toBeNull();
    expect(parseApprovalCallbackClick(click({ data: undefined }))).toBeNull();
    expect(parseApprovalCallbackClick(click({ message: undefined }))).toBeNull();
    expect(parseApprovalCallbackClick(click({ message: { chat: {}, message_id: 90 } }))).toBeNull();
  });

  it("normalizes the root kind: private → dm, everything else → group", () => {
    expect(approvalCallbackRootKind("private")).toBe("dm");
    expect(approvalCallbackRootKind("group")).toBe("group");
    expect(approvalCallbackRootKind("supergroup")).toBe("group");
    expect(approvalCallbackRootKind("channel")).toBe("group");
    expect(approvalCallbackRootKind(undefined)).toBe("group");
  });
});
