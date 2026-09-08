// Slice 25 (security): the Slack net boundary is the last check before the bot
// token and an uploaded file leave the process. Its host allowlist was reading
// a policy field no caller sets, and it followed redirects the allowlist never
// saw — both are covered here.

import { describe, expect, it, vi } from "vitest";
import { fetchWithSsrFGuard } from "./fetch.js";

const OK = (_url?: unknown, _init?: RequestInit) => new Response("ok", { status: 200 });

function initOf(spy: ReturnType<typeof vi.fn>): RequestInit {
  return (spy.mock.calls[0] as unknown[])[1] as RequestInit;
}

describe("fetchWithSsrFGuard host allowlist", () => {
  it("enforces upstream's `hostnameAllowlist` field, which is what callers set", async () => {
    // `client-delivery.ts` builds `{ hostnameAllowlist: ["files.slack.com"] }`.
    // Reading `allowedHosts` instead made this branch unreachable.
    await expect(
      fetchWithSsrFGuard({
        url: "https://upload.attacker.invalid/collect",
        auditContext: "slack-upload-file",
        policy: { hostnameAllowlist: ["files.slack.com"] },
      }),
    ).rejects.toThrow(/host upload.attacker.invalid is not allowed/);
  });

  it("matches a `*.` entry against the domain and its subdomains", async () => {
    const policy = { hostnameAllowlist: ["*.slack.com"] };
    vi.stubGlobal("fetch", vi.fn(OK));
    try {
      await expect(
        fetchWithSsrFGuard({ url: "https://files.slack.com/f", auditContext: "t", policy }),
      ).resolves.toBeDefined();
      await expect(
        fetchWithSsrFGuard({ url: "https://slack.com/api/x", auditContext: "t", policy }),
      ).resolves.toBeDefined();
      await expect(
        fetchWithSsrFGuard({
          url: "https://slack.com.attacker.invalid/f",
          auditContext: "t",
          policy,
        }),
      ).rejects.toThrow(/is not allowed/);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("enforces `allowedOrigins` for an operator-selected API root", async () => {
    await expect(
      fetchWithSsrFGuard({
        url: "https://slack.internal.example:8443/upload",
        auditContext: "slack-upload-file",
        policy: {
          hostnameAllowlist: ["slack.internal.example"],
          allowedOrigins: ["https://slack.internal.example"],
        },
      }),
    ).rejects.toThrow(/origin https:\/\/slack.internal.example:8443 is not allowed/);
  });

  it("still refuses a non-https URL", async () => {
    await expect(
      fetchWithSsrFGuard({ url: "http://files.slack.com/f", auditContext: "t" }),
    ).rejects.toThrow(/requires https/);
  });
});

describe("fetchWithSsrFGuard redirects", () => {
  it("refuses to follow a redirect: the allowlist only vetted the first host", async () => {
    const spy = vi.fn(OK);
    vi.stubGlobal("fetch", spy);
    try {
      await fetchWithSsrFGuard({
        url: "https://files.slack.com/upload",
        auditContext: "slack-upload-file",
        policy: { hostnameAllowlist: ["files.slack.com"] },
        init: { method: "POST" },
      });
    } finally {
      vi.unstubAllGlobals();
    }
    expect(spy).toHaveBeenCalledTimes(1);
    const init = initOf(spy);
    expect(init.redirect).toBe("error");
    expect(init.method).toBe("POST");
  });

  it("applies the caller's timeoutMs instead of accepting and ignoring it", async () => {
    const spy = vi.fn(OK);
    vi.stubGlobal("fetch", spy);
    try {
      await fetchWithSsrFGuard({
        url: "https://files.slack.com/upload",
        auditContext: "t",
        timeoutMs: 5_000,
      });
    } finally {
      vi.unstubAllGlobals();
    }
    expect(initOf(spy).signal).toBeInstanceOf(AbortSignal);
  });
});
