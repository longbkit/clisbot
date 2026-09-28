import { expect, it } from "vitest";
import { canonicalPin, normalizePins, type PinChat } from "./pin-identity";
import type { ResourcePin } from "./pins";
const dm: PinChat = {
  serverId: "a",
  id: "dm",
  kind: "direct",
  participants: [{ botId: "bot", agentId: null }],
};
const directPin: ResourcePin = { kind: "chat", serverId: "a", id: "dm" };
const botPin: ResourcePin = { kind: "bot", serverId: "a", id: "bot" };
it("shows one bot row in the original pin position for legacy DM/bot duplicates", () => {
  const project: ResourcePin = { kind: "project", serverId: "a", id: "p" };
  const pins = [directPin, project, botPin, directPin];
  expect(normalizePins(pins, [dm])).toEqual([botPin, project]);
  expect(pins).toEqual([directPin, project, botPin, directPin]);
});
it("never merges a one-bot group with the bot, but supports older untyped DMs", () => {
  expect(canonicalPin(directPin, [{ ...dm, kind: "group" }])).toEqual(directPin);
  expect(canonicalPin(directPin, [{ ...dm, kind: undefined }])).toEqual(botPin);
});
it("does not infer identity from an unavailable or another Host's conversation", () => {
  expect(normalizePins([directPin, botPin], [])).toEqual([directPin, botPin]);
  expect(canonicalPin(directPin, [{ ...dm, serverId: "b" }])).toEqual(directPin);
  expect(canonicalPin(directPin, [{ ...dm, participants: [] }])).toEqual(directPin);
});
it("retains independent bot identities for two Hosts with matching ids", () => {
  const otherPin = { ...directPin, serverId: "b" };
  expect(normalizePins([directPin, otherPin], [dm, { ...dm, serverId: "b" }])).toEqual([
    botPin,
    { ...botPin, serverId: "b" },
  ]);
});
