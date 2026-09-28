import { expect, test } from "vitest";
import type { ChatPayload } from "@getpaseo/protocol/chats/types";
import { groupSettingsPatch, openGroupSettingsDraft } from "./group-settings-model";
test("settings open from the current chat and save only changed fields", () => {
  const original = openGroupSettingsDraft({
    title: "Launch",
    rules: { interaction: { requireMention: true } },
  } as ChatPayload);
  expect(original).toEqual({ title: "Launch", requireMention: true });
  expect(groupSettingsPatch(original, original)).toBeNull();
  expect(groupSettingsPatch({ ...original, title: "  New name  " }, original)).toEqual({
    title: "New name",
  });
  expect(groupSettingsPatch({ ...original, title: " " }, original)).toEqual({ title: null });
  expect(groupSettingsPatch({ ...original, requireMention: false }, original)).toEqual({
    requireMention: false,
  });
  expect(() => groupSettingsPatch({ ...original, title: "x".repeat(257) }, original)).toThrow(
    "256",
  );
});
