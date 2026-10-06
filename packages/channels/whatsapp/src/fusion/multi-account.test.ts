// Two WhatsApp accounts in one Hub (docs/audits/2026-10-06-whatsapp-channel-review.md
// W1). The Hub imports this vertical once and every account load overwrites the
// channel-wide runtime slot, so a QR verb that used that slot logged in — or out —
// against whichever account loaded last. Each account's credentials must land in
// its own runtime's store, whatever the slot holds.
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { whatsappPlugin } from "../plugin.js";
import {
  accountHostRuntime,
  rememberAccountHostRuntime,
  setChannelHostRuntime,
} from "../runtime-store.js";
import {
  flushWhatsAppAuth,
  unbindWhatsAppAuthDir,
  WHATSAPP_AUTH_NAMESPACE,
  readFile,
  whatsAppAuthDirFor,
  writeFile,
} from "./auth-fs.js";
import { createRecordingHostRuntime } from "./test-support.js";

type Recording = ReturnType<typeof createRecordingHostRuntime>;

function authKeys(recording: Recording): string[] {
  return [...(recording.stores.get(WHATSAPP_AUTH_NAMESPACE)?.entries.keys() ?? [])];
}

const bind = (whatsappPlugin as { setup: { bindAccountSession(p: unknown): Promise<void> } }).setup
  .bindAccountSession;

describe("two WhatsApp accounts, one vertical", () => {
  afterEach(async () => {
    for (const id of ["first", "second", "third"]) await unbindWhatsAppAuthDir(id).catch(() => undefined);
  });

  it("logs an account in behind the runtime the Hub passed, not the last-loaded one", async () => {
    const first = createRecordingHostRuntime();
    const second = createRecordingHostRuntime();
    // `second` loaded last: the channel-wide slot is its runtime.
    setChannelHostRuntime(second.hostRuntime);
    await bind({ accountId: "first", hostRuntime: first.hostRuntime });
    const authDir = whatsAppAuthDirFor("first");
    await writeFile(path.join(authDir, "creds.json"), '{"me":{"id":"1@s.whatsapp.net"}}');
    await flushWhatsAppAuth("first");
    expect(authKeys(first)).toContain("auth-dir");
    expect(authKeys(second)).toEqual([]);
  });

  it("falls back to the runtime the account started with, never the channel-wide slot", () => {
    const started = createRecordingHostRuntime();
    const lastLoaded = createRecordingHostRuntime();
    rememberAccountHostRuntime("second", started.hostRuntime);
    setChannelHostRuntime(lastLoaded.hostRuntime);
    expect(accountHostRuntime("second")).toBe(started.hostRuntime);
  });

  it("forgets a disposed account: re-added under the same id, it starts from its own empty store", async () => {
    const removed = createRecordingHostRuntime();
    await bind({ accountId: "first", hostRuntime: removed.hostRuntime });
    await writeFile(path.join(whatsAppAuthDirFor("first"), "creds.json"), '{"me":{"id":"1@s.whatsapp.net"}}');
    (whatsappPlugin as { disposeAccount(id: string): void }).disposeAccount("first");
    expect(() => accountHostRuntime("first")).toThrow(/no host runtime/);
    // The Hub dropped the removed account's rows; the new account has none.
    const readded = createRecordingHostRuntime();
    await bind({ accountId: "first", hostRuntime: readded.hostRuntime });
    await expect(readFile(path.join(whatsAppAuthDirFor("first"), "creds.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("refuses an account it has no runtime for instead of guessing", () => {
    setChannelHostRuntime(createRecordingHostRuntime().hostRuntime);
    expect(() => accountHostRuntime("third")).toThrow(/no host runtime/);
  });
});
