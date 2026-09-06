import { describe, expect, it } from "vitest";
import { oauthAuthorizeUrl } from "./transport/oauth";
import { hubAccountEntryRoute, hubClientAuthorizationContinuation } from "./account-entry-route";

describe("Hub account entry navigation", () => {
  it("preserves an invitation while routing the Hub root link into Paseo Account", () => {
    expect(hubAccountEntryRoute("https://paseo.example.test/?invitation=invite-1")).toEqual({
      pathname: "/settings/hub/[hubSection]",
      params: { invitation: "invite-1", hubSection: "account" },
    });
  });

  it("does not take ownership of ordinary Paseo or malformed links", () => {
    expect(
      hubAccountEntryRoute("https://paseo.example.test/open-project?invitation=invite-1"),
    ).toBe(null);
    expect(hubAccountEntryRoute("https://paseo.example.test/")).toBe(null);
    expect(hubAccountEntryRoute("not a URL")).toBe(null);
    expect(hubAccountEntryRoute(null)).toBe(null);
  });
});

const origin = "https://paseo.example.test";
const authorizationInput = {
  origin,
  redirectUri: "paseo://hub-auth/callback",
  state: "opaque+state/value",
  challenge: "pkce-challenge",
};

function invitationAuthorizationUrl() {
  return oauthAuthorizeUrl({ ...authorizationInput, invitationId: "invite-1" });
}

describe("Hub browser authorization continuation", () => {
  it("keeps the native invitation PKCE round trip through Account and returns to Hub authorization", () => {
    const entry = hubAccountEntryRoute(invitationAuthorizationUrl());
    expect(entry).toMatchObject({
      pathname: "/settings/hub/[hubSection]",
      params: {
        invitation: "invite-1",
        client_id: "paseo-client",
        redirect_uri: authorizationInput.redirectUri,
        state: authorizationInput.state,
        code_challenge: authorizationInput.challenge,
        code_challenge_method: "S256",
      },
    });
    if (entry === null || typeof entry === "string" || entry.params === undefined) {
      throw new Error("Expected Account route parameters");
    }
    const accountUrl = new URL(`/settings/hub/${String(entry.params.hubSection)}`, origin);
    for (const [field, values] of Object.entries(entry.params)) {
      if (field === "hubSection") continue;
      for (const value of Array.isArray(values) ? values : [values]) {
        accountUrl.searchParams.append(field, String(value));
      }
    }
    const destination = hubClientAuthorizationContinuation({
      url: accountUrl.toString(),
      origin,
      state: { status: "active" },
    });
    expect(destination).toBe(oauthAuthorizeUrl(authorizationInput));
  });

  it("routes ordinary native OAuth login into Account even without an invitation", () => {
    const entry = new URL(oauthAuthorizeUrl(authorizationInput));
    entry.pathname = "/";
    expect(hubAccountEntryRoute(entry.toString())).toMatchObject({
      pathname: "/settings/hub/[hubSection]",
      params: { client_id: "paseo-client", state: authorizationInput.state },
    });
  });

  it("resumes after an Account reload and supports the desktop loopback callback", () => {
    const entry = new URL(invitationAuthorizationUrl());
    entry.pathname = "/settings/hub/account";
    entry.searchParams.set("redirect_uri", "http://127.0.0.1:43210/hub-auth/callback");
    const destination = hubClientAuthorizationContinuation({
      url: entry.toString(),
      origin,
      state: { status: "appSetupRequired" },
    });
    expect(new URL(destination!).searchParams.get("redirect_uri")).toBe(
      "http://127.0.0.1:43210/hub-auth/callback",
    );
    expect(hubAccountEntryRoute(entry.toString())).toBe(null);
  });

  it("waits for password, organization, and invitation gates", () => {
    for (const state of [
      null,
      { status: "signedOut" },
      { status: "instanceSetupRequired" },
      { status: "passwordChangeRequired" },
      { status: "organizationRequired" },
      { status: "active", invitation: { id: "invite-1" } },
      { status: "active", invitationUnavailable: true },
      { status: "appSetupRequired", invitation: { id: "invite-1" } },
      { status: "appSetupRequired", invitationUnavailable: true },
      { status: "organizationRequired", invitationUnavailable: true },
    ]) {
      expect(
        hubClientAuthorizationContinuation({ url: invitationAuthorizationUrl(), origin, state }),
      ).toBe(null);
    }
  });

  it("ignores foreign origins, unrelated routes, incomplete requests, and other clients", () => {
    for (const url of [
      invitationAuthorizationUrl().replace(origin, "https://foreign.example.test"),
      invitationAuthorizationUrl().replace("/?", "/open-project?"),
      invitationAuthorizationUrl().replace("client_id=paseo-client", "client_id=other"),
      invitationAuthorizationUrl().replace("code_challenge=pkce-challenge&", ""),
      "invalid",
      null,
    ]) {
      expect(hubClientAuthorizationContinuation({ url, origin, state: { status: "active" } })).toBe(
        null,
      );
    }
  });

  it("preserves duplicate OAuth values for server validation and strips unrelated redirect fields", () => {
    const entry = new URL(invitationAuthorizationUrl());
    entry.searchParams.append("state", "duplicate");
    entry.searchParams.set("returnTo", "https://foreign.example.test");
    const route = hubAccountEntryRoute(entry.toString());
    expect(route).toMatchObject({ params: { state: [authorizationInput.state, "duplicate"] } });
    const destination = new URL(
      hubClientAuthorizationContinuation({
        url: entry.toString(),
        origin,
        state: { status: "active" },
      })!,
    );
    expect(destination.origin).toBe(origin);
    expect(destination.pathname).toBe("/api/auth/oauth2/authorize");
    expect(destination.searchParams.getAll("state")).toEqual([
      authorizationInput.state,
      "duplicate",
    ]);
    expect(destination.searchParams.has("returnTo")).toBe(false);
    expect(destination.searchParams.has("invitation")).toBe(false);
  });
});
