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

  it("keeps Effective access visible to a signed-in Member", () => {
    assert.deepEqual(
      hubSettingsNavigationItems({
        signedIn: true,
        canManage: false,
      }).map(({ section, label }) => ({ section, label })),
      [
        { section: "account", label: "Account" },
        { section: "access", label: "Access" },
      ],
    );
  });

  it("shows Automations to a Member with direct-run access", () => {
    assert.deepEqual(
      hubSettingsNavigationItems({
        signedIn: true,
        canManage: false,
        canRunAutomations: true,
      }).map(({ section }) => section),
      ["account", "automations", "access"],
    );
  });

  it("shows every management destination to an owner or administrator", () => {
    assert.deepEqual(
      hubSettingsNavigationItems({ signedIn: true, canManage: true }).map(({ section }) => section),
      ["account", "channels", "automations", "team", "access", "configuration"],
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
