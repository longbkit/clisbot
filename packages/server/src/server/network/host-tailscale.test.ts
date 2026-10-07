import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import { editPersistedConfig } from "../persisted-config.js";
import { readHostTailscale } from "./host-tailscale.js";

const homes: string[] = [];
afterEach(async () => {
  await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })));
});

async function homeWithDirect(endpoint?: string, useTls = true): Promise<string> {
  const home = await mkdtemp(path.join(tmpdir(), "clisbot-host-tailscale-"));
  homes.push(home);
  if (endpoint) {
    editPersistedConfig(home, "daemon.direct.endpoint", { value: endpoint });
    editPersistedConfig(home, "daemon.direct.useTls", { value: useTls });
  }
  return home;
}

function tailscale(serve: Record<string, { Proxy?: string; Path?: string }>) {
  return async (args: string[]) =>
    args[0] === "status"
      ? JSON.stringify({ BackendState: "Running", Self: { DNSName: "mac.tail1.ts.net." } })
      : JSON.stringify({
          Web: Object.fromEntries(
            Object.entries(serve).map(([authority, handler]) => [
              authority,
              { Handlers: { "/": handler } },
            ]),
          ),
        });
}

test("offers the Tailscale route only when daemon.direct points at a live Serve proxy", async () => {
  const mapped = await homeWithDirect("mac.tail1.ts.net:8443");
  expect(
    await readHostTailscale(
      mapped,
      tailscale({ "mac.tail1.ts.net:8443": { Proxy: "http://127.0.0.1:6880" } }),
    ),
  ).toEqual({
    state: "ready",
    dnsName: "mac.tail1.ts.net",
    origin: "https://mac.tail1.ts.net:8443",
  });
  // The mapping was removed or replaced outside Clisbot.
  expect(await readHostTailscale(mapped, tailscale({}))).toEqual({
    state: "ready",
    dnsName: "mac.tail1.ts.net",
  });
  expect(
    await readHostTailscale(mapped, tailscale({ "mac.tail1.ts.net:8443": { Path: "/srv" } })),
  ).toEqual({ state: "ready", dnsName: "mac.tail1.ts.net" });
});

test("a loopback or foreign direct route is not a Tailscale route", async () => {
  const run = tailscale({ "mac.tail1.ts.net:8443": { Proxy: "http://127.0.0.1:6880" } });
  const loopback = await homeWithDirect("127.0.0.1:6868", false);
  expect((await readHostTailscale(loopback, run)).origin).toBeUndefined();
  const foreign = await homeWithDirect("other.tail1.ts.net:8443");
  expect((await readHostTailscale(foreign, run)).origin).toBeUndefined();
  const none = await homeWithDirect();
  expect((await readHostTailscale(none, run)).origin).toBeUndefined();
});

test("reports Tailscale that is not ready with its guidance", async () => {
  const home = await homeWithDirect("mac.tail1.ts.net:8443");
  expect(
    await readHostTailscale(home, async () => JSON.stringify({ BackendState: "NeedsLogin" })),
  ).toMatchObject({ state: "login-required", guidance: expect.stringContaining("Sign in") });
});
