import { expect, test, vi } from "vitest";
vi.mock("@/runtime/host-runtime", () => ({}));
vi.mock("@/data/query", () => ({}));
import { tailscaleRowModel } from "./host-tailscale";

test("each Tailscale state offers exactly one way forward", () => {
  expect(tailscaleRowModel({ tailscale: undefined })).toMatchObject({ status: "checking" });
  expect(tailscaleRowModel({ tailscale: { state: "missing" } }).actions).toEqual(["getTailscale"]);
  expect(
    tailscaleRowModel({ tailscale: { state: "login-required", guidance: "Sign in" } }),
  ).toEqual({ status: "signedOut", tone: "warning", hint: "Sign in", actions: ["retry"] });
  expect(
    tailscaleRowModel({
      tailscale: { state: "unavailable", actionUrl: "https://login.tailscale.com/f/serve" },
    }).actions,
  ).toEqual(["enableOnTailnet", "retry"]);
  expect(tailscaleRowModel({ tailscale: { state: "ready", dnsName: "mac.ts.net" } })).toMatchObject(
    {
      status: "notSetUp",
      actions: ["setUp"],
    },
  );
  expect(
    tailscaleRowModel({
      tailscale: { state: "ready", dnsName: "mac.ts.net", origin: "https://mac.ts.net:8443" },
    }),
  ).toEqual({ status: "on", tone: "success", hint: "https://mac.ts.net:8443", actions: [] });
  expect(tailscaleRowModel({ tailscale: { state: "ready" }, settingUp: true }).status).toBe(
    "settingUp",
  );
});

test("a failed status read offers Retry instead of checking forever", () => {
  expect(tailscaleRowModel({ tailscale: undefined, failed: true })).toEqual({
    status: "unavailable",
    tone: "warning",
    actions: ["retry"],
  });
});

test("the caller decides whether a Hub origin is already mapped", () => {
  expect(
    tailscaleRowModel({ tailscale: { state: "ready", dnsName: "mac.ts.net" }, mapped: true })
      .status,
  ).toBe("on");
});
