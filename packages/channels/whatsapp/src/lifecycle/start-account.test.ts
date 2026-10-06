import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { bindWhatsAppAuthDir, unbindWhatsAppAuthDir, whatsAppAuthDirFor, writeFile } from "../fusion/auth-fs.js";
import { createRecordingHostRuntime } from "../fusion/test-support.js";

const listener = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock("../fusion/listener-session.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../fusion/listener-session.js")>()),
  startWhatsAppListenerSession: listener.run,
}));

const { startWhatsAppAccount, stopWhatsAppAccountForUnlink } = await import("./start-account.js");

/** The Hub's `needs-login` marker (`packages/hub/src/channels/supervisor/needs-login.ts`). */
const HUB_NOT_LINKED = /\bis not logged in\b/iu;

function context(accountId: string, abortSignal = new AbortController().signal) {
  return {
    accountId,
    account: { accountId },
    cfg: { channels: { whatsapp: { accounts: { [accountId]: {} } } } },
    runtime: { log: () => {}, error: () => {}, exit: () => {} },
    abortSignal,
    setStatus: vi.fn(),
    getStatus: () => undefined,
    mediaDownloadDir: "/tmp/clisbot-wa-downloads",
  };
}

describe("startWhatsAppAccount", () => {
  afterEach(async () => {
    listener.run.mockReset();
    await unbindWhatsAppAuthDir("linked").catch(() => undefined);
  });

  it("fails an unlinked account with the phrase the Hub turns into needs-login", async () => {
    const { hostRuntime } = createRecordingHostRuntime();
    await expect(startWhatsAppAccount(context("fresh") as never, hostRuntime)).rejects.toThrow(HUB_NOT_LINKED);
    expect(listener.run).not.toHaveBeenCalled();
  });

  it("treats creds without the device's own identity as not linked", async () => {
    const { hostRuntime } = createRecordingHostRuntime();
    const authDir = await bindWhatsAppAuthDir({ accountId: "half", hostRuntime });
    await writeFile(path.join(authDir, "creds.json"), JSON.stringify({ noiseKey: {} }));
    await unbindWhatsAppAuthDir("half");
    await expect(startWhatsAppAccount(context("half") as never, hostRuntime)).rejects.toThrow(HUB_NOT_LINKED);
  });

  it("runs the listener for a linked account and unbinds when it ends", async () => {
    const { hostRuntime } = createRecordingHostRuntime();
    const authDir = await bindWhatsAppAuthDir({ accountId: "linked", hostRuntime });
    await writeFile(path.join(authDir, "creds.json"), JSON.stringify({ me: { id: "15550001111:2@s.whatsapp.net" } }));
    await unbindWhatsAppAuthDir("linked");
    listener.run.mockResolvedValueOnce(undefined);
    const ctx = context("linked");
    await startWhatsAppAccount(ctx as never, hostRuntime);
    expect(listener.run).toHaveBeenCalledWith(
      expect.objectContaining({
        account: expect.objectContaining({ accountId: "linked", authDir: whatsAppAuthDirFor("linked") }),
        mediaDownloadDir: "/tmp/clisbot-wa-downloads",
      }),
    );
    expect(ctx.setStatus).toHaveBeenLastCalledWith({ state: "stopped", accountId: "linked" });
  });

  it("surfaces a logged-out device as not linked", async () => {
    const { WhatsAppNotLinkedError } = await import("../fusion/listener-session.js");
    expect(new WhatsAppNotLinkedError("a", "WhatsApp logged this linked device out").message).toMatch(HUB_NOT_LINKED);
  });

  it("Unlink logs the device out, ends the session as not linked, and waits for the stop", async () => {
    const { hostRuntime } = createRecordingHostRuntime();
    const authDir = await bindWhatsAppAuthDir({ accountId: "linked", hostRuntime });
    await writeFile(path.join(authDir, "creds.json"), JSON.stringify({ me: { id: "15550001111:2@s.whatsapp.net" } }));
    await unbindWhatsAppAuthDir("linked");
    const logout = vi.fn(async () => {});
    const { WhatsAppNotLinkedError } = await import("../fusion/listener-session.js");
    listener.run.mockImplementationOnce(
      (options: { onLive: (control: { getSock(): unknown; forceLoggedOut(): void }) => void }) =>
        new Promise<void>((_resolve, reject) => {
          options.onLive({
            getSock: () => ({ logout }),
            forceLoggedOut: () => reject(new WhatsAppNotLinkedError("linked", "WhatsApp logged this linked device out")),
          });
        }),
    );
    const ctx = context("linked");
    const running = startWhatsAppAccount(ctx as never, hostRuntime);
    await vi.waitFor(() => expect(listener.run).toHaveBeenCalled());
    expect(await stopWhatsAppAccountForUnlink("linked")).toEqual({
      running: true,
      stopped: true,
      toldWhatsApp: true,
    });
    expect(logout).toHaveBeenCalledOnce();
    await expect(running).rejects.toThrow(HUB_NOT_LINKED);
    expect(ctx.setStatus).toHaveBeenLastCalledWith({ state: "stopped", accountId: "linked" });
    expect(await stopWhatsAppAccountForUnlink("linked")).toMatchObject({ running: false });
  });
});
