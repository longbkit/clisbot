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
  search: "ct",
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
      search: "",
    });
  });
  it("rejects stale or cross-Host bot selection", () => {
    expect(() => groupChatRequest(draft, ["a"])).toThrow("Choose at least two bots");
  });
  it("keeps a selected bot while search is changed and toggles without duplicates", () => {
    expect(toggleGroupBot(draft, "a").botIds).toEqual(["b"]);
    expect(toggleGroupBot(draft, "c").botIds).toEqual(["a", "b", "c"]);
  });
});
