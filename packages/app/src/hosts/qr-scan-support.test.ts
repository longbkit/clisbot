// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as webSupport from "./qr-scan-support.web";

const env = vi.hoisted(() => ({ isElectron: false }));
vi.mock("@/desktop/host", () => ({ isElectronRuntime: () => env.isElectron }));

function setBrowser(options: { secure: boolean; camera: boolean; coarsePointer: boolean }) {
  vi.stubGlobal("isSecureContext", options.secure);
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: options.camera ? { getUserMedia: () => Promise.resolve() } : undefined,
  });
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === "(pointer: coarse)" && options.coarsePointer,
  }));
}

beforeEach(() => {
  env.isElectron = false;
});
afterEach(() => vi.unstubAllGlobals());

describe("web QR scan support", () => {
  it("offers Scan QR on a phone browser over HTTPS", () => {
    setBrowser({ secure: true, camera: true, coarsePointer: true });
    expect(webSupport.isQrCameraAvailable()).toBe(true);
    expect(webSupport.shouldOfferQrScan()).toBe(true);
  });

  it("has no camera over plain http, where browsers hide getUserMedia", () => {
    setBrowser({ secure: false, camera: true, coarsePointer: true });
    expect(webSupport.isQrCameraAvailable()).toBe(false);
    expect(webSupport.shouldOfferQrScan()).toBe(false);
  });

  it("has no camera when the browser exposes no media devices", () => {
    setBrowser({ secure: true, camera: false, coarsePointer: true });
    expect(webSupport.isQrCameraAvailable()).toBe(false);
    expect(webSupport.shouldOfferQrScan()).toBe(false);
  });

  it("keeps the camera but does not offer Scan QR on a mouse-first browser", () => {
    setBrowser({ secure: true, camera: true, coarsePointer: false });
    expect(webSupport.isQrCameraAvailable()).toBe(true);
    expect(webSupport.shouldOfferQrScan()).toBe(false);
  });

  it("does not offer Scan QR in the desktop app", () => {
    setBrowser({ secure: true, camera: true, coarsePointer: true });
    env.isElectron = true;
    expect(webSupport.shouldOfferQrScan()).toBe(false);
  });
});
