import { describe, expect, it, vi } from "vitest";
import {
  applyTeamAdditions,
  canApplyTeamAdditions,
  invitePreview,
  pendingInvitationNotes,
  planTeamAdditions,
  readPeopleInput,
} from "./team-additions";

const alice = {
  id: "m-1",
  userId: "u-1",
  name: "Alice",
  email: "Alice@example.test",
  role: "member" as const,
};
const bob = {
  id: "m-2",
  userId: "u-2",
  name: "Bob",
  email: "bob@example.test",
  role: "admin" as const,
};
const teams = [
  { id: "t-1", name: "Support", userIds: ["u-1"], createdAt: "", updatedAt: "" },
  { id: "t-2", name: "Sales", userIds: [], createdAt: "", updatedAt: "" },
];
const pendingInvitation = {
  id: "i-1",
  email: "pending@example.test",
  role: "admin" as const,
  expiresAt: "",
  link: "",
  teams: [{ id: "t-1", name: "Support" }],
};

function plan(input: { pickedUserIds?: string[]; emailText?: string; teamIds?: string[] }) {
  return planTeamAdditions({
    pickedUserIds: input.pickedUserIds ?? [],
    emailText: input.emailText ?? "",
    teamIds: input.teamIds ?? [],
    members: [alice, bob],
    teams,
    invitations: [pendingInvitation],
  });
}

describe("planTeamAdditions", () => {
  it("recognizes typed emails of Members and invites only the rest", () => {
    const result = plan({
      pickedUserIds: ["u-2"],
      emailText: "alice@example.test, bob@example.test new@example.test bad@",
      teamIds: ["t-2", "gone"],
    });
    expect(result.members.map(({ userId }) => userId)).toEqual(["u-2", "u-1"]);
    expect(result.invitees).toEqual(["new@example.test"]);
    expect(result.invalid).toEqual(["bad@"]);
    expect(result.teamIds).toEqual(["t-2"]);
    expect(canApplyTeamAdditions(result)).toBe(false);
  });
  it("needs a Team whenever Members are included, even beside invitations", () => {
    expect(canApplyTeamAdditions(plan({ pickedUserIds: ["u-1"] }))).toBe(false);
    expect(
      canApplyTeamAdditions(plan({ pickedUserIds: ["u-1"], emailText: "new@example.test" })),
    ).toBe(false);
    const invite = plan({ emailText: "new@example.test" });
    expect(canApplyTeamAdditions(invite)).toBe(true);
    expect(invitePreview(invite, teams)).toBe("1 invitation will be sent");
  });
  it("previews what one field of names and emails will do", () => {
    const input = readPeopleInput("Alice, bob@example.test\nnew@example.test; Nobody", [
      alice,
      bob,
    ]);
    expect(input).toEqual({
      pickedUserIds: ["u-1"],
      emailText: "bob@example.test\nnew@example.test",
      unknown: ["Nobody"],
    });
    const result = plan({
      pickedUserIds: input.pickedUserIds,
      emailText: `${input.emailText}\npending@example.test`,
      teamIds: ["t-1", "t-2"],
    });
    expect(invitePreview(result, teams)).toBe(
      "2 Members join Support, Sales now · 1 invitation will be sent · 1 pending invitation gains Teams",
    );
    expect(invitePreview(plan({ emailText: "pending@example.test" }), teams)).toBe(
      "1 pending invitation is renewed",
    );
  });
  it("keeps the Teams of a pending invitation and says it is renewed", () => {
    const result = plan({ emailText: "pending@example.test", teamIds: ["t-2"] });
    expect(result.pending).toEqual({
      "pending@example.test": { teamIds: ["t-1"], teamNames: ["Support"] },
    });
    expect(pendingInvitationNotes(result, "member")).toEqual([
      "pending@example.test already has a pending invitation, keeps Support; it is renewed as Member.",
    ]);
  });
});

describe("applyTeamAdditions", () => {
  it("skips Teams a Member is already in and reports refusals without stopping", async () => {
    const result = plan({
      pickedUserIds: ["u-1", "u-2"],
      emailText: "new@example.test taken@example.test pending@example.test",
      teamIds: ["t-2"],
    });
    const addTeamMember = vi.fn(async (_teamId: string, userId: string) => {
      if (userId === "u-2") throw new Error("Member unavailable.");
    });
    const invite = vi.fn(async ({ email }: { email: string }) => {
      if (email === "taken@example.test") throw new Error("Hub account request failed (409).");
    });
    const failures = await applyTeamAdditions(result, "member", teams, { addTeamMember, invite });
    expect(addTeamMember.mock.calls).toEqual([
      ["t-2", "u-1"],
      ["t-2", "u-2"],
    ]);
    // One Team is sent as `teamId`, which Hubs before multi-Team invitations also accept.
    expect(invite).toHaveBeenCalledWith({
      email: "new@example.test",
      role: "member",
      teamId: "t-2",
    });
    expect(invite).toHaveBeenCalledWith({
      email: "pending@example.test",
      role: "member",
      teamIds: ["t-1", "t-2"],
    });
    expect(failures).toEqual([
      { key: "u-2", kind: "member", label: "bob@example.test", message: "Member unavailable." },
      {
        key: "taken@example.test",
        kind: "invitee",
        label: "taken@example.test",
        message: "already a Member, or no free seat",
      },
    ]);
  });
  it("sends no Team fields for an organization-only invitation", async () => {
    const invite = vi.fn(async () => {});
    await applyTeamAdditions(plan({ emailText: "new@example.test" }), "admin", teams, {
      addTeamMember: vi.fn(),
      invite,
    });
    expect(invite).toHaveBeenCalledWith({ email: "new@example.test", role: "admin" });
  });
});
