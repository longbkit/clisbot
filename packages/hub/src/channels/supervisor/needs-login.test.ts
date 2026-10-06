// The `needs-login` classifier, pinned to the REAL vertical's own failure — the
// same differential shape the credential probes use. The Hub reads a message,
// so the test drives the vertical's actual `startAccount` with an unlinked
// profile and asserts the classifier recognises what comes back. A wording
// change upstream fails here rather than silently turning "scan the QR again"
// into an unactionable "failed".
//
// The vertical is imported from its build output (`npm run build --workspace=…`).
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import zalouserEntry from "@clisbot/channels-zalouser/dist/entry.js";
import { zalouserPlugin } from "@clisbot/channels-zalouser/dist/plugin.js";
import whatsappEntry from "@clisbot/channels-whatsapp/dist/entry.js";
import { whatsappPlugin } from "@clisbot/channels-whatsapp/dist/plugin.js";
import type { HostRuntime, KeyedStoreEntry } from "@clisbot/channels-shared";
import { buildAccountCarriers } from "./account-carriers.js";
import { linkEndsNeedsLogin } from "./qr-login.js";
import {
  channelUsesQrLogin,
  isNeedsLoginFailure,
  isSettledTransport,
  monitorFailureTransport,
} from "./needs-login.js";
import type { CompiledChannelAccount } from "../config/compile.js";

const ACCOUNT_ID = "personal";

/** An empty keyed store: the account has never been linked. */
function hostRuntime(): HostRuntime {
  return {
    onInboundReply: async () => ({ dispatched: true }),
    state: {
      openKeyedStore: () => ({
        register: async () => undefined,
        registerIfAbsent: async () => true,
        update: async () => true,
        lookup: async () => undefined,
        consume: async () => undefined,
        delete: async () => false,
        entries: async () => [] as KeyedStoreEntry<unknown>[],
        clear: async () => undefined,
      }),
    },
    logging: { getChildLogger: () => ({ warn: () => undefined }) },
    channel: {},
  } as unknown as HostRuntime;
}

function compiledAccount(
  channel: CompiledChannelAccount["channel"] = "zalouser",
): CompiledChannelAccount {
  return {
    channel,
    accountId: ACCOUNT_ID,
    enabled: true,
    channelEnabled: true,
    connectionId: "connection",
    transport: { mode: "qr" },
    config: {},
    defaultRoles: [],
    assignments: [],
    defaults: {} as CompiledChannelAccount["defaults"],
    approval: [],
    routes: [],
  };
}

describe("needs-login classification", () => {
  it("recognises the real vertical's unlinked-profile start failure", async () => {
    const { account, cfgAccount } = buildAccountCarriers("zalouser", {
      accountId: ACCOUNT_ID,
      compiled: compiledAccount(),
      profile: "unlinked-profile",
    });
    const host = hostRuntime();
    zalouserEntry.setChannelRuntime(host);
    const start = zalouserPlugin.gateway?.startAccount as (context: unknown) => Promise<void>;
    assert.equal(typeof start, "function");

    let detail = "";
    try {
      await start({
        accountId: ACCOUNT_ID,
        account,
        cfg: { channels: { zalouser: { accounts: { [ACCOUNT_ID]: cfgAccount } } } },
        hostRuntime: host,
        abortSignal: new AbortController().signal,
        setStatus: () => undefined,
        getStatus: () => undefined,
        log: { warn: () => undefined },
      });
      assert.fail("an unlinked profile must fail the start");
    } catch (error) {
      detail = error instanceof Error ? error.message : String(error);
    }
    assert.equal(isNeedsLoginFailure("zalouser", detail), true, detail);
  });

  it("recognises the real WhatsApp vertical's never-linked start failure", async () => {
    const { account, cfgAccount } = buildAccountCarriers("whatsapp", {
      accountId: ACCOUNT_ID,
      compiled: compiledAccount("whatsapp"),
    });
    const host = hostRuntime();
    whatsappEntry.setChannelRuntime(host);
    const start = whatsappPlugin.gateway?.startAccount as (context: unknown) => Promise<void>;
    let detail = "";
    try {
      await start({
        accountId: ACCOUNT_ID,
        account,
        cfg: { channels: { whatsapp: { accounts: { [ACCOUNT_ID]: cfgAccount } } } },
        hostRuntime: host,
        abortSignal: new AbortController().signal,
        setStatus: () => undefined,
        getStatus: () => undefined,
        log: { warn: () => undefined },
      });
      assert.fail("an unlinked WhatsApp account must fail the start");
    } catch (error) {
      detail = error instanceof Error ? error.message : String(error);
    }
    assert.equal(isNeedsLoginFailure("whatsapp", detail), true, detail);
  });

  it("leaves an ordinary failure on a QR channel a failure", () => {
    assert.equal(channelUsesQrLogin("zalouser"), true);
    assert.equal(isNeedsLoginFailure("zalouser", "socket hang up"), false);
  });

  it("never classifies a token channel as needing a login", () => {
    assert.equal(channelUsesQrLogin("telegram"), false);
    assert.equal(isNeedsLoginFailure("telegram", "the account is not linked"), false);
  });

  it("parks an unlinked account instead of failing it, and leaves it parked", () => {
    assert.equal(
      monitorFailureTransport("zalouser", 'account "x" is not logged in'),
      "needs-login",
    );
    // The wording verticals used before QR sign-in was named Login.
    assert.equal(monitorFailureTransport("zalouser", 'account "x" is not linked'), "needs-login");
    assert.equal(monitorFailureTransport("zalouser", "socket hang up"), "failed");
    // Reconcile re-drives a failed account and leaves a parked one alone: only a
    // human QR scan (which starts it, below) or a new revision changes the answer.
    assert.equal(isSettledTransport("needs-login"), true);
    assert.equal(isSettledTransport("failed"), false);
    assert.equal(isSettledTransport("started"), true);
    assert.equal(isSettledTransport("deferred"), false);
  });

  it("starts a parked account once its QR login links, and nothing else", () => {
    const linked = { status: "linked" as const, message: "Login successful." };
    assert.equal(linkEndsNeedsLogin(linked, "needs-login"), true);
    assert.equal(linkEndsNeedsLogin(linked, "started"), false);
    assert.equal(linkEndsNeedsLogin(linked, undefined), false);
    assert.equal(
      linkEndsNeedsLogin({ status: "pending", message: "scan the code" }, "needs-login"),
      false,
    );
    assert.equal(
      linkEndsNeedsLogin({ cleared: true, message: "logged out" }, "needs-login"),
      false,
    );
  });
});
