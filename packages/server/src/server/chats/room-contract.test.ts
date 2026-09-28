import { describe, expect, test } from "vitest";
import {
  DEFAULT_ROOM_INSTRUCTIONS,
  isSilentReply,
  renderRoomContract,
  renderRoomUpdate,
  roomFingerprint,
  type RoomContractInput,
} from "./room-contract.js";

const product = {
  slug: "head-of-product",
  displayName: "Head of Product",
  description: "Owns scope and priorities",
};
const cto = { slug: "cto", displayName: "CTO", description: null };
const room: RoomContractInput = {
  chatTitle: "Launch",
  self: product,
  members: [product, cto],
};

describe("renderRoomContract", () => {
  test("names the bot, lists every member by slug and role, and states the rules", () => {
    const prompt = renderRoomContract(room);
    expect(prompt).toContain(
      'You are Head of Product (@head-of-product) in the group chat "Launch".',
    );
    expect(prompt).toContain("Your role: Owns scope and priorities");
    expect(prompt).toContain("- @head-of-product — Head of Product — Owns scope and priorities");
    expect(prompt).toContain("reply with exactly PASS");
    expect(prompt).toContain("Never write @everyone.");
  });

  test("a bot without a description is known by its name", () => {
    expect(renderRoomContract(room)).toContain("- @cto — CTO — CTO");
  });

  test("uses the default instructions until the owner writes some, then theirs", () => {
    expect(renderRoomContract(room)).toContain(DEFAULT_ROOM_INSTRUCTIONS);
    expect(renderRoomContract({ ...room, instructions: "   " })).toContain(
      DEFAULT_ROOM_INSTRUCTIONS,
    );
    const custom = renderRoomContract({ ...room, instructions: "Answer in Vietnamese." });
    expect(custom).toContain("<<<\nAnswer in Vietnamese.\n>>>");
    expect(custom).not.toContain(DEFAULT_ROOM_INSTRUCTIONS);
  });
});

describe("roomFingerprint", () => {
  test("changes with members, descriptions and instructions, not with who is asking", () => {
    const base = roomFingerprint(room);
    expect(roomFingerprint({ ...room, self: cto })).toBe(base);
    expect(roomFingerprint({ ...room, members: [product] })).not.toBe(base);
    expect(
      roomFingerprint({ ...room, members: [product, { ...cto, description: "Owns the stack" }] }),
    ).not.toBe(base);
    expect(roomFingerprint({ ...room, instructions: "Be brief." })).not.toBe(base);
  });
});

test("renderRoomUpdate restates the members and the instructions", () => {
  const update = renderRoomUpdate({ ...room, instructions: "Be brief." });
  expect(update.startsWith("[Room update]")).toBe(true);
  expect(update).toContain("- @cto — CTO — CTO");
  expect(update).toContain("Be brief.");
});

test("isSilentReply accepts no text, blank text and PASS only", () => {
  expect(isSilentReply(null)).toBe(true);
  expect(isSilentReply("  ")).toBe(true);
  expect(isSilentReply(" PASS \n")).toBe(true);
  expect(isSilentReply("PASS, but one note")).toBe(false);
  expect(isSilentReply("Agreed.")).toBe(false);
});
