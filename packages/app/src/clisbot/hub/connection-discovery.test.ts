import { afterEach, expect, test, vi } from "vitest";
import { discoverAccountHub } from "./connection-discovery";

afterEach(() => vi.unstubAllGlobals());

test("discovers only the entered account Hub issuer without cookies or redirects", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValue(Response.json({ authentication: "oauth", issuer: "https://work.test" }));
  vi.stubGlobal("fetch", fetch);
  expect(await discoverAccountHub("https://work.test")).toEqual({
    authentication: "oauth",
    hubId: "https://work.test",
    origin: "https://work.test",
    label: "work.test",
    entry: "account",
  });
  expect(fetch).toHaveBeenCalledWith(
    new URL("https://work.test/api/auth/clisbot/connection"),
    expect.objectContaining({ credentials: "omit", redirect: "error" }),
  );
  fetch.mockResolvedValue(
    Response.json({ authentication: "oauth", issuer: "https://different.test" }),
  );
  expect(await discoverAccountHub("https://work.test")).toBeNull();
});

test("older and protected Hubs fall back to device discovery; HTML is not an account Hub", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  for (const response of [
    new Response(null, { status: 404 }),
    new Response(null, { status: 401 }),
    new Response("<html>App</html>"),
    Response.json({ authentication: "device" }),
  ]) {
    fetch.mockResolvedValue(response);
    expect(await discoverAccountHub("https://work.test")).toBeNull();
  }
});
