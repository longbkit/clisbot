import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { hubSettingsNavigationItems, hubSettingsSection } from "./catalog";

describe("Hub Settings navigation", () => {
  it("shows only sign-in before authentication", () => {
    assert.deepEqual(
      hubSettingsNavigationItems({ signedIn: false }).map(({ section, label }) => ({
        section,
        label,
      })),
      [{ section: "account", label: "Sign in to Hub" }],
    );
  });

  it("keeps People and Hosts visible to a signed-in Member, for their own access", () => {
    assert.deepEqual(
      hubSettingsNavigationItems({
        signedIn: true,
        canManage: false,
      }).map(({ section, label }) => ({ section, label })),
      [
        { section: "account", label: "Account" },
        { section: "team", label: "People" },
        { section: "hosts", label: "Hosts" },
      ],
    );
  });

  it("shows Automations to a Member with direct-run access", () => {
    assert.deepEqual(
      hubSettingsNavigationItems({
        signedIn: true,
        canManage: false,
        grants: [{ resourceKind: "automation", privileges: ["automation.run"] }],
      }).map(({ section }) => section),
      ["account", "automations", "team", "hosts"],
    );
  });

  it("opens Channels, Automations, People, and Hosts to scoped Admins", () => {
    assert.deepEqual(
      hubSettingsNavigationItems({
        signedIn: true,
        canManage: false,
        grants: [
          { resourceKind: "channel_account", privileges: ["channel.use", "channel.manage"] },
          { resourceKind: "project", privileges: ["project.use", "agent.interact"] },
          { resourceKind: "team", privileges: ["hub.access.manage"] },
        ],
      }).map(({ section }) => section),
      ["account", "channels", "automations", "team", "hosts"],
    );
  });

  it("shows every management destination to an owner or administrator", () => {
    assert.deepEqual(
      hubSettingsNavigationItems({ signedIn: true, canManage: true }).map(({ section }) => section),
      ["account", "channels", "automations", "team", "hosts", "integrations"],
    );
  });

  it("adds Instance settings for the Hub operator only", () => {
    assert.deepEqual(
      hubSettingsNavigationItems({
        signedIn: true,
        canManage: true,
        isInstanceOperator: true,
      }).map(({ section }) => section),
      ["account", "channels", "automations", "team", "hosts", "integrations", "instance"],
    );
  });

  it("keeps Account reachable without a Host or any management or Automation grant", () => {
    const accountItems = hubSettingsNavigationItems({ signedIn: true }).filter(
      ({ section }) => section === "account",
    );
    assert.deepEqual(accountItems, [hubSettingsSection("account")]);
    assert.equal(accountItems[0]?.label, "Account");
  });
});
