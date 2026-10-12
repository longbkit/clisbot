import { registerResponseLifecycle, takeResponseLifecycle } from "../http/response-lifecycle.js";

/** The web app is an OAuth public client; it never sends the Hub's browser cookies. */
export const HUB_WEB_CLIENT_ORIGIN = "https://app.clisbot.com";
export const HUB_WEB_CLIENT_CALLBACK = `${HUB_WEB_CLIENT_ORIGIN}/hub-auth-callback`;

export function accountHubDiscovery(
  request: Request,
  issuer: string,
  deviceProtected: boolean,
): Response | undefined {
  if (
    deviceProtected ||
    request.method !== "GET" ||
    new URL(request.url).pathname !== "/api/auth/clisbot/connection"
  )
    return undefined;
  return Response.json(
    { authentication: "oauth", issuer: new URL(issuer).origin },
    {
      headers: { "cache-control": "no-store", "access-control-allow-origin": "*" },
    },
  );
}

const PUBLIC_PATHS = new Set([
  "/api/auth/clisbot/connection",
  "/api/auth/clisbot/state",
  "/api/auth/oauth2/token",
  "/api/auth/oauth2/revoke",
]);
const METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const HEADERS = new Set(["authorization", "content-type", "accept"]);

/** Separate bearer access from same-origin cookie login. No credentialed CORS or cookie proxy. */
export function withHubWebClients(
  handle: (request: Request) => Promise<Response> | Response,
  options: { enabled: boolean } = { enabled: true },
): (request: Request) => Promise<Response> {
  return async (request) => {
    if (!options.enabled) return handle(request);
    const url = new URL(request.url);
    const origin = request.headers.get("origin");
    if (
      origin !== HUB_WEB_CLIENT_ORIGIN ||
      origin === url.origin ||
      !url.pathname.startsWith("/api/")
    )
      return handle(request);
    const headers = new Headers({
      "access-control-allow-origin": origin,
      "access-control-allow-methods": [...METHODS].join(", "),
      "access-control-allow-headers": [...HEADERS].join(", "),
      vary: "Origin",
    });
    if (request.method === "OPTIONS") {
      const method = request.headers.get("access-control-request-method") ?? "";
      const requested = (request.headers.get("access-control-request-headers") ?? "")
        .split(",")
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean);
      return new Response(null, {
        status: METHODS.has(method) && requested.every((name) => HEADERS.has(name)) ? 204 : 403,
        headers,
      });
    }
    if (
      !METHODS.has(request.method) ||
      request.headers.has("cookie") ||
      (!PUBLIC_PATHS.has(url.pathname) &&
        !request.headers.get("authorization")?.startsWith("Bearer "))
    ) {
      return Response.json({ error: "unauthorized" }, { status: 401, headers });
    }
    // OAuth token/revocation endpoints authenticate their grant, not a browser session.
    // Better Auth's cookie-CSRF middleware must not mistake them for cross-site login.
    const forwardedHeaders = new Headers(request.headers);
    if (url.pathname === "/api/auth/oauth2/token" || url.pathname === "/api/auth/oauth2/revoke") {
      forwardedHeaders.delete("origin");
      forwardedHeaders.delete("referer");
      forwardedHeaders.delete("sec-fetch-site");
    }
    const response = await handle(new Request(request, { headers: forwardedHeaders }));
    const responseHeaders = new Headers(response.headers);
    responseHeaders.delete("set-cookie");
    responseHeaders.delete("access-control-allow-credentials");
    for (const [name, value] of headers) {
      if (name === "vary") responseHeaders.append(name, value);
      else responseHeaders.set(name, value);
    }
    const result = new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
    const lifecycle = takeResponseLifecycle(response);
    return lifecycle ? registerResponseLifecycle(result, lifecycle) : result;
  };
}
