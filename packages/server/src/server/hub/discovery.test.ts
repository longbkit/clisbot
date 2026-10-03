import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { discoverEnrolledHub } from "./discovery.js";

afterEach(() => vi.unstubAllGlobals());
describe("public Hub discovery", () => {
  it("strips access/setup secrets and substitutes the co-located HTTPS gateway", async () => {
    const home = await mkdtemp(path.join(tmpdir(), "clisbot-hub-discovery-"));
    const hubOrigin = "http://127.0.0.1:6870";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          hubId: "hub-1",
          publicKey: "public",
          relay: { endpoint: "relay.example", useTls: true },
          pairing: { token: "secret" },
          ownerSetupToken: "secret-setup",
        }),
      ),
    );
    try {
      await writeFile(
        path.join(home, "gateway-local.json"),
        JSON.stringify({
          config: { hubOrigin, origins: ["https://box.tailnet.ts.net:8443"] },
        }),
      );
      expect(await discoverEnrolledHub(home, hubOrigin)).toEqual({
        hubId: "hub-1",
        publicKey: "public",
        relay: { endpoint: "relay.example", useTls: true },
        origin: "https://box.tailnet.ts.net:8443",
      });
      expect(fetch).toHaveBeenCalledWith(
        new URL("/api/auth/clisbot/device/identity", hubOrigin),
        expect.objectContaining({ credentials: "omit", redirect: "error" }),
      );
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
  it.each([
    "http://127.0.0.1:6870",
    "https://127.0.0.1:6870",
    "https://localhost:6870",
    "https://[::1]:6870",
  ])("never advertises a remote Host's private loopback origin: %s", async (hubOrigin) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          hubId: "hub-1",
          publicKey: "public",
          credential: "secret",
        }),
      ),
    );
    expect(await discoverEnrolledHub("/missing-fixture-home", hubOrigin)).toEqual({
      hubId: "hub-1",
      publicKey: "public",
    });
  });
  it("fails closed on unreachable, redirecting and oversized identity responses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("x".repeat(8193))));
    expect(
      await discoverEnrolledHub("/missing-fixture-home", "https://hub.example"),
    ).toBeUndefined();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("redirect refused")));
    expect(
      await discoverEnrolledHub("/missing-fixture-home", "https://hub.example"),
    ).toBeUndefined();
    expect(await discoverEnrolledHub("/missing-fixture-home", null)).toBeUndefined();
  });
});
