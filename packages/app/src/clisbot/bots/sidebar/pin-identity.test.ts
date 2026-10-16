import { expect, it } from "vitest";
import {
  canonicalPin,
  normalizePins,
  createPinIdentityCatalog,
  type PinChat,
} from "./pin-identity";
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

it("keeps only proved alias identity for unavailable pins and clears it on principal change/removal", () => {
  const identify = createPinIdentityCatalog();
  const sensitive = {
    ...dm,
    participants: [{ botId: "bot", agentId: "private-agent", displayName: "Private name" }],
  };
  identify("owner", [directPin, botPin], [sensitive]);
  const offline = identify("owner", [directPin, botPin], []);
  expect(offline).toEqual([
    { serverId: "a", id: "dm", kind: "direct", participants: [{ botId: "bot", agentId: null }] },
  ]);
  expect(normalizePins([directPin, botPin], offline)).toEqual([botPin]);
  expect(identify("another-principal", [directPin, botPin], [])).toEqual([]);
  identify("owner", [directPin], [sensitive]);
  identify("owner", [], []);
  expect(identify("owner", [directPin], [])).toEqual([]);
});
it("a newly authoritative group identity replaces a previous alias without carrying metadata", () => {
  const identify = createPinIdentityCatalog();
  identify("owner", [directPin], [dm]);
  const group = { ...dm, kind: "group" as const };
  expect(canonicalPin(directPin, identify("owner", [directPin], [group]))).toEqual(directPin);
  expect(identify("owner", [directPin], [])).toEqual([]);
});
