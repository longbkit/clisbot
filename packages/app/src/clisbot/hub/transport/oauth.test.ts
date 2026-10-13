import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  authorizationCodeFromCallback,
  encodeBase64Url,
  HUB_ACCESS_SCOPE,
  oauthAuthorizeUrl,
  CLISBOT_CLIENT_ID,
  tokenRequestBody,
} from "./oauth";

describe("Hub OAuth client contract", () => {
  it("encodes S256 PKCE bytes with URL-safe characters and no padding", () => {
    // RFC 7636 Appendix B's verifier and expected S256 challenge.
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    const digest = new Uint8Array(createHash("sha256").update(verifier).digest());
    for (const bytes of [digest, digest.buffer]) {
      expect(encodeBase64Url(bytes)).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    }
    expect(encodeBase64Url(new Uint8Array([251, 255]))).toBe("-_8");
  });

  it("builds a public-client authorization request with S256 PKCE", () => {
    const url = new URL(
      oauthAuthorizeUrl({
        origin: "https://hub.example.com",
        redirectUri: "clisbot://hub-auth/callback",
        state: "state-value",
        challenge: "challenge-value",
      }),
    );

    expect(url.origin).toBe("https://hub.example.com");
    expect(url.pathname).toBe("/api/auth/oauth2/authorize");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      response_type: "code",
      client_id: CLISBOT_CLIENT_ID,
      redirect_uri: "clisbot://hub-auth/callback",
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
        redirectUri: "clisbot://hub-auth/callback",
        state: "state-value",
        challenge: "challenge-value",
        invitationId: "invitation-one",
      }),
    );

    expect(url.pathname).toBe("/");
    expect(url.searchParams.get("invitation")).toBe("invitation-one");
    expect(url.searchParams.get("client_id")).toBe(CLISBOT_CLIENT_ID);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  });

  it("validates state and issuer before accepting an authorization code", () => {
    const valid =
      "clisbot://hub-auth/callback?code=one-time-code&state=expected&iss=https%3A%2F%2Fhub.example.com";
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
      redirectUri: "clisbot://hub-auth/callback",
      code: "code",
      verifier: "verifier",
    });
    expect(Object.fromEntries(authorization)).toEqual({
      grant_type: "authorization_code",
      client_id: CLISBOT_CLIENT_ID,
      resource: "https://hub.example.com",
      redirect_uri: "clisbot://hub-auth/callback",
      code: "code",
      code_verifier: "verifier",
    });

    const refresh = tokenRequestBody({
      origin: "https://hub.example.com",
      refreshToken: "refresh-token",
    });
    expect(Object.fromEntries(refresh)).toEqual({
      grant_type: "refresh_token",
      client_id: CLISBOT_CLIENT_ID,
      resource: "https://hub.example.com",
      refresh_token: "refresh-token",
    });
  });
});
