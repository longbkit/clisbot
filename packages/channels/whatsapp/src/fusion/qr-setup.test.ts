import { beforeEach, describe, expect, it, vi } from "vitest";

const login = vi.hoisted(() => ({ start: vi.fn(), wait: vi.fn(), logout: vi.fn(), selfId: vi.fn() }));
vi.mock("../login-qr.js", () => ({ startWebLoginWithQr: login.start, waitForWebLogin: login.wait }));
vi.mock("../auth-store.js", () => ({ logoutWeb: login.logout, readWebSelfId: login.selfId }));
const order = vi.hoisted(() => ({
  calls: [] as string[],
  live: false,
  stopped: true,
  toldWhatsApp: true,
  boundWith: [] as unknown[],
}));
vi.mock("../lifecycle/start-account.js", () => ({
  stopWhatsAppAccountForUnlink: async () => {
    order.calls.push("stop");
    return {
      running: order.live,
      stopped: order.live ? order.stopped : true,
      toldWhatsApp: order.live && order.toldWhatsApp,
    };
  },
}));
vi.mock("./auth-fs.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./auth-fs.js")>()),
  bindWhatsAppAuthDir: async (params: { hostRuntime: unknown }) => {
    order.calls.push("bind");
    order.boundWith.push(params.hostRuntime);
    return "/virtual";
  },
  flushWhatsAppAuth: async () => {},
}));
vi.mock("../runtime-store.js", () => ({
  accountHostRuntime: (_accountId: string, passed?: unknown) => passed ?? { remembered: true },
}));

const qr = await import("./qr-setup.js");

describe("fusion QR verbs (the Hub's start/poll/cancel/relink/logout)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    login.selfId.mockReturnValue({ e164: "+15550001111", jid: "15550001111@s.whatsapp.net", lid: null });
  });

  it("start: a fresh QR is pending and carries the image", async () => {
    login.start.mockResolvedValue({ qrDataUrl: "data:image/png;base64,AAA", message: "Scan this QR" });
    expect(await qr.startWhatsAppQrLogin({ accountId: "a" })).toEqual({
      status: "pending",
      message: "Scan this QR",
      qrDataUrl: "data:image/png;base64,AAA",
    });
    expect(login.start).toHaveBeenCalledWith(expect.objectContaining({ accountId: "a", force: false }));
  });

  it("start: an account already linked answers linked with the number", async () => {
    login.start.mockResolvedValue({ message: "WhatsApp is already linked (+15550001111)." });
    expect(await qr.startWhatsAppQrLogin({ accountId: "a" })).toMatchObject({
      status: "linked",
      user: { userId: "+15550001111" },
    });
  });

  it("relink forces a fresh QR", async () => {
    login.start.mockResolvedValue({ qrDataUrl: "data:image/png;base64,BBB", message: "Scan" });
    await qr.startWhatsAppQrLogin({ accountId: "a", relink: true });
    expect(login.start).toHaveBeenCalledWith(expect.objectContaining({ force: true }));
  });

  it("poll: pending keeps the image, a rotated code replaces it, a scan links", async () => {
    login.start.mockResolvedValue({ qrDataUrl: "data:image/png;base64,ONE", message: "Scan" });
    await qr.startWhatsAppQrLogin({ accountId: "a" });
    login.wait.mockResolvedValueOnce({ connected: false, message: "Still waiting for the QR scan." });
    expect(await qr.pollWhatsAppQrLogin({ accountId: "a" })).toMatchObject({ status: "pending", qrDataUrl: "data:image/png;base64,ONE" });
    login.wait.mockResolvedValueOnce({ connected: false, message: "QR refreshed.", qrDataUrl: "data:image/png;base64,TWO" });
    expect(await qr.pollWhatsAppQrLogin({ accountId: "a" })).toMatchObject({ status: "pending", qrDataUrl: "data:image/png;base64,TWO" });
    expect(login.wait).toHaveBeenLastCalledWith(expect.objectContaining({ currentQrDataUrl: "data:image/png;base64,ONE" }));
    login.wait.mockResolvedValueOnce({ connected: true, message: "✅ Linked! WhatsApp is ready." });
    expect(await qr.pollWhatsAppQrLogin({ accountId: "a" })).toMatchObject({ status: "linked", user: { userId: "+15550001111" } });
  });

  it("poll: an expired or failed login is failed", async () => {
    login.wait.mockResolvedValue({ connected: false, message: "The login QR expired. Ask me to generate a new one." });
    expect((await qr.pollWhatsAppQrLogin({ accountId: "a" })).status).toBe("failed");
  });

  it("cancel only abandons a pending code", async () => {
    expect(await qr.cancelWhatsAppQrLogin({ accountId: "none" })).toMatchObject({ cancelled: false });
    login.start.mockResolvedValue({ qrDataUrl: "data:image/png;base64,X", message: "Scan" });
    await qr.startWhatsAppQrLogin({ accountId: "c" });
    expect(await qr.cancelWhatsAppQrLogin({ accountId: "c" })).toMatchObject({ cancelled: true });
  });

  it("logout reports whether linked-device credentials were cleared", async () => {
    login.logout.mockResolvedValue(true);
    expect(await qr.logoutWhatsApp({ accountId: "a" })).toMatchObject({ cleared: true });
    login.logout.mockResolvedValue(false);
    expect(await qr.logoutWhatsApp({ accountId: "a" })).toMatchObject({ cleared: false });
  });

  it("logout stops a running account before clearing its credentials", async () => {
    order.calls.length = 0;
    order.live = true;
    login.logout.mockImplementation(async () => {
      order.calls.push("clear");
      return true;
    });
    expect(await qr.logoutWhatsApp({ accountId: "a" })).toMatchObject({ cleared: true });
    expect(order.calls).toEqual(["stop", "bind", "clear"]);
    order.live = false;
  });

  it("logout clears the keys behind the runtime the Hub passed for that account", async () => {
    order.live = true;
    order.boundWith.length = 0;
    login.logout.mockResolvedValue(true);
    const own = { account: "a" };
    await qr.logoutWhatsApp({ accountId: "a", hostRuntime: own as never });
    expect(order.boundWith).toEqual([own]);
    order.live = false;
  });

  it("logout clears nothing while the account has not stopped yet", async () => {
    order.calls.length = 0;
    order.live = true;
    order.stopped = false;
    login.logout.mockImplementation(async () => {
      order.calls.push("clear");
      return true;
    });
    expect(await qr.logoutWhatsApp({ accountId: "a" })).toMatchObject({
      cleared: false,
      message: expect.stringContaining("still stopping"),
    });
    expect(order.calls).toEqual(["stop"]);
    order.live = false;
    order.stopped = true;
  });

  it("logout between connections says to remove the device on the phone", async () => {
    order.live = true;
    order.toldWhatsApp = false;
    login.logout.mockResolvedValue(true);
    expect(await qr.logoutWhatsApp({ accountId: "a" })).toMatchObject({
      cleared: true,
      message: expect.stringContaining("Linked devices"),
    });
    order.live = false;
    order.toldWhatsApp = true;
  });
});
