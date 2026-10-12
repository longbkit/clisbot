import { expect, it, vi } from "vitest";
import { HUB_WEB_CLIENT_ORIGIN as origin, withHubWebClients } from "./web-clients.js";
import { registerResponseLifecycle, takeResponseLifecycle } from "../http/response-lifecycle.js";

it("permits only the official web client's bearer preflight and rejects cookies before dispatch", async () => {
  const handle = vi.fn(() => Response.json({ ok: true }));
  const fetch = withHubWebClients(handle);
  const url = "https://hub.test/api/auth/clisbot/state";
  const preflight = await fetch(
    new Request(url, {
      method: "OPTIONS",
      headers: {
        origin,
        "access-control-request-method": "GET",
        "access-control-request-headers": "Authorization, Content-Type",
      },
    }),
  );
  expect(preflight.status).toBe(204);
  expect(preflight.headers.get("access-control-allow-origin")).toBe(origin);
  expect(preflight.headers.has("access-control-allow-credentials")).toBe(false);
  for (const headers of [
    { origin, cookie: "session=private" },
    { origin, cookie: "session=private", authorization: "Bearer token" },
  ])
    expect((await fetch(new Request(url, { headers }))).status).toBe(401);
  expect(
    (
      await fetch(
        new Request(url, {
          method: "OPTIONS",
          headers: {
            origin,
            "access-control-request-method": "GET",
            "access-control-request-headers": "Cookie",
          },
        }),
      )
    ).status,
  ).toBe(403);
  expect(handle).not.toHaveBeenCalled();
  const hostile = await fetch(new Request(url, { headers: { origin: "https://hostile.test" } }));
  expect(hostile.headers.has("access-control-allow-origin")).toBe(false);
});

it("keeps same-origin cookie login untouched and preserves response cleanup for bearer streams", async () => {
  const lifecycle = { onFinish: vi.fn(), onAbort: vi.fn() };
  const response = registerResponseLifecycle(
    new Response("data", {
      headers: {
        "set-cookie": "private=value",
        "access-control-allow-credentials": "true",
        vary: "Accept",
      },
    }),
    lifecycle,
  );
  const request = new Request("https://hub.test/api/stream", {
    headers: { origin, authorization: "Bearer token" },
  });
  const result = await withHubWebClients(() => response)(request);
  expect(result.headers.has("set-cookie")).toBe(false);
  expect(result.headers.has("access-control-allow-credentials")).toBe(false);
  expect(result.headers.get("vary")).toBe("Accept, Origin");
  expect(takeResponseLifecycle(result)).toBe(lifecycle);
  expect(takeResponseLifecycle(response)).toBeUndefined();
  const cookieResponse = new Response(null, { headers: { "set-cookie": "session=existing" } });
  const sameOrigin = await withHubWebClients(() => cookieResponse)(
    new Request("https://hub.test/api/auth/sign-in/social", {
      method: "POST",
      headers: { origin: "https://hub.test", cookie: "session=old" },
    }),
  );
  expect(sameOrigin).toBe(cookieResponse);
});

it("only removes browser origin headers from cookie-free grant exchanges", async () => {
  const handle = vi.fn((request: Request) => Response.json(Object.fromEntries(request.headers)));
  const fetch = withHubWebClients(handle);
  const headers = {
    origin,
    referer: `${origin}/`,
    "sec-fetch-site": "cross-site",
    "content-type": "application/x-www-form-urlencoded",
  };
  const token = await fetch(
    new Request("https://hub.test/api/auth/oauth2/token", {
      method: "POST",
      headers,
      body: "grant_type=authorization_code",
    }),
  );
  expect(await token.json()).toEqual({ "content-type": "application/x-www-form-urlencoded" });
  const blocked = await fetch(
    new Request("https://hub.test/api/auth/sign-in/social", {
      method: "POST",
      headers,
      body: "{}",
    }),
  );
  expect(blocked.status).toBe(401);
  expect(handle).toHaveBeenCalledTimes(1);
});

it("leaves protected Hub device discovery and proofs to the existing pairing boundary", async () => {
  const response = Response.json(
    { hubId: "paired-hub" },
    { headers: { "access-control-allow-origin": "*" } },
  );
  const handle = vi.fn(() => response);
  const request = new Request("https://hub.test/api/auth/clisbot/device/identity", {
    headers: { origin },
  });
  expect(await withHubWebClients(handle, { enabled: false })(request)).toBe(response);
  expect(handle).toHaveBeenCalledWith(request);
});
