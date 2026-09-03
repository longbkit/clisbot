import { z } from "zod";

export const PASEO_CLIENT_ID = "paseo-client";
export const HUB_ACCESS_SCOPE = "hub:access";

export const OAuthTokenResponseSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  expires_in: z.number().positive(),
  token_type: z.string(),
});

export function authorizationCodeFromCallback(input: {
  callbackUrl: string;
  state: string;
  issuer: string;
}): string {
  const callback = new URL(input.callbackUrl);
  if (callback.searchParams.get("state") !== input.state) {
    throw new Error("Hub sign-in state mismatch.");
  }
  if (callback.searchParams.get("iss") !== input.issuer) {
    throw new Error("Unexpected Hub issuer.");
  }
  const authorizationError = callback.searchParams.get("error");
  if (authorizationError !== null) {
    throw new Error(`Hub sign-in failed: ${authorizationError}`);
  }
  const code = callback.searchParams.get("code");
  if (code === null || code.length === 0) {
    throw new Error("Hub did not return an authorization code.");
  }
  return code;
}

export function oauthAuthorizeUrl(input: {
  origin: string;
  redirectUri: string;
  state: string;
  challenge: string;
  invitationId?: string;
}): string {
  // An invitation is resolved by the Hub's account entry before OAuth authorization. Starting at
  // the login page lets a new user create the bound account, accept membership, and then continue
  // the same PKCE request. Ordinary sign-in keeps the shorter direct authorization path.
  const url = new URL(
    input.invitationId === undefined ? "/api/auth/oauth2/authorize" : "/",
    input.origin,
  );
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", PASEO_CLIENT_ID);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("scope", `${HUB_ACCESS_SCOPE} offline_access`);
  url.searchParams.set("state", input.state);
  url.searchParams.set("code_challenge", input.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  if (input.invitationId !== undefined) {
    url.searchParams.set("invitation", input.invitationId);
  }
  return url.toString();
}

export function tokenRequestBody(input: {
  origin: string;
  redirectUri?: string;
  code?: string;
  verifier?: string;
  refreshToken?: string;
}): URLSearchParams {
  const body = new URLSearchParams({
    grant_type: input.refreshToken === undefined ? "authorization_code" : "refresh_token",
    client_id: PASEO_CLIENT_ID,
    resource: input.origin,
  });
  if (input.redirectUri !== undefined) body.set("redirect_uri", input.redirectUri);
  if (input.code !== undefined) body.set("code", input.code);
  if (input.verifier !== undefined) body.set("code_verifier", input.verifier);
  if (input.refreshToken !== undefined) body.set("refresh_token", input.refreshToken);
  return body;
}
