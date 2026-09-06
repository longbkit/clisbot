import { describe, expect, it } from "vitest";
import { openHubAccountEntryForm } from "./account-entry-form";

describe("Hub Account entry form", () => {
  it("starts a fresh signed-out form after another account or setup step", () => {
    const previous = openHubAccountEntryForm({ mode: "instanceSetup" });
    previous.setEmail("owner@example.test");
    previous.setPassword("long-owner-password");
    previous.setConfirmPassword("long-owner-password");
    expect(previous.getState().canSubmit).toBe(true);
    previous.close();
    expect(openHubAccountEntryForm({ mode: "signIn" }).getState()).toMatchObject({
      email: "",
      password: "",
      confirmPassword: "",
      canSubmit: false,
    });
  });
  it("seeds the invitation email in both display and submission state", () => {
    const form = openHubAccountEntryForm({ mode: "signUp", invitedEmail: "member@example.test" });
    form.setName("Member");
    form.setPassword("long-member-password");
    form.setConfirmPassword("long-member-password");
    expect(form.getState()).toMatchObject({ email: "member@example.test", canSubmit: true });
  });
  it("preserves shared input across mode changes and clears fields that remount", () => {
    const form = openHubAccountEntryForm({ mode: "signUp" });
    form.setEmail("member@example.test");
    form.setPassword("long-member-password");
    form.setName("Member");
    form.setConfirmPassword("long-member-password");
    expect(form.getState().canSubmit).toBe(true);
    form.setEntryMode("signIn");
    expect(form.getState()).toMatchObject({
      email: "member@example.test",
      password: "long-member-password",
      name: "",
      confirmPassword: "",
      canSubmit: true,
    });
    form.setEntryMode("signUp");
    expect(form.getState()).toMatchObject({ name: "", confirmPassword: "", canSubmit: false });
  });
  it("derives password-change and organization validation from the current model values", () => {
    const form = openHubAccountEntryForm({ mode: "passwordChange" });
    form.setPassword("new-password-long");
    form.setConfirmPassword("different-password");
    form.setCurrentPassword("old-password");
    expect(form.getState()).toMatchObject({ passwordsMatch: false, canSubmit: false });
    form.setConfirmPassword("new-password-long");
    expect(form.getState().canSubmit).toBe(true);
    const organization = openHubAccountEntryForm({ mode: "organization" });
    organization.setOrganizationName("   ");
    expect(organization.getState().canSubmit).toBe(false);
    organization.setOrganizationName("Acme");
    expect(organization.getState().canSubmit).toBe(true);
  });
});
