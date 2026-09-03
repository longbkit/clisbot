import { describe, expect, it } from "vitest";
import {
  authorizationCodeFromCallback,
  HUB_ACCESS_SCOPE,
  oauthAuthorizeUrl,
  PASEO_CLIENT_ID,
  tokenRequestBody,
} from "./oauth";

describe("Hub OAuth client contract", () => {
  it("builds a public-client authorization request with S256 PKCE", () => {
    const url = new URL(
      oauthAuthorizeUrl({
        origin: "https://hub.example.com",
        redirectUri: "paseo://hub-auth/callback",
        state: "state-value",
        challenge: "challenge-value",
      }),
    );

    expect(url.origin).toBe("https://hub.example.com");
    expect(url.pathname).toBe("/api/auth/oauth2/authorize");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      response_type: "code",
      client_id: PASEO_CLIENT_ID,
      redirect_uri: "paseo://hub-auth/callback",
      scope: `${HUB_ACCESS_SCOPE} offline_access`,
      state: "state-value",
      code_challenge: "challenge-value",
      code_challenge_method: "S256",
    });
  });

  it("starts invitation authorization at the Hub account entry", () => {
    const url = new URL(
      oauthAuthorizeUrl({
        origin: "https://hub.example.com",
        redirectUri: "paseo://hub-auth/callback",
        state: "state-value",
        challenge: "challenge-value",
        invitationId: "invitation-one",
      }),
    );

    expect(url.pathname).toBe("/");
    expect(url.searchParams.get("invitation")).toBe("invitation-one");
    expect(url.searchParams.get("client_id")).toBe(PASEO_CLIENT_ID);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  });

  it("validates state and issuer before accepting an authorization code", () => {
    const valid =
      "paseo://hub-auth/callback?code=one-time-code&state=expected&iss=https%3A%2F%2Fhub.example.com";
    expect(
      authorizationCodeFromCallback({
        callbackUrl: valid,
        state: "expected",
        issuer: "https://hub.example.com",
      }),
    ).toBe("one-time-code");
    expect(() =>
      authorizationCodeFromCallback({
        callbackUrl: valid,
        state: "different",
        issuer: "https://hub.example.com",
      }),
    ).toThrow(/state mismatch/u);
    expect(() =>
      authorizationCodeFromCallback({
        callbackUrl: valid,
        state: "expected",
        issuer: "https://other.example.com",
      }),
    ).toThrow(/issuer/u);
  });

  it("keeps authorization-code and rotating-refresh requests distinct", () => {
    const authorization = tokenRequestBody({
      origin: "https://hub.example.com",
      redirectUri: "paseo://hub-auth/callback",
      code: "code",
      verifier: "verifier",
    });
    expect(Object.fromEntries(authorization)).toEqual({
      grant_type: "authorization_code",
      client_id: PASEO_CLIENT_ID,
      resource: "https://hub.example.com",
      redirect_uri: "paseo://hub-auth/callback",
      code: "code",
      code_verifier: "verifier",
    });

    const refresh = tokenRequestBody({
      origin: "https://hub.example.com",
      refreshToken: "refresh-token",
    });
    expect(Object.fromEntries(refresh)).toEqual({
      grant_type: "refresh_token",
      client_id: PASEO_CLIENT_ID,
      resource: "https://hub.example.com",
      refresh_token: "refresh-token",
    });
  });
});
