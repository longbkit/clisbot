// Two Zalo Personal accounts in one Hub (docs/audits/2026-10-06-whatsapp-channel-review.md
// W1). The Hub imports this vertical once and every account load overwrites the
// channel-wide runtime slot, so binding a QR login through that slot stored one
// account's session in whichever account loaded last.
import { beforeEach, describe, expect, it } from "vitest";
import { zalouserPlugin } from "../plugin.js";
import {
  accountHostRuntime,
  rememberAccountHostRuntime,
  setChannelHostRuntime,
} from "../runtime-store.js";
import { saveStoredZaloCredentials } from "../session-state.js";
import {
  flushZalouserSessions,
  installZalouserSessionStore,
  withZalouserSessionMint,
} from "./session-store.js";
import { createHostRuntimeStub } from "./test-support.js";

const credentials = {
  imei: "imei-a",
  cookie: [{ key: "zpsid", value: "abc" }],
  userAgent: "agent-a",
  createdAt: "2026-10-06T00:00:00.000Z",
};

const bind = (zalouserPlugin as { setup: { bindAccountSession(p: unknown): Promise<void> } }).setup
  .bindAccountSession;

beforeEach(() => {
  installZalouserSessionStore("acct-a", undefined);
  installZalouserSessionStore("acct-b", undefined);
});

describe("two Zalo Personal accounts, one vertical", () => {
  it("stores a login behind the runtime the Hub passed, not the last-loaded one", async () => {
    const first = createHostRuntimeStub();
    const lastLoaded = createHostRuntimeStub();
    setChannelHostRuntime(lastLoaded.runtime);
    await bind({ accountId: "acct-a", hostRuntime: first.runtime });
    await withZalouserSessionMint("acct-a", async () => {
      saveStoredZaloCredentials("profile-a", credentials);
      await flushZalouserSessions();
    });
    expect([...(first.stores.get("credentials")?.keys() ?? [])]).toHaveLength(1);
    expect(lastLoaded.stores.get("credentials")?.size ?? 0).toBe(0);
  });

  it("falls back to the runtime the account started with, and refuses an unknown one", () => {
    const started = createHostRuntimeStub();
    rememberAccountHostRuntime("acct-b", started.runtime);
    setChannelHostRuntime(createHostRuntimeStub().runtime);
    expect(accountHostRuntime("acct-b")).toBe(started.runtime);
    expect(() => accountHostRuntime("acct-never-started")).toThrow(/no host runtime/);
  });
});
