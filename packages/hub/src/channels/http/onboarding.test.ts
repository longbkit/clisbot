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
const accountPath = ".paseo/channels/slack/assistant.yml";
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
    const seeded = configureOnboardingRoute(initial, "slack", "assistant", input);
    const account = load(seeded.find((f) => f.path === accountPath)!.content) as {
      routes: Array<{
        audience: Array<{ where: { dm?: boolean; groups?: string } }>;
        reply?: { anchor: string };
        interaction: { requireMention: boolean };
      }>;
    };
    const inGroups = (r: { audience: Array<{ where: { groups?: string } }> }) =>
      r.audience[0]?.where.groups === "all";
    expect(account.routes.find(inGroups)?.reply?.anchor).toBe("thread");
    account.routes[0]!.interaction.requireMention = true;
    account.routes = account.routes.filter((r) => !inGroups(r));
    const edited = seeded.map((f) =>
      f.path === accountPath ? { path: f.path, content: dump(account) } : f,
    );
    const restarted = configureOnboardingRoute(edited, "slack", "assistant", {
      ...input,
      provider: "claude",
    });
    expect(load(restarted.find((f) => f.path === accountPath)!.content)).toEqual(account);
    expect(restarted.find((f) => f.path === ".paseo/hub.yml")?.content).toContain(
      "provider: codex",
    );
    const updated = configureOnboardingRoute(edited, "slack", "assistant", {
      ...input,
      provider: "claude",
      update: true,
    });
    expect(updated.find((f) => f.path === ".paseo/hub.yml")?.content).toContain("provider: claude");
    expect(load(updated.find((f) => f.path === accountPath)!.content)).toEqual(account);
  });
});
