// The upstream admission matrix, run through the Hub's adapter. Each case names
// the upstream reason code, so a drift in the ported decision shows up here as a
// reason-code change rather than a silent behaviour change.
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { InboundMessage } from "../plane/types.js";
import { DM_GROUP_ACCESS_REASON, evaluateChannelAccess } from "./access.js";

function dm(senderIdentity = "telegram:12345"): InboundMessage {
  return {
    channel: "telegram",
    accountId: "work",
    senderIdentity,
    text: "hello",
    mentionedBot: true,
    conversation: { kind: "dm", id: "12345", rootConversationId: "12345", threadId: null },
  };
}

function group(senderIdentity = "telegram:12345"): InboundMessage {
  return { ...dm(senderIdentity), conversation: { ...dm().conversation, kind: "group" } };
}

describe("dm policy", () => {
  it("open with a wildcard admits anyone", () => {
    const decision = evaluateChannelAccess({
      access: { dmPolicy: "open", allowFrom: ["*"] },
      message: dm("telegram:99"),
      storeAllowFrom: [],
    });
    assert.equal(decision.decision, "allow");
    assert.equal(decision.reasonCode, DM_GROUP_ACCESS_REASON.DM_POLICY_OPEN);
  });

  it("open with a list still refuses a sender outside it", () => {
    const decision = evaluateChannelAccess({
      access: { dmPolicy: "open", allowFrom: ["12345"] },
      message: dm("telegram:99"),
      storeAllowFrom: [],
    });
    assert.equal(decision.decision, "block");
    assert.equal(decision.reasonCode, DM_GROUP_ACCESS_REASON.DM_POLICY_NOT_ALLOWLISTED);
  });

  it("disabled refuses even an allowlisted sender", () => {
    const decision = evaluateChannelAccess({
      access: { dmPolicy: "disabled", allowFrom: ["12345"] },
      message: dm(),
      storeAllowFrom: [],
    });
    assert.equal(decision.decision, "block");
    assert.equal(decision.reasonCode, DM_GROUP_ACCESS_REASON.DM_POLICY_DISABLED);
  });

  it("allowlist admits a listed sender by bare id and by prefixed identity", () => {
    for (const allowFrom of [["12345"], ["telegram:12345"]]) {
      const decision = evaluateChannelAccess({
        access: { dmPolicy: "allowlist", allowFrom },
        message: dm(),
        storeAllowFrom: [],
      });
      assert.equal(decision.decision, "allow", allowFrom.join());
      assert.equal(decision.reasonCode, DM_GROUP_ACCESS_REASON.DM_POLICY_ALLOWLISTED);
    }
  });

  it("allowlist refuses an unlisted sender without offering pairing", () => {
    const decision = evaluateChannelAccess({
      access: { dmPolicy: "allowlist", allowFrom: ["12345"] },
      message: dm("telegram:99"),
      storeAllowFrom: [],
    });
    assert.equal(decision.decision, "block");
    assert.equal(decision.reasonCode, DM_GROUP_ACCESS_REASON.DM_POLICY_NOT_ALLOWLISTED);
  });

  it("pairing asks an unknown sender to pair", () => {
    const decision = evaluateChannelAccess({
      access: { dmPolicy: "pairing" },
      message: dm("telegram:99"),
      storeAllowFrom: [],
    });
    assert.equal(decision.decision, "pairing");
    assert.equal(decision.reasonCode, DM_GROUP_ACCESS_REASON.DM_POLICY_PAIRING_REQUIRED);
  });

  it("pairing admits a sender an operator already approved", () => {
    const decision = evaluateChannelAccess({
      access: { dmPolicy: "pairing" },
      message: dm("telegram:99"),
      storeAllowFrom: ["telegram:99"],
    });
    assert.equal(decision.decision, "allow");
    assert.equal(decision.reasonCode, DM_GROUP_ACCESS_REASON.DM_POLICY_ALLOWLISTED);
  });

  it("only pairing mode reads the approved list — an allowlist policy ignores it", () => {
    const decision = evaluateChannelAccess({
      access: { dmPolicy: "allowlist" },
      message: dm("telegram:99"),
      storeAllowFrom: ["telegram:99"],
    });
    assert.equal(decision.decision, "block");
  });
});

describe("group policy", () => {
  it("open admits anyone", () => {
    const decision = evaluateChannelAccess({
      access: { groupPolicy: "open" },
      message: group("telegram:99"),
      storeAllowFrom: [],
    });
    assert.equal(decision.decision, "allow");
    assert.equal(decision.reasonCode, DM_GROUP_ACCESS_REASON.GROUP_POLICY_ALLOWED);
  });

  it("disabled refuses", () => {
    const decision = evaluateChannelAccess({
      access: { groupPolicy: "disabled" },
      message: group(),
      storeAllowFrom: [],
    });
    assert.equal(decision.decision, "block");
    assert.equal(decision.reasonCode, DM_GROUP_ACCESS_REASON.GROUP_POLICY_DISABLED);
  });

  it("the default is allowlist, and an empty list refuses everyone", () => {
    const decision = evaluateChannelAccess({
      access: { dmPolicy: "open" },
      message: group(),
      storeAllowFrom: [],
    });
    assert.equal(decision.decision, "block");
    assert.equal(decision.reasonCode, DM_GROUP_ACCESS_REASON.GROUP_POLICY_EMPTY_ALLOWLIST);
  });

  it("groupAllowFrom overrides allowFrom for group conversations", () => {
    const access = { groupPolicy: "allowlist" as const, allowFrom: ["1"], groupAllowFrom: ["2"] };
    assert.equal(
      evaluateChannelAccess({ access, message: group("telegram:1"), storeAllowFrom: [] }).decision,
      "block",
    );
    assert.equal(
      evaluateChannelAccess({ access, message: group("telegram:2"), storeAllowFrom: [] }).decision,
      "allow",
    );
  });

  it("without groupAllowFrom the DM list applies, unless the fallback is switched off", () => {
    const message = group("telegram:1");
    assert.equal(
      evaluateChannelAccess({
        access: { groupPolicy: "allowlist", allowFrom: ["1"] },
        message,
        storeAllowFrom: [],
      }).decision,
      "allow",
    );
    assert.equal(
      evaluateChannelAccess({
        access: {
          groupPolicy: "allowlist",
          allowFrom: ["1"],
          groupAllowFromFallbackToAllowFrom: false,
        },
        message,
        storeAllowFrom: [],
      }).reasonCode,
      DM_GROUP_ACCESS_REASON.GROUP_POLICY_EMPTY_ALLOWLIST,
    );
  });

  it("a thread inside a channel is a group, not a DM", () => {
    const decision = evaluateChannelAccess({
      access: { dmPolicy: "open", allowFrom: ["*"], groupPolicy: "disabled" },
      message: {
        ...dm(),
        conversation: { kind: "thread", id: "t1", rootConversationId: "C1", threadId: "t1" },
      },
      storeAllowFrom: [],
    });
    assert.equal(decision.reasonCode, DM_GROUP_ACCESS_REASON.GROUP_POLICY_DISABLED);
  });
});
