import { describe, expect, it } from "vitest";
import {
  openHubProviderApplicationForm,
  providerApplicationCanConnectAccount,
} from "./provider-application-form";

describe("Hub Provider Application form", () => {
  it("offers account connection only when the Application has a separate install flow", () => {
    expect(
      providerApplicationCanConnectAccount({
        provider: "slack",
        identifiers: { appId: "A1", transport: "socket" },
      }),
    ).toBe(false);
    expect(
      providerApplicationCanConnectAccount({
        provider: "slack",
        identifiers: { appId: "A1", transport: "webhook" },
      }),
    ).toBe(true);
    expect(
      providerApplicationCanConnectAccount({
        provider: "github",
        identifiers: { appId: "42" },
      }),
    ).toBe(true);
  });

  it("builds a GitHub Application without trimming secret material", () => {
    const form = openHubProviderApplicationForm();
    form.setField("appId", " 42 ");
    form.setField("appSlug", " paseo ");
    form.setField("clientId", " client ");
    form.setField("clientSecret", " secret ");
    form.setField("privateKey", "-----BEGIN KEY-----\nkey\n-----END KEY-----\n");

    expect(form.getState().submission).toEqual({
      provider: "github",
      appId: "42",
      appSlug: "paseo",
      clientId: "client",
      clientSecret: " secret ",
      privateKey: "-----BEGIN KEY-----\nkey\n-----END KEY-----\n",
    });
    expect(form.getState().canSubmit).toBe(true);
  });

  it("starts replacement from public identifiers and keeps secrets empty", () => {
    const form = openHubProviderApplicationForm({
      provider: "github",
      application: {
        identifiers: { appId: "42", appSlug: "paseo", clientId: "client" },
        configurationVersion: 3,
      },
    });

    expect(form.getState().mode).toBe("replace");
    expect(form.getState().fields.clientSecret).toBe("");
    expect(form.getState().canSubmit).toBe(false);
    form.setField("clientSecret", "next-secret");
    form.setField("privateKey", "next-key");
    expect(form.getState().submission).toMatchObject({ expectedVersion: 3 });
  });

  it("clears provider-specific values when a create form changes provider", () => {
    const form = openHubProviderApplicationForm();
    form.setField("appId", "42");
    form.setProvider("linear");

    expect(form.getState().provider).toBe("linear");
    expect(form.getState().fields.appId).toBe("");
    expect(form.getState().submission).toBeNull();
  });

  it("uses Socket Mode by default and keeps Slack transport credentials separate", () => {
    const form = openHubProviderApplicationForm();
    form.setProvider("slack");
    form.setField("appToken", "xapp-socket");
    form.setField("botToken", "xoxb-socket");

    expect(form.getState().submission).toEqual({
      provider: "slack",
      transport: "socket",
      appToken: "xapp-socket",
      botToken: "xoxb-socket",
    });

    form.setSlackTransport("webhook");
    expect(form.getState().fields.appToken).toBe("");
    expect(form.getState().submission).toBeNull();
  });

  it("preserves the saved Slack transport while replacing credentials", () => {
    const form = openHubProviderApplicationForm({
      provider: "slack",
      transport: "webhook",
      application: {
        identifiers: { appId: "A1", clientId: "C1", transport: "webhook" },
        configurationVersion: 4,
      },
    });
    form.setField("clientSecret", "secret");
    form.setField("signingSecret", "signing");

    expect(form.getState().transport).toBe("webhook");
    expect(form.getState().submission).toEqual({
      provider: "slack",
      transport: "webhook",
      appId: "A1",
      clientId: "C1",
      clientSecret: "secret",
      signingSecret: "signing",
      expectedVersion: 4,
    });
  });
});
