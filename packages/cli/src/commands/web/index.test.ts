import { it, expect } from "vitest";
import { formatWebOutput } from "./index.js";
const result = {
  home: "/isolated",
  running: true,
  origin: "http://127.0.0.1:17882",
  tailscaleUrl: "https://fixture.ts.net:8445",
  tailscaleState: "ready",
  networkGuidance: "Private connection uses your tailnet.",
  access: "owner-pairing",
};
it("prints local and private URLs and distinguishes Owner invitation from mere URL access", () => {
  const text = formatWebOutput("start", {
    ...result,
    ownerPairingUrl: "http://127.0.0.1:17882/#offer=fixture",
  });
  expect(text).toContain(`Local URL: ${result.origin}`);
  expect(text).toContain(`Private URL: ${result.tailscaleUrl}`);
  expect(text).toContain("expires in 5 minutes");
  expect(text).toContain("web URL alone grants no access");
  expect(formatWebOutput("status", result)).toContain("run clisbot web start");
});
it("explains fallback and managed access without minting or suggesting a bypass", () => {
  const text = formatWebOutput("status", {
    ...result,
    tailscaleUrl: null,
    tailscaleState: "missing",
    networkGuidance: "Install Tailscale, then retry.",
    access: "hub-ticket",
  });
  expect(text).toContain("Private URL: unavailable");
  expect(text).toContain("Tailscale: missing");
  expect(text).toContain("Install Tailscale");
  expect(text).toContain("does not bypass managed access");
});
