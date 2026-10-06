// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HubApiError } from "../api-client";
import { ChannelQrLinkPanel, type ChannelQrVerbs } from "./channel-qr-link-panel";

function verbsWith(start: ChannelQrVerbs["start"]): ChannelQrVerbs {
  return {
    start,
    poll: vi.fn(async () => ({ status: "pending" as const, message: "Still waiting" })),
    cancel: vi.fn(async () => ({ cancelled: true, message: "Cancelled" })),
    logout: vi.fn(async () => ({ cleared: true, message: "Logged out" })),
  };
}

const PENDING = {
  status: "pending" as const,
  message: "Scan this QR in WhatsApp → Linked Devices.",
  qrDataUrl: "data:image/png;base64,AAAA",
};

/** Every phase a panel reported, in order. */
const phases: string[] = [];
function recordPhase(phase: string): void {
  phases.push(phase);
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("ChannelQrLinkPanel", () => {
  it("offers one Log in, then shows the steps beside the code", async () => {
    const start = vi.fn(async () => PENDING);
    render(<ChannelQrLinkPanel channel="whatsapp" available verbs={verbsWith(start)} />);
    expect(screen.getByText("Log in to WhatsApp")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Log in" }));
    expect(await screen.findByText("Scan with WhatsApp")).toBeTruthy();
    expect(start).toHaveBeenCalledWith({ relink: false });
    expect(screen.getByLabelText("Login QR code")).toBeTruthy();
    expect(screen.getByText(/Linked devices/)).toBeTruthy();
    expect(screen.getByText(/The code expires in/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
  });

  it("starts on its own and tries again while a just-added account is not running yet", async () => {
    vi.useFakeTimers();
    const start = vi
      .fn<ChannelQrVerbs["start"]>()
      .mockRejectedValueOnce(
        new HubApiError(503, "channel_runtime_unavailable", "The channel runtime is starting"),
      )
      .mockResolvedValueOnce(PENDING);
    render(<ChannelQrLinkPanel channel="whatsapp" available verbs={verbsWith(start)} autoStart />);
    await act(async () => {});
    expect(start).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(start).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Scan with WhatsApp")).toBeTruthy();
  });

  it("gives up after four tries, and never retries a real refusal", async () => {
    vi.useFakeTimers();
    const notReady = new HubApiError(
      503,
      "channel_runtime_unavailable",
      "The channel runtime is starting",
    );
    const start = vi.fn<ChannelQrVerbs["start"]>().mockRejectedValue(notReady);
    render(<ChannelQrLinkPanel channel="whatsapp" available verbs={verbsWith(start)} autoStart />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(start).toHaveBeenCalledTimes(4);
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    cleanup();

    const refused = vi
      .fn<ChannelQrVerbs["start"]>()
      .mockRejectedValue(new HubApiError(400, "qr_login_refused", "The scan was declined"));
    render(
      <ChannelQrLinkPanel channel="whatsapp" available verbs={verbsWith(refused)} autoStart />,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(refused).toHaveBeenCalledTimes(1);
    expect(screen.getByText("The scan was declined")).toBeTruthy();
  });

  it("tells its caller every phase it reaches", async () => {
    phases.length = 0;
    const verbs = verbsWith(vi.fn(async () => PENDING));
    render(
      <ChannelQrLinkPanel
        channel="whatsapp"
        available
        verbs={verbs}
        autoStart
        onPhase={recordPhase}
      />,
    );
    await screen.findByText("Scan with WhatsApp");
    expect(phases).toEqual(["idle", "starting", "pending"]);
  });

  it("says what failed on the row itself, with Try again", async () => {
    const start = vi.fn(async () => ({
      status: "failed" as const,
      message: "The scan was declined",
    }));
    render(<ChannelQrLinkPanel channel="zalouser" available verbs={verbsWith(start)} />);
    fireEvent.click(screen.getByRole("button", { name: "Log in" }));
    expect(await screen.findByText("The scan was declined")).toBeTruthy();
    expect(screen.getByText("Log in to Zalo")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });
});
