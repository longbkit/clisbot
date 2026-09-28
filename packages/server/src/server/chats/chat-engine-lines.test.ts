import { expect, test } from "vitest";
import { roomUpdateFor } from "./chat-engine-lines.js";
import { roomFingerprint, type RoomContractInput } from "./room-contract.js";

const cto = { slug: "cto", displayName: "CTO", description: "Owns the stack" };
const room: RoomContractInput = { chatTitle: "Launch", self: cto, members: [cto] };

test("a session that never saw the room gets the whole contract, rules included", () => {
  const update = roomUpdateFor(room, undefined);
  expect(update).toContain("You are CTO (@cto)");
  expect(update).toContain("reply with exactly PASS");
});

test("a session that saw this room hears nothing; one that saw an older room hears the update", () => {
  expect(roomUpdateFor(room, roomFingerprint(room))).toBeNull();
  expect(roomUpdateFor(room, "older")?.startsWith("[Room update]")).toBe(true);
});
