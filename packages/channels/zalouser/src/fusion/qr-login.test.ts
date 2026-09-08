// The QR login state machine, driven through the Fusion setup verbs against a
// fake `zca-js` client (D-ZU-016). The machine itself is upstream's
// (`zalo-js.ts` `startZaloQrLogin` / `waitForZaloQrLogin` /
// `logoutZaloProfile`); what is asserted here is that each state reaches the
// Hub as one of `pending` / `linked` / `failed`, and that a linked report is
// only made after the session store has actually taken the credentials.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createZaloMock = vi.hoisted(() => vi.fn());
vi.mock("../zca-client.js", async () => {
  const actual = await vi.importActual<typeof import("../zca-client.js")>("../zca-client.js");
  return { ...actual, createZalo: createZaloMock };
});

import { loadStoredZaloCredentials, zalouserCredentialStoreKey } from "../session-state.js";
import {
  cancelZalouserQrLogin,
  logoutZalouser,
  pollZalouserQrLogin,
  startZalouserQrLogin,
} from "./qr-setup.js";
import {
  createMemorySessionStore,
  hydrateZalouserSessions,
  installZalouserSessionStore,
} from "./session-store.js";
import { createFakeZalo } from "./test-support.js";

const PNG = "iVBORw0KGgo=";
const TEST_ACCOUNT = "acct-qr";

let store: ReturnType<typeof createMemorySessionStore>;

beforeEach(async () => {
  store = createMemorySessionStore();
  installZalouserSessionStore(TEST_ACCOUNT, store);
  await hydrateZalouserSessions(TEST_ACCOUNT);
  createZaloMock.mockReset();
});

afterEach(async () => {
  // Leave no pending QR behind: a fresh profile per case keeps the module-level
  // active-login map from leaking between tests.
  installZalouserSessionStore(TEST_ACCOUNT, undefined);
});

describe("QR login state machine", () => {
  it("pending: a generated QR is returned as a data URL and the login stays open", async () => {
    const fake = createFakeZalo({ steps: [{ kind: "generated", image: PNG }] });
    createZaloMock.mockImplementation(fake.createZalo);

    const started = await startZalouserQrLogin({
      profile: "p-pending",
      timeoutMs: 3000,
      writeTempFile: false,
    });

    expect(started.status).toBe("pending");
    expect(started.qrDataUrl).toBe(`data:image/png;base64,${PNG}`);
    expect(started.message).toMatch(/scan/i);

    const polled = await pollZalouserQrLogin({ profile: "p-pending", timeoutMs: 300 });
    expect(polled.status).toBe("pending");
  });

  it("scanned then logged-in: the poll reports linked and the session is persisted first", async () => {
    const fake = createFakeZalo({
      steps: [
        { kind: "generated", image: PNG },
        { kind: "scanned" },
        { kind: "logged-in", imei: "imei-linked" },
      ],
      // Slow enough that the start call returns while the QR is still pending,
      // so the poll path is the one under test. A login that completes inside
      // the start budget is upstream's "Zalo already connected." shortcut, which
      // the relink case below exercises.
      stepDelayMs: 400,
    });
    createZaloMock.mockImplementation(fake.createZalo);

    const started = await startZalouserQrLogin({
      profile: "p-linked",
      timeoutMs: 3000,
      writeTempFile: false,
    });
    expect(started.status).toBe("pending");

    const polled = await pollZalouserQrLogin({ profile: "p-linked", timeoutMs: 3000 });
    expect(polled.status).toBe("linked");
    expect(polled.user?.displayName).toBe("Owner");
    // The store already holds the credentials at the moment `linked` is reported.
    expect(store.rows.get(zalouserCredentialStoreKey("p-linked"))).toMatchObject({
      profile: "p-linked",
      // Upstream's `snapshotApiCredentials` prefers the LIVE session context
      // over the QR callback payload; the stub API reports `imei-1`.
      imei: "imei-1",
    });
  });

  // Upstream reports an expiry/decline that lands INSIDE the start budget on
  // the start call itself: its loop checks `active.error` before `qrDataUrl` on
  // every 150ms tick and resets the login, so the pending QR is already gone by
  // the time a poll runs. The Hub therefore learns about both from `start`.
  it("expired: a QR whose retry fails is reported as a failed start", async () => {
    const fake = createFakeZalo({
      steps: [
        { kind: "generated", image: PNG },
        { kind: "expired" },
      ],
      retryFails: true,
      stepDelayMs: 5,
    });
    createZaloMock.mockImplementation(fake.createZalo);

    const started = await startZalouserQrLogin({
      profile: "p-expired",
      timeoutMs: 3000,
      writeTempFile: false,
    });

    expect(started.status).toBe("failed");
    expect(started.message).toMatch(/expired/i);
    expect(started.qrDataUrl).toBeUndefined();

    // The pending login is gone, so a later poll says so rather than hanging.
    const polled = await pollZalouserQrLogin({ profile: "p-expired", timeoutMs: 500 });
    expect(polled.status).toBe("failed");
    expect(polled.message).toMatch(/no active/i);
  });

  it("declined: a refusal on the phone fails the login", async () => {
    const fake = createFakeZalo({
      steps: [
        { kind: "generated", image: PNG },
        { kind: "declined" },
      ],
      stepDelayMs: 5,
    });
    createZaloMock.mockImplementation(fake.createZalo);

    const started = await startZalouserQrLogin({
      profile: "p-declined",
      timeoutMs: 3000,
      writeTempFile: false,
    });

    expect(started.status).toBe("failed");
    expect(started.message).toMatch(/declined/i);
  });

  it("relink: forces a fresh QR after discarding the stored session", async () => {
    const linked = createFakeZalo({
      steps: [
        { kind: "generated", image: PNG },
        { kind: "logged-in", imei: "imei-first" },
      ],
      stepDelayMs: 5,
    });
    createZaloMock.mockImplementation(linked.createZalo);
    await startZalouserQrLogin({ profile: "p-relink", timeoutMs: 3000, writeTempFile: false });
    await pollZalouserQrLogin({ profile: "p-relink", timeoutMs: 3000 });
    // Upstream's `snapshotApiCredentials` prefers the LIVE session context over
    // the QR callback's captured payload, so the stored imei is the API's.
    expect(loadStoredZaloCredentials("p-relink")?.imei).toBe("imei-1");

    const again = createFakeZalo({ steps: [{ kind: "generated", image: PNG }] });
    createZaloMock.mockImplementation(again.createZalo);
    const relinked = await startZalouserQrLogin({
      profile: "p-relink",
      relink: true,
      timeoutMs: 3000,
      writeTempFile: false,
    });

    expect(relinked.status).toBe("pending");
    expect(relinked.qrDataUrl).toBe(`data:image/png;base64,${PNG}`);
    // The old session was revoked before the new QR was generated.
    expect(loadStoredZaloCredentials("p-relink")).toBeNull();
  });

  it("cancel: abandons a pending QR without a stored session", async () => {
    const fake = createFakeZalo({ steps: [{ kind: "generated", image: PNG }] });
    createZaloMock.mockImplementation(fake.createZalo);
    await startZalouserQrLogin({ profile: "p-cancel", timeoutMs: 3000, writeTempFile: false });

    const cancelled = await cancelZalouserQrLogin({ profile: "p-cancel" });
    expect(cancelled.cancelled).toBe(true);
  });

  it("logout: clears the session and leaves the durable revocation marker", async () => {
    const fake = createFakeZalo({
      steps: [
        { kind: "generated", image: PNG },
        { kind: "logged-in" },
      ],
      stepDelayMs: 5,
    });
    createZaloMock.mockImplementation(fake.createZalo);
    await startZalouserQrLogin({ profile: "p-logout", timeoutMs: 3000, writeTempFile: false });
    await pollZalouserQrLogin({ profile: "p-logout", timeoutMs: 3000 });

    const result = await logoutZalouser({ profile: "p-logout" });
    expect(result.cleared).toBe(true);
    expect(store.rows.get(zalouserCredentialStoreKey("p-logout"))).toMatchObject({
      kind: "revoked",
    });
  });
});
