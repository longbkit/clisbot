import { expect, test } from "vitest";
import type { ChatPayload } from "@getpaseo/protocol/chats/types";
import {
  groupSettingsPatch,
  hasGroupSettingsChanges,
  openGroupSettingsDraft,
} from "./group-settings-model";
test("settings open from the current chat and save only changed fields", () => {
  const original = openGroupSettingsDraft({
    title: "Launch",
    rules: { interaction: { requireMention: true } },
  } as ChatPayload);
  expect(original).toEqual({
    title: "Launch",
    requireMention: true,
    roomInstructions: "",
    roundsMax: 5,
  });
  expect(groupSettingsPatch({ ...original, roundsMax: 8 }, original)).toEqual({ roundsMax: 8 });
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
test("room instructions save trimmed, clear to the default, and report an over-limit draft", () => {
  const original = openGroupSettingsDraft({
    title: null,
    rules: { room: { instructions: "Be brief." } },
  } as ChatPayload);
  expect(original.roomInstructions).toBe("Be brief.");
  expect(groupSettingsPatch({ ...original, roomInstructions: " Be brief. " }, original)).toBeNull();
  expect(groupSettingsPatch({ ...original, roomInstructions: "  Vietnamese  " }, original)).toEqual(
    { roomInstructions: "Vietnamese" },
  );
  expect(groupSettingsPatch({ ...original, roomInstructions: " " }, original)).toEqual({
    roomInstructions: null,
  });
  const long = { ...original, roomInstructions: "x".repeat(4001) };
  expect(() => groupSettingsPatch(long, original)).toThrow("4000");
  expect(hasGroupSettingsChanges(long, original)).toBe(true);
  expect(hasGroupSettingsChanges(original, original)).toBe(false);
});
