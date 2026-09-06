import type { Href } from "expo-router";
import { buildHubSettingsRoute } from "./navigation";
import { PASEO_CLIENT_ID } from "./transport/oauth";

// Match Hub's first-party account entry contract. Hub remains responsible for validating the
// client, redirect URI, scopes, and PKCE request before issuing any authorization code.
const AUTHORIZATION_QUERY_FIELDS = [
  "response_type",
  "client_id",
  "redirect_uri",
  "scope",
  "state",
  "code_challenge",
  "code_challenge_method",
  "nonce",
  "prompt",
] as const;

export function hubAccountEntryRoute(value: string | null): Href | null {
  const url = accountEntryUrl(value);
  if (url === null || url.pathname !== "/") return null;
  const invitation = url.searchParams.get("invitation")?.trim();
  const authorization = clientAuthorizationQuery(url);
  if (!invitation && authorization === null) return null;
  const params: Record<string, string | string[]> = invitation ? { invitation } : {};
  for (const field of AUTHORIZATION_QUERY_FIELDS) {
    const values = authorization?.getAll(field) ?? [];
    if (values.length > 0) params[field] = values.length === 1 ? values[0]! : values;
  }
  return { pathname: "/settings/hub/[hubSection]", params: { ...params, hubSection: "account" } };
}

/** Resume through Hub's authorization endpoint, never directly through a supplied redirect URI. */
export function hubClientAuthorizationContinuation(input: {
  url: string | null;
  origin: string;
  state: { status: string; invitation?: unknown; invitationUnavailable?: boolean } | null;
}): string | null {
  if (
    input.state === null ||
    (input.state.status !== "active" && input.state.status !== "appSetupRequired") ||
    input.state.invitation !== undefined ||
    input.state.invitationUnavailable === true
  ) {
    return null;
  }
  const url = accountEntryUrl(input.url);
  if (url === null || url.origin !== input.origin) return null;
  const query = clientAuthorizationQuery(url);
  if (query === null) return null;
  const destination = new URL("/api/auth/oauth2/authorize", input.origin);
  destination.search = query.toString();
  return destination.toString();
}

function accountEntryUrl(value: string | null): URL | null {
  if (value === null) return null;
  try {
    const url = new URL(value);
    return url.pathname === "/" || url.pathname === buildHubSettingsRoute("account") ? url : null;
  } catch {
    return null;
  }
}

function clientAuthorizationQuery(url: URL): URLSearchParams | null {
  const current = url.searchParams;
  if (
    current.get("client_id") !== PASEO_CLIENT_ID ||
    !current.has("redirect_uri") ||
    !current.has("code_challenge")
  ) {
    return null;
  }
  const query = new URLSearchParams();
  for (const field of AUTHORIZATION_QUERY_FIELDS) {
    for (const value of current.getAll(field)) query.append(field, value);
  }
  return query;
}
