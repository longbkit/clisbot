import { describe, expect, it } from "vitest";
import {
  channelQrFailure,
  CHANNEL_QR_TTL_MS,
  isChannelQrExpiryMessage,
  openChannelQrLinking,
  shouldPollChannelQr,
} from "./channel-qr-linking";

function linked() {
  const model = openChannelQrLinking({ available: true });
  model.begin("start");
  model.applyStart(
    { status: "pending", qrDataUrl: "data:image/png;base64,AAA", message: "Scan" },
    0,
  );
  model.beginPoll();
  model.applyPoll({
    status: "linked",
    message: "Linked",
    user: { userId: "u1", displayName: "Long" },
  });
  return model;
}

describe("unavailable Hub", () => {
  it("offers nothing and says why", () => {
    const model = openChannelQrLinking({ available: false });
    expect(model.getState()).toMatchObject({
      phase: "unavailable",
      actions: [],
      message: "This Hub does not serve QR linking for this channel.",
    });
  });

  it("ignores every command", () => {
    const model = openChannelQrLinking({ available: false });
    model.begin("start");
    model.applyStart({ status: "pending", message: "Scan" });
    model.fail({ unavailable: false, message: "boom" });
    expect(model.getState().phase).toBe("unavailable");
  });
});

describe("start", () => {
  it("shows the code and starts the expiry clock", () => {
    const model = openChannelQrLinking({ available: true });
    expect(model.getState().actions).toEqual(["start"]);
    model.begin("start");
    expect(model.getState()).toMatchObject({ phase: "starting", busy: true, actions: [] });
    model.applyStart(
      {
        status: "pending",
        qrDataUrl: "data:image/png;base64,AAA",
        qrFilePath: "/tmp/qr.png",
        message: "Scan",
      },
      1_000,
    );
    expect(model.getState()).toMatchObject({
      phase: "pending",
      qrDataUrl: "data:image/png;base64,AAA",
      qrFilePath: "/tmp/qr.png",
      busy: false,
      expiresAt: 1_000 + CHANNEL_QR_TTL_MS,
      actions: ["cancel"],
    });
  });

  it("accepts a start that lands linked without a poll", () => {
    const model = openChannelQrLinking({ available: true });
    model.begin("start");
    model.applyStart({ status: "linked", message: "Already linked" });
    expect(model.getState()).toMatchObject({
      phase: "linked",
      qrDataUrl: null,
      actions: ["relink", "logout"],
    });
  });

  it("reads an expiry failure as a code to regenerate", () => {
    const model = openChannelQrLinking({ available: true });
    model.begin("start");
    model.applyStart({ status: "failed", message: "the QR code expired" });
    expect(model.getState()).toMatchObject({ phase: "expired", actions: ["start"] });
  });

  it("keeps any other failure a failure", () => {
    const model = openChannelQrLinking({ available: true });
    model.begin("start");
    model.applyStart({ status: "failed", message: "zca-js refused the profile" });
    expect(model.getState()).toMatchObject({
      phase: "failed",
      message: "zca-js refused the profile",
      actions: ["start"],
    });
  });
});

describe("polling", () => {
  it("polls only while a code is on screen and nothing is in flight", () => {
    const model = openChannelQrLinking({ available: true });
    expect(shouldPollChannelQr(model.getState())).toBe(false);
    model.begin("start");
    expect(shouldPollChannelQr(model.getState())).toBe(false);
    model.applyStart({ status: "pending", message: "Scan" }, 0);
    expect(shouldPollChannelQr(model.getState())).toBe(true);
    model.beginPoll();
    expect(shouldPollChannelQr(model.getState())).toBe(false);
    model.applyPoll({ status: "pending", message: "Waiting" });
    expect(shouldPollChannelQr(model.getState())).toBe(true);
  });

  it("keeps the code while a pending poll answers", () => {
    const model = openChannelQrLinking({ available: true });
    model.begin("start");
    model.applyStart(
      { status: "pending", qrDataUrl: "data:image/png;base64,AAA", message: "Scan" },
      0,
    );
    model.beginPoll();
    expect(model.getState()).toMatchObject({
      polling: true,
      qrDataUrl: "data:image/png;base64,AAA",
    });
    model.applyPoll({ status: "pending", message: "Waiting" });
    expect(model.getState()).toMatchObject({ polling: false, phase: "pending" });
  });

  it("names the account it linked", () => {
    expect(linked().getState()).toMatchObject({
      phase: "linked",
      user: { userId: "u1", displayName: "Long" },
      qrDataUrl: null,
    });
  });

  it("ignores a poll answer that arrives after the code was cancelled", () => {
    const model = openChannelQrLinking({ available: true });
    model.begin("start");
    model.applyStart({ status: "pending", message: "Scan" }, 0);
    model.begin("cancel");
    model.applyCancel({ cancelled: true, message: "Cancelled" });
    model.applyPoll({
      status: "linked",
      message: "Linked",
      user: { userId: "u1", displayName: null },
    });
    expect(model.getState()).toMatchObject({ phase: "idle", user: null });
  });
});

describe("expiry", () => {
  it("expires the code on its own clock", () => {
    const model = openChannelQrLinking({ available: true });
    model.begin("start");
    model.applyStart(
      { status: "pending", qrDataUrl: "data:image/png;base64,AAA", message: "Scan" },
      0,
    );
    model.tick(CHANNEL_QR_TTL_MS - 1);
    expect(model.getState()).toMatchObject({ phase: "pending", remainingMs: 1 });
    model.tick(CHANNEL_QR_TTL_MS);
    expect(model.getState()).toMatchObject({
      phase: "expired",
      qrDataUrl: null,
      message: "The QR code expired. Generate a new one.",
      actions: ["start"],
    });
  });

  it("recognizes the messages the verbs use for it", () => {
    expect(isChannelQrExpiryMessage("QR expired")).toBe(true);
    expect(isChannelQrExpiryMessage("login window has expired, retry")).toBe(true);
    expect(isChannelQrExpiryMessage("network unreachable")).toBe(false);
  });
});

describe("cancel, relink and logout", () => {
  it("returns to idle when a cancel took", () => {
    const model = openChannelQrLinking({ available: true });
    model.begin("start");
    model.applyStart({ status: "pending", message: "Scan" }, 0);
    model.begin("cancel");
    expect(model.getState().actions).toEqual([]);
    model.applyCancel({ cancelled: true, message: "Cancelled" });
    expect(model.getState()).toMatchObject({ phase: "idle", actions: ["start"] });
  });

  it("keeps a live session when cancel refuses it", () => {
    const model = linked();
    model.begin("cancel");
    model.applyCancel({ cancelled: false, message: "the session is still good" });
    expect(model.getState()).toMatchObject({
      phase: "linked",
      message: "the session is still good",
    });
  });

  it("treats relink as a routine new code, not an error", () => {
    const model = linked();
    model.begin("relink");
    expect(model.getState()).toMatchObject({ phase: "starting", user: null });
    model.applyStart(
      { status: "pending", qrDataUrl: "data:image/png;base64,BBB", message: "Scan" },
      0,
    );
    expect(model.getState()).toMatchObject({ phase: "pending", actions: ["cancel"] });
  });

  it("clears the linked account on logout", () => {
    const model = linked();
    model.begin("logout");
    model.applyLogout({ cleared: true, message: "Unlinked" });
    expect(model.getState()).toMatchObject({ phase: "idle", user: null, actions: ["start"] });
  });

  it("keeps the session when logout did not clear", () => {
    const model = linked();
    model.begin("logout");
    model.applyLogout({ cleared: false, message: "nothing to clear" });
    expect(model.getState()).toMatchObject({ phase: "linked", message: "nothing to clear" });
  });
});

describe("a verb that did not answer", () => {
  it("reads the unknown-route 404 as a Hub without the QR operations", () => {
    const failure = channelQrFailure({ status: 404, message: "No management resource." });
    expect(failure.unavailable).toBe(true);
    const model = openChannelQrLinking({ available: true });
    model.begin("start");
    model.fail(failure);
    expect(model.getState()).toMatchObject({ phase: "unavailable", actions: [] });
    expect(model.getState().message).toContain("does not serve QR linking");
  });

  it("keeps a 503 retryable and says what is missing", () => {
    const failure = channelQrFailure({
      status: 503,
      message: "Channel runtime is unavailable.",
    });
    expect(failure.unavailable).toBe(false);
    const model = openChannelQrLinking({ available: true });
    model.begin("start");
    model.fail(failure);
    expect(model.getState()).toMatchObject({ phase: "failed", actions: ["start"] });
    expect(model.getState().message).toContain("has to be running");
  });
});

describe("transport failure", () => {
  it("lands on failed and offers a fresh start", () => {
    const model = openChannelQrLinking({ available: true });
    model.begin("start");
    model.fail({ unavailable: false, message: "the Hub did not answer" });
    expect(model.getState()).toMatchObject({
      phase: "failed",
      busy: false,
      actions: ["start"],
    });
  });

  it("notifies subscribers until it is closed", () => {
    const model = openChannelQrLinking({ available: true });
    let notified = 0;
    model.subscribe(() => {
      notified += 1;
    });
    model.begin("start");
    expect(notified).toBe(1);
    model.close();
    model.fail({ unavailable: false, message: "later" });
    expect(notified).toBe(1);
  });
});
