import path from "node:path";
import { expect, test } from "vitest";
import {
  detectTailscale,
  readTailscaleServeHandler,
  resolveTailscaleBinary,
  tailscaleApprovalUrl,
} from "./tailscale.js";

test("guides missing/login/stopped dependencies and accepts only MagicDNS readiness", async () => {
  expect(
    await detectTailscale(async () => {
      throw Object.assign(new Error("missing"), { code: "ENOENT" });
    }),
  ).toMatchObject({ state: "missing" });
  expect(
    await detectTailscale(async () => JSON.stringify({ BackendState: "NeedsLogin" })),
  ).toMatchObject({ state: "login-required" });
  expect(
    await detectTailscale(async () => JSON.stringify({ BackendState: "Stopped" })),
  ).toMatchObject({ state: "stopped" });
  expect(
    await detectTailscale(async () =>
      JSON.stringify({ BackendState: "Running", Self: { DNSName: "host.tail123.ts.net." } }),
    ),
  ).toEqual({ state: "ready", dnsName: "host.tail123.ts.net" });
  expect(
    await detectTailscale(async () =>
      JSON.stringify({ BackendState: "Running", Self: { DNSName: "evil.example" } }),
    ),
  ).toMatchObject({ state: "stopped" });
});

test("resolves Windows installation paths without a shell, with explicit overrides", () => {
  expect(resolveTailscaleBinary("win32", { ProgramFiles: "C:/Programs" }, () => true)).toBe(
    path.join("C:/Programs", "Tailscale", "tailscale.exe"),
  );
  expect(resolveTailscaleBinary("win32", {}, () => false)).toBe("tailscale.exe");
  expect(resolveTailscaleBinary("darwin", {}, () => false)).toBe("tailscale");
  expect(resolveTailscaleBinary("darwin", {}, () => true)).toBe(
    "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
  );
  expect(resolveTailscaleBinary("win32", { CLISBOT_TAILSCALE_BIN: "D:/Tools/tailscale.exe" })).toBe(
    "D:/Tools/tailscale.exe",
  );
});

test("reports a non-proxy Serve handler as occupied", async () => {
  const run = async () =>
    JSON.stringify({
      Web: {
        "host.tail123.ts.net:8443": { Handlers: { "/": { Path: "/srv" } } },
        "host.tail123.ts.net:443": { Handlers: { "/": { Proxy: "http://127.0.0.1:6880" } } },
      },
    });
  expect(await readTailscaleServeHandler("host.tail123.ts.net:8443", run)).toEqual({
    proxy: undefined,
  });
  expect(await readTailscaleServeHandler("host.tail123.ts.net:443", run)).toEqual({
    proxy: "http://127.0.0.1:6880",
  });
  expect(await readTailscaleServeHandler("host.tail123.ts.net:9443", run)).toBeUndefined();
});

test("finds the tailnet approval link Tailscale prints when Serve is off", () => {
  const error = Object.assign(new Error("Command failed"), {
    stdout:
      "Serve is not enabled on your tailnet.\nTo enable, visit:\n\n         https://login.tailscale.com/f/serve?node=nABC123\n",
  });
  expect(tailscaleApprovalUrl(error)).toBe("https://login.tailscale.com/f/serve?node=nABC123");
  expect(tailscaleApprovalUrl(new Error("timeout"))).toBeUndefined();
});
