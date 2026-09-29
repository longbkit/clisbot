import { describe, expect, it } from "vitest";
import {
  groupChatRequest,
  selectGroupHost,
  toggleGroupBot,
  type GroupChatDraft,
} from "./group-chat-form-model";
const draft: GroupChatDraft = {
  serverId: "host-a",
  botIds: ["a", "b"],
  title: " Launch ",
  requireMention: false,
};
describe("group creation", () => {
  it("preserves the default server safeguards rather than submitting arbitrary limits", () => {
    expect(groupChatRequest(draft, ["a", "b"])).toEqual({
      kind: "group",
      botIds: ["a", "b"],
      title: "Launch",
      rules: { interaction: { requireMention: false } },
    });
  });
  it("clears bot selections only when changing Host", () => {
    expect(selectGroupHost(draft, "host-a")).toBe(draft);
    expect(selectGroupHost(draft, "host-b")).toEqual({
      ...draft,
      serverId: "host-b",
      botIds: [],
    });
  });
  it("accepts one bot and rejects a selection with no bot left on the Host", () => {
    expect(groupChatRequest(draft, ["a"]).botIds).toEqual(["a"]);
    expect(() => groupChatRequest(draft, ["c"])).toThrow("Choose at least one bot");
  });
  it("toggles without duplicates", () => {
    expect(toggleGroupBot(draft, "a").botIds).toEqual(["b"]);
    expect(toggleGroupBot(draft, "c").botIds).toEqual(["a", "b", "c"]);
  });
});
