import { compileAudienceRule, ruleAdmits } from "../config/audience.js";
import { AccountFileSchema } from "../config/schema.js";
import { describe, it, expect, vi } from "vitest";
import { dump, load } from "js-yaml";
import {
  configureOnboardingRoute,
  linkOnboardingOwner,
  type OnboardingServices,
  type ChannelOnboarding,
} from "./onboarding.js";

const input: ChannelOnboarding = {
  name: "assistant",
  daemonId: "00000000-0000-4000-8000-000000000001",
  projectId: "prj",
  cwd: "/workspace",
  provider: "codex",
};
const accountPath = "channels/slack/assistant.yml";
const initial = [
  {
    path: accountPath,
    content: dump({
      channel: "slack",
      accountId: "assistant",
      connectionId: "connection-1",
      enabled: true,
      transport: { mode: "socket" },
    }),
  },
];
describe("onboarding configuration defaults", () => {
  it("does not reassign another Member's verified workspace identity as an onboarding side effect", async () => {
    const bindChannelIdentity = vi.fn();
    const services = {
      runtime: {
        query: async () => ({
          rows: [{ id: "owner", user_id: "owner-user", email: "owner@example.test" }],
        }),
      },
      access: {
        channelIdentityRealm: async () => "slack:T1",
        listChannelIdentities: async () => [
          {
            identityRealm: "slack:T1",
            connectionId: "another-bot",
            externalSubjectId: "U1",
            memberId: "another-member",
          },
        ],
        bindChannelIdentity,
      },
    } as unknown as OnboardingServices;
    await expect(
      linkOnboardingOwner(services, "org", "connection-1", { ...input, ownerIdentity: "U1" }),
    ).rejects.toThrow("already belongs to another Member");
    expect(bindChannelIdentity).not.toHaveBeenCalled();
  });
  it("starts Slack replies in threads and preserves later API edits on a normal restart", () => {
    const seeded = configureOnboardingRoute(initial, "slack", "assistant", input, "owner");
    const account = load(seeded.find((f) => f.path === accountPath)!.content) as {
      routes: Array<{
        audience: Array<{
          where: { dm?: boolean; groups?: string };
          interaction: { requireMention: boolean };
        }>;
        reply?: { anchor: string };
      }>;
    };
    const inGroups = (r: { audience: Array<{ where: { groups?: string } }> }) =>
      r.audience[0]?.where.groups === "all";
    expect(
      (account.routes[0]!.audience[0] as unknown as { who: { members: string[] } }).who,
    ).toEqual({ members: ["owner"] });
    expect(account.routes.find(inGroups)?.reply?.anchor).toBe("thread");
    // The DM rule answers without a mention; an API edit to require one survives a restart.
    expect(account.routes[0]!.audience[0]!.interaction.requireMention).toBe(false);
    account.routes[0]!.audience[0]!.interaction.requireMention = true;
    account.routes = account.routes.filter((r) => !inGroups(r));
    const edited = seeded.map((f) =>
      f.path === accountPath ? { path: f.path, content: dump(account) } : f,
    );
    const restarted = configureOnboardingRoute(
      edited,
      "slack",
      "assistant",
      {
        ...input,
        provider: "claude",
      },
      "owner",
    );
    expect(load(restarted.find((f) => f.path === accountPath)!.content)).toEqual(account);
    expect(restarted.find((f) => f.path === "hub.yml")?.content).toContain("provider: codex");
    const updated = configureOnboardingRoute(
      edited,
      "slack",
      "assistant",
      {
        ...input,
        provider: "claude",
        update: true,
      },
      "owner",
    );
    expect(updated.find((f) => f.path === "hub.yml")?.content).toContain("provider: claude");
    expect(load(updated.find((f) => f.path === accountPath)!.content)).toEqual(account);
  });
});

it("admits the exact owner in DMs and groups and refuses every other linked Member/admin/owner", () => {
  const files = configureOnboardingRoute(initial, "slack", "assistant", input, "bot-owner");
  const account = AccountFileSchema.parse(
    load(files.find((file) => file.path === accountPath)!.content),
  );
  for (const route of account.routes ?? []) {
    const rule = compileAudienceRule(route.audience![0]!);
    const conversation = {
      kind: rule.where.dm ? ("dm" as const) : ("group" as const),
      id: "fixture-room",
    };
    expect(
      ruleAdmits(rule, conversation, {
        identity: "slack:owner",
        member: { membershipId: "bot-owner", role: "member", teamIds: [] },
      }),
    ).toBe(true);
    for (const role of ["member", "admin", "owner"])
      expect(
        ruleAdmits(rule, conversation, {
          identity: "slack:other",
          member: { membershipId: "another-member", role, teamIds: [] },
        }),
      ).toBe(false);
    expect(ruleAdmits(rule, conversation, { identity: "slack:unknown", member: null })).toBe(false);
    expect(rule.trigger?.requireMention).toBe(!rule.where.dm);
  }
});
