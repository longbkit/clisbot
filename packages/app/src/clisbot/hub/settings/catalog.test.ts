import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { hubSettingsNavigationItems } from "./catalog";

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
      [{ section: "access", label: "Access" }],
    );
  });

  it("shows Automations to a Member with direct-run access", () => {
    assert.deepEqual(
      hubSettingsNavigationItems({
        signedIn: true,
        canManage: false,
        canRunAutomations: true,
      }).map(({ section }) => section),
      ["automations", "access"],
    );
  });

  it("shows every management destination to an owner or administrator", () => {
    assert.deepEqual(
      hubSettingsNavigationItems({ signedIn: true, canManage: true }).map(({ section }) => section),
      ["channels", "automations", "team", "access", "configuration"],
    );
  });
});
