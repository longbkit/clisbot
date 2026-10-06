// W2 (docs/audits/2026-10-06-whatsapp-channel-review.md): Log out while the
// account sits between connections. There is no socket to close then, so the
// session must still stop — as logged out — instead of reconnecting on keys
// that Log out is about to clear. The REAL reconnect loop runs here; only the
// connection controller underneath is replaced, by one that keeps failing to
// connect and sleeps on the signal it was given, as the real one does.
import { describe, expect, it, vi } from "vitest";

const controllers = vi.hoisted(() => ({ opened: 0 }));
vi.mock("../connection-controller.js", () => ({
  WhatsAppConnectionController: class {
    private readonly signal: AbortSignal;
    socketRef = { current: null };
    constructor(params: { abortSignal: AbortSignal }) {
      this.signal = params.abortSignal;
    }
    getCurrentSock() {
      return null;
    }
    forceClose() {}
    getDisconnectRetryAbortSignal() {
      return this.signal;
    }
    shouldRetryDisconnect() {
      return true;
    }
    async openConnection() {
      controllers.opened += 1;
      throw new Error("connection failed");
    }
    resolveSetupErrorDecision() {
      if (this.signal.aborted) return "aborted";
      return { action: "retry", delayMs: 60_000, reconnectAttempts: 1, normalized: { statusLabel: 500 } };
    }
    // As core's `sleepWithAbort`: an abort rejects, also one that came first.
    async waitBeforeRetry(delayMs: number) {
      await new Promise<void>((resolve, reject) => {
        const abort = () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
        if (this.signal.aborted) return abort();
        const timer = setTimeout(resolve, delayMs);
        this.signal.addEventListener("abort", () => {
          clearTimeout(timer);
          abort();
        });
      });
    }
    async shutdown() {}
  },
}));

const { startWhatsAppListenerSession, WhatsAppNotLinkedError } = await import("./listener-session.js");

describe("Log out while the account is reconnecting", () => {
  it("stops the session as logged out, without waiting out the backoff", async () => {
    controllers.opened = 0;
    let logout: (() => void) | undefined;
    const running = startWhatsAppListenerSession({
      cfg: { channels: { whatsapp: {} } } as never,
      account: { accountId: "main", authDir: "/virtual/main" } as never,
      admit: async () => true,
      abortSignal: new AbortController().signal,
      onLive: (control) => {
        logout = control.forceLoggedOut;
      },
    });
    // The first connect failed; the loop is sleeping before its retry.
    await vi.waitFor(() => expect(controllers.opened).toBe(1));
    const startedAt = Date.now();
    logout?.();
    await expect(running).rejects.toBeInstanceOf(WhatsAppNotLinkedError);
    expect(Date.now() - startedAt).toBeLessThan(5_000);
    expect(controllers.opened).toBe(1);
  });

  it("stops with the Hub's own abort when the Hub stops the account instead", async () => {
    controllers.opened = 0;
    const stop = new AbortController();
    const running = startWhatsAppListenerSession({
      cfg: { channels: { whatsapp: {} } } as never,
      account: { accountId: "main", authDir: "/virtual/main" } as never,
      admit: async () => true,
      abortSignal: stop.signal,
    });
    await vi.waitFor(() => expect(controllers.opened).toBe(1));
    stop.abort();
    // Not a logout: whatever the stop throws, it is not "not logged in".
    const outcome = await running.then(() => undefined, (error: unknown) => error);
    expect(outcome).not.toBeInstanceOf(WhatsAppNotLinkedError);
  });
});
